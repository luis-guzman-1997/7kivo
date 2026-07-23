// Persistencia del JID de destino por contacto (modo conector).
//
// WhatsApp migró muchos contactos a direccionamiento @lid: el mensaje entrante
// llega con remoteJid = "<lid>@lid" y, para que la ENTREGA funcione, hay que
// responder a ESE jid (no a "<numero>@s.whatsapp.net", que WhatsApp acepta pero
// NO entrega para contactos migrados). El jid vivía solo en memoria (menuState) y
// se perdía en cada redeploy → los envíos caían al fallback @s.whatsapp.net y no
// llegaban. Aquí lo guardamos en Firestore para que sobreviva a reinicios.
//
// organizations/<orgId>/connectorJids/<phone> = { jid, updatedAt }

const { db } = require("../config/firebase");

const ref = (orgId, phone) =>
  db.collection("organizations").doc(orgId).collection("connectorJids").doc(String(phone));

const persistJid = async (orgId, phone, jid) => {
  if (!orgId || !phone || !jid) return;
  try {
    await ref(orgId, phone).set({ jid, updatedAt: Date.now() }, { merge: true });
  } catch (e) {
    /* best effort: si falla, el envío usa el fallback */
  }
};

const loadJid = async (orgId, phone) => {
  if (!orgId || !phone) return null;
  try {
    const snap = await ref(orgId, phone).get();
    return snap.exists ? snap.data().jid || null : null;
  } catch (e) {
    return null;
  }
};

module.exports = { persistJid, loadJid };
