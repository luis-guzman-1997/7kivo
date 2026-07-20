/**
 * Siembra el flujo "Camisas ICZ" (reserva de camisetas) de Canzion.
 * Ver guía: LugiProjects/guias/canzion-flujo-camisas-icz.md
 *
 * Uso:
 *   node canzion-seed/seed-canzion-camisas.js            (dry-run: no escribe)
 *   node canzion-seed/seed-canzion-camisas.js --commit   (escribe en Firestore + Storage)
 *
 * Qué hace (con --commit):
 *   1. Sube la foto del flyer a Storage y arma la URL de descarga (para el pre-mensaje).
 *   2. Crea/actualiza el flujo "Camisas ICZ" en organizations/<ORG>/flows.
 *   3. Crea/actualiza la definición de colección `pedidos_camisas` en _collections (para el panel).
 *   4. Menú: quita "Conócenos" y agrega el ítem de flujo "Camisas ICZ".
 * Idempotente: matchea el flujo por nombre y reordena el menú sin duplicar.
 * NO toca ningún otro flujo, colección ni dato.
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { db, admin } = require("../src/config/firebase");

const ORG_ID = process.env.CANZION_ORG_ID || "instituto-canzion-sonsonate";
const COMMIT = process.argv.includes("--commit");
const BUCKET = process.env.KIVO_BUCKET || "kivo7-app.firebasestorage.app";
const COLLECTION = "pedidos_camisas";
const FLOW_NAME = "Camisas ICZ";
const REMOVE_LABEL = process.env.CANZION_REMOVE_MENU_LABEL || "Conócenos";
const IMG_LOCAL = path.resolve(__dirname, "..", "..", "CanzionInfo", "foto camisas.jpg");
const STAMP = Date.now();

function buildFlow(imageUrl) {
  const preImg = {
    preMessageType: "image",
    preMessageImage: imageUrl,
    preMessage:
      "Estas son las camisas ICZ. $11.00 c/u · pago 100% al hacer el pedido.",
    preMessageLinkUrl: "",
    preMessageLinkLabel: "",
  };
  const base = {
    required: true,
    optional: false,
    validation: {},
    errorMessage: "",
    showInPanel: true,
    preMessageType: "none",
    preMessage: "",
    preMessageImage: "",
    preMessageLinkUrl: "",
    preMessageLinkLabel: "",
  };
  return {
    name: FLOW_NAME,
    menuLabel: "Camisas ICZ",
    menuDescription: "Reserva tu camiseta ICZ",
    description: "Reserva de camisetas ICZ (color, talla, cantidad, nombre)",
    type: "custom",
    active: true,
    order: 99,
    saveToCollection: COLLECTION,
    allowMultiple: true,
    notifyAdmin: false,
    notifyDelivery: false,
    completionMessage:
      "¡Listo! Registramos tu pedido ✅. Recuerda: el pago es del 100% ($11.00 por camisa) al hacer el pedido. Si quieres pedir otra talla o color, vuelve al menú y elige *Camisas ICZ* otra vez.",
    steps: [
      {
        ...base,
        ...preImg,
        id: "step_cantidad",
        type: "number_input",
        prompt: "¿Cuántas camisas quieres?",
        fieldKey: "cantidad",
        fieldLabel: "Cantidad",
        errorMessage: "Por favor escribe un número.",
      },
      {
        ...base,
        id: "step_color",
        type: "text_input",
        prompt: "Escribe el color que quieres (Gris, Azul o Negro):",
        fieldKey: "color",
        fieldLabel: "Color",
      },
      {
        ...base,
        id: "step_talla",
        type: "text_input",
        prompt: "Escribe tu talla (ej: M, XL, o 2/4/6…):",
        fieldKey: "talla",
        fieldLabel: "Talla",
      },
      {
        ...base,
        id: "step_nombre",
        type: "text_input",
        prompt: "Escríbeme tu nombre completo:",
        fieldKey: "nombre",
        fieldLabel: "Nombre",
        validation: { minLength: 3 },
        errorMessage: "Por favor ingresa un nombre válido.",
      },
    ],
    keywords: ["camisa", "camisas", "camiseta", "camisetas"],
  };
}

const COLLECTION_DEF = {
  name: "Pedidos de camisas",
  slug: COLLECTION,
  description: "Reservas del flujo Camisas ICZ",
  displayField: "nombre",
  fields: [
    { key: "cantidad", label: "Cantidad", type: "number", required: true },
    { key: "color", label: "Color", type: "text", required: true },
    { key: "talla", label: "Talla", type: "text", required: true },
    { key: "nombre", label: "Nombre", type: "text", required: true },
  ],
};

async function reuseOrUploadImage(orgRef) {
  // Si el flujo ya existe con imagen, reutilizarla (evita subir duplicados).
  const existing = await orgRef.collection("flows").where("name", "==", FLOW_NAME).limit(1).get();
  if (!existing.empty) {
    const steps = existing.docs[0].data().steps || [];
    const withImg = steps.find((s) => s.preMessageImage);
    if (withImg && withImg.preMessageImage) {
      console.log("↺ Reutilizando imagen del flujo existente.");
      return withImg.preMessageImage;
    }
  }
  if (!fs.existsSync(IMG_LOCAL)) throw new Error(`No encuentro la imagen: ${IMG_LOCAL}`);
  const token = crypto.randomUUID();
  const dest = `organizations/${ORG_ID}/flows/premsg-camisas-${STAMP}.jpg`;
  const bucket = admin.storage().bucket(BUCKET);
  await bucket.upload(IMG_LOCAL, {
    destination: dest,
    metadata: { contentType: "image/jpeg", metadata: { firebaseStorageDownloadTokens: token } },
  });
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(dest)}?alt=media&token=${token}`;
  console.log(`✓ Imagen subida: ${dest}`);
  return url;
}

async function main() {
  const orgRef = db.collection("organizations").doc(ORG_ID);
  console.log(`Org: ${ORG_ID} | flujo: "${FLOW_NAME}" | colección: ${COLLECTION} | commit: ${COMMIT}`);

  if (!COMMIT) {
    console.log(`DRY-RUN. Imagen local: ${IMG_LOCAL} (existe: ${fs.existsSync(IMG_LOCAL)})`);
    console.log(`Se quitaría del menú: "${REMOVE_LABEL}" y se agregaría "Camisas ICZ".`);
    console.log("Pasos: cantidad (número) → color → talla → nombre.");
    console.log("Vuelve a correr con --commit para escribir en Firestore + Storage.");
    return;
  }

  // 1) Imagen
  const imageUrl = await reuseOrUploadImage(orgRef);

  // 2) Definición de colección (para que aparezca en "Base de datos" del panel)
  const defs = await orgRef.collection("_collections").where("slug", "==", COLLECTION).limit(1).get();
  if (!defs.empty) await orgRef.collection("_collections").doc(defs.docs[0].id).set(COLLECTION_DEF, { merge: true });
  else await orgRef.collection("_collections").add(COLLECTION_DEF);
  console.log(`✓ Definición de colección "${COLLECTION}" lista.`);

  // 3) Flujo (match por nombre para no duplicar)
  const flow = buildFlow(imageUrl);
  let flowId;
  const existing = await orgRef.collection("flows").where("name", "==", FLOW_NAME).limit(1).get();
  if (!existing.empty) {
    flowId = existing.docs[0].id;
    await orgRef.collection("flows").doc(flowId).set(flow, { merge: true });
    console.log(`✓ Flujo "${FLOW_NAME}" actualizado (${flowId}).`);
  } else {
    const ref = await orgRef.collection("flows").add(flow);
    flowId = ref.id;
    console.log(`✓ Flujo "${FLOW_NAME}" creado (${flowId}).`);
  }

  // 4) Menú: quitar "Conócenos" + agregar "Camisas ICZ" (idempotente)
  const menuRef = orgRef.collection("config").doc("menu");
  const menu = (await menuRef.get()).data() || { items: [] };
  let items = Array.isArray(menu.items) ? menu.items : [];
  items = items.filter((it) => (it.label || "") !== REMOVE_LABEL && it.flowId !== flowId);
  items.push({
    id: "item_camisas_" + STAMP,
    type: "flow",
    flowId,
    label: flow.menuLabel,
    description: flow.menuDescription || "",
    active: true,
    order: items.length + 1,
  });
  items.forEach((it, i) => (it.order = i + 1));
  await menuRef.set({ items }, { merge: true });
  console.log(`✓ Menú actualizado: quitado "${REMOVE_LABEL}", agregado "${flow.menuLabel}" (${items.length}/7).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
