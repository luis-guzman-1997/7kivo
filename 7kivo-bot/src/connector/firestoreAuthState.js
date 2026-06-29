// Persistencia del auth state de Baileys en Firestore.
//
// Railway tiene disco efímero (cada redeploy lo borra), así que NO podemos usar
// useMultiFileAuthState (que escribe en ./auth). En su lugar guardamos creds y
// keys en organizations/{orgId}/connectorAuth/*, de modo que al reiniciar el
// servicio las sesiones se rehidratan y se reconectan solas sin pedir QR.
//
// Patrón estándar de Baileys: creds en un doc, cada key en su propio doc
// (Baileys pide keys por id en lotes pequeños, así que un doc por key es barato
// y evita el límite de 1MB por documento de Firestore).

const { initAuthCreds, BufferJSON, proto } = require("@whiskeysockets/baileys");
const { db } = require("../config/firebase");

// Firestore no permite "/" en el id de documento. Los ids de keys de Baileys
// (jids, etc.) pueden contenerlo en casos raros → lo saneamos.
const safeId = (s) => String(s).replace(/\//g, "__");

const useFirestoreAuthState = async (orgId) => {
  const baseRef = db
    .collection("organizations")
    .doc(orgId)
    .collection("connectorAuth");
  const credsRef = baseRef.doc("creds");

  const readData = async (ref) => {
    try {
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data || data.value === undefined) return null;
      return JSON.parse(data.value, BufferJSON.reviver);
    } catch (e) {
      console.error(`[connector:${orgId}] readData error:`, e.message);
      return null;
    }
  };

  const writeData = async (ref, value) => {
    await ref.set({ value: JSON.stringify(value, BufferJSON.replacer) });
  };

  const creds = (await readData(credsRef)) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(baseRef.doc(`${type}-${safeId(id)}`));
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              result[id] = value;
            })
          );
          return result;
        },
        set: async (data) => {
          const batch = db.batch();
          let ops = 0;
          for (const type in data) {
            for (const id in data[type]) {
              const value = data[type][id];
              const ref = baseRef.doc(`${type}-${safeId(id)}`);
              if (value) {
                batch.set(ref, {
                  value: JSON.stringify(value, BufferJSON.replacer),
                });
              } else {
                batch.delete(ref);
              }
              ops++;
            }
          }
          if (ops > 0) await batch.commit();
        },
      },
    },
    saveCreds: async () => {
      await writeData(credsRef, creds);
    },
  };
};

// Borra todo el auth state de una org (al cerrar sesión / desvincular).
const clearFirestoreAuthState = async (orgId) => {
  const baseRef = db
    .collection("organizations")
    .doc(orgId)
    .collection("connectorAuth");
  const snap = await baseRef.get();
  if (snap.empty) return;
  // Firestore limita a 500 ops por batch.
  let batch = db.batch();
  let ops = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    ops++;
    if (ops === 500) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
};

module.exports = { useFirestoreAuthState, clearFirestoreAuthState };
