/**
 * Copia el CONTENIDO DEL BOT (flujos + configuración de bot) desde
 * Instituto CanZion Sonsonate hacia el org de prueba test-luis.
 *
 * ✅ Copia (sobrescribe en test-luis):
 *   - flows           (IDs originales — el menú referencia flowId)
 *   - _collections    (esquemas)
 *   - config/menu
 *   - botMessages
 *   - programas, instrumentos   (catálogos que alimentan las listas de los flujos)
 *   - info/general, info/contact, info/schedule
 *
 * 🚫 NO toca en test-luis (config de servicio / datos propios):
 *   - config/whatsapp, config/general
 *   - documento de la organización
 *   - connectorAuth, conversations, admins, billing, campaigns, presence, public
 *   - datos de envíos reales de Canzion (permisos, prematriculas, quejas, etc.)
 *
 * Uso:
 *   node scripts/copy-canzion-to-testluis.js          (dry-run: solo muestra)
 *   node scripts/copy-canzion-to-testluis.js --apply  (ejecuta)
 */
const admin = require("firebase-admin");
const sa = require("../kivo7.json");
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: "kivo7-app" });
const db = admin.firestore();

const SRC = "instituto-canzion-sonsonate";
const DST = "test-luis";
const APPLY = process.argv.includes("--apply");

// Subcolecciones que se copian documento-a-documento (preservando IDs).
const COPY_SUBCOLLECTIONS = [
  "flows",
  "_collections",
  "botMessages",
  "programas",
  "instrumentos",
];
// Documentos sueltos que se copian por ID dentro de una subcolección.
const COPY_DOCS = [
  ["config", "menu"],
  ["info", "general"],
  ["info", "contact"],
  ["info", "schedule"],
];

async function clearCollection(ref) {
  const snap = await ref.get();
  let n = 0;
  const batchSize = 400;
  let batch = db.batch();
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count++; n++;
    if (count >= batchSize) { await batch.commit(); batch = db.batch(); count = 0; }
  }
  if (count > 0) await batch.commit();
  return n;
}

async function copyCollection(name) {
  const srcRef = db.collection("organizations").doc(SRC).collection(name);
  const dstRef = db.collection("organizations").doc(DST).collection(name);
  const snap = await srcRef.get();
  if (!APPLY) {
    console.log(`  [dry] ${name}: copiaría ${snap.size} docs (limpiaría destino primero)`);
    return;
  }
  const cleared = await clearCollection(dstRef);
  let batch = db.batch(); let count = 0;
  for (const d of snap.docs) {
    batch.set(dstRef.doc(d.id), d.data());
    count++;
    if (count >= 400) { await batch.commit(); batch = db.batch(); count = 0; }
  }
  if (count > 0) await batch.commit();
  console.log(`  ✓ ${name}: limpiados ${cleared}, copiados ${snap.size}`);
}

async function copyDoc(sub, id) {
  const srcDoc = db.collection("organizations").doc(SRC).collection(sub).doc(id);
  const dstDoc = db.collection("organizations").doc(DST).collection(sub).doc(id);
  const s = await srcDoc.get();
  if (!s.exists) { console.log(`  ! ${sub}/${id}: no existe en origen, saltado`); return; }
  if (!APPLY) { console.log(`  [dry] ${sub}/${id}: sobrescribiría`); return; }
  await dstDoc.set(s.data());
  console.log(`  ✓ ${sub}/${id}: copiado`);
}

(async () => {
  console.log(`\n=== Copia CanZion -> test-luis  (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);
  console.log("Subcolecciones completas:");
  for (const c of COPY_SUBCOLLECTIONS) await copyCollection(c);
  console.log("\nDocumentos sueltos:");
  for (const [sub, id] of COPY_DOCS) await copyDoc(sub, id);
  console.log(APPLY ? "\n✅ Listo." : "\n(dry-run) Ejecuta con --apply para aplicar.");
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
