/**
 * Siembra el flujo "Mi horario" y la colección `horarios_alumnos` de Canzion.
 *
 * Uso:
 *   node canzion-seed/seed-canzion-horarios.js            (dry-run: solo cuenta)
 *   node canzion-seed/seed-canzion-horarios.js --commit   (escribe en Firestore)
 *
 * Requiere las credenciales del bot (src/config/firebase + .env / kivo7.json).
 * Escribe en organizations/<ORG_ID>/{horarios_alumnos, flows}.
 * NO toca la coleccion `alumnos` existente ni ningun otro dato.
 * Idempotente: al re-sembrar borra SOLO los docs que el mismo creo (marca _seed).
 */
const path = require("path");
const fs = require("fs");
const { db, admin } = require("../src/config/firebase");

const ORG_ID = process.env.CANZION_ORG_ID || "instituto-canzion-sonsonate";
const COMMIT = process.argv.includes("--commit");
const COLLECTION = "horarios_alumnos";
const SEED_TAG = "horarios-canzion-2026-02";

const alumnos = JSON.parse(fs.readFileSync(path.join(__dirname, "alumnos_seed.json"), "utf8"));
const flow = JSON.parse(fs.readFileSync(path.join(__dirname, "flow_mi_horario.json"), "utf8"));

async function main() {
  const orgRef = db.collection("organizations").doc(ORG_ID);
  console.log(`Org: ${ORG_ID} | alumnos: ${alumnos.length} | coleccion: ${COLLECTION} | commit: ${COMMIT}`);

  if (!COMMIT) {
    const flagged = alumnos.filter((a) => a._revisar).length;
    console.log(`DRY-RUN. Alumnos a REVISAR (programa/semestre ambiguo): ${flagged}`);
    console.log("Vuelve a correr con --commit para escribir en Firestore.");
    return;
  }

  // 0.a) Definición de colección para que aparezca en "Base de datos" del panel.
  const defSlug = COLLECTION;
  const defs = await orgRef.collection("_collections").where("slug", "==", defSlug).limit(1).get();
  const def = {
    name: "Horarios de Alumnos", slug: defSlug,
    description: "Padrón para el flujo Mi horario (consulta por nombre)",
    displayField: "nombre",
    fields: [
      { key: "nombre", label: "Nombre", type: "text", required: true },
      { key: "programa", label: "Programa", type: "text", required: false },
      { key: "semestre", label: "Semestre", type: "text", required: false },
      { key: "instrumento", label: "Instrumento", type: "text", required: false },
      { key: "maestro", label: "Maestro", type: "text", required: false },
      { key: "hora_instrumento", label: "Hora de instrumento", type: "text", required: false },
      { key: "aula", label: "Aula", type: "text", required: false },
      { key: "horario_general", label: "Horario general", type: "text", required: false },
    ],
  };
  if (!defs.empty) await orgRef.collection("_collections").doc(defs.docs[0].id).set(def, { merge: true });
  else await orgRef.collection("_collections").add(def);
  console.log(`✓ Definición de colección "${defSlug}" lista (visible en el panel).`);

  // 0.b) Idempotencia: borrar solo lo previamente sembrado por este script.
  const prev = await orgRef.collection(COLLECTION).where("_seed", "==", SEED_TAG).get();
  if (!prev.empty) {
    let db1 = db.batch(), k = 0;
    for (const d of prev.docs) { db1.delete(d.ref); if (++k % 400 === 0) { await db1.commit(); db1 = db.batch(); } }
    await db1.commit();
    console.log(`↺ Borrados ${prev.size} docs de una siembra anterior.`);
  }

  // 1) Colección horarios_alumnos (un doc por registro; batch de 400)
  let batch = db.batch();
  let n = 0;
  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const a of alumnos) {
    const { _revisar, ...clean } = a; // no persistir la marca de revisión
    const ref = orgRef.collection(COLLECTION).doc();
    // createdAt/updatedAt: el panel lista con orderBy('createdAt') y excluye docs sin él.
    batch.set(ref, { ...clean, active: true, createdAt: now, updatedAt: now });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  console.log(`✓ ${alumnos.length} alumnos escritos en ${COLLECTION}.`);

  // 2) Flujo "Mi horario" (evita duplicar si ya existe por nombre)
  let flowId;
  const existing = await orgRef.collection("flows").where("name", "==", flow.name).limit(1).get();
  if (!existing.empty) {
    flowId = existing.docs[0].id;
    await orgRef.collection("flows").doc(flowId).set(flow, { merge: true });
    console.log(`✓ Flujo "${flow.name}" actualizado (${flowId}).`);
  } else {
    const ref = await orgRef.collection("flows").add(flow);
    flowId = ref.id;
    console.log(`✓ Flujo "${flow.name}" creado (${flowId}).`);
  }

  // 3) Menú: quitar "Déjanos un Mensaje" y agregar "Mi horario".
  //    Solo reordena config/menu.items; NO borra el flujo de mensaje ni su data.
  const menuRef = orgRef.collection("config").doc("menu");
  const menuSnap = await menuRef.get();
  const menu = menuSnap.data() || { items: [] };
  let items = Array.isArray(menu.items) ? menu.items : [];
  const REMOVE_LABEL = process.env.CANZION_REMOVE_MENU_LABEL || "Déjanos un Mensaje";
  // quita el item de mensaje y cualquier item previo de este flujo (idempotente)
  items = items.filter((it) => (it.label || "") !== REMOVE_LABEL && it.flowId !== flowId);
  items.push({
    id: "item_horario_" + Date.now(),
    type: "flow",
    flowId,
    label: flow.menuLabel || "Mi horario",
    description: flow.menuDescription || "",
    active: true,
    order: items.length + 1,
  });
  items.forEach((it, i) => (it.order = i + 1));
  await menuRef.set({ items }, { merge: true });
  console.log(`✓ Menú actualizado: quitado "${REMOVE_LABEL}", agregado "${flow.menuLabel}" (${items.length}/7).`);
  console.log("  (El flujo 'Déjanos un Mensaje' y su data quedan intactos; solo salió del menú.)");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
