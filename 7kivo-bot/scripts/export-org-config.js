/**
 * Export Org Config
 *
 * Lee la configuración completa de una organización desde Firestore
 * y genera un archivo JSON portable que puede cargarse desde el panel
 * superadmin para sobrescribir la config de cualquier org.
 *
 * Incluye: flujos, colecciones, menú, botMessages, info (contacto,
 * horarios, general). NO incluye: credenciales WhatsApp, admins, datos.
 *
 * Uso:
 *   cd 7kivo-bot
 *   ORG_ID=dr-david-laguardia node scripts/export-org-config.js
 *   ORG_ID=dr-david-laguardia node scripts/export-org-config.js --out=./mi-config.json
 */

require("dotenv").config();
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const projectId = process.env.FIREBASE_PROJECT_ID || "kivo7-app";
const ORG_ID = process.env.ORG_ID;

if (!ORG_ID) {
  console.error("\nError: ORG_ID no definido.");
  console.error("Uso: ORG_ID=mi-org node scripts/export-org-config.js\n");
  process.exit(1);
}

// ── Firebase init ──────────────────────────────────────────────────────────

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const credsVal = process.env.GOOGLE_APPLICATION_CREDENTIALS.trim();
  if (credsVal.startsWith("{")) {
    try {
      const sa = JSON.parse(credsVal);
      if (sa.type === "service_account" && sa.private_key) {
        admin.initializeApp({ credential: admin.credential.cert(sa), projectId });
      } else {
        admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
      }
    } catch (_) {
      admin.initializeApp({ projectId });
    }
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
  }
} else {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();

// ── Helpers ────────────────────────────────────────────────────────────────

function stripTimestamps(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripTimestamps);
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "createdAt" || k === "updatedAt") continue;
    // Firestore Timestamp objects
    if (v && typeof v === "object" && typeof v.toDate === "function") continue;
    result[k] = stripTimestamps(v);
  }
  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function exportOrgConfig() {
  console.log("\n========================================");
  console.log(`  Exportando config: ${ORG_ID}`);
  console.log("========================================\n");

  const orgRef = db.collection("organizations").doc(ORG_ID);

  // config/general (solo metadata, no credenciales WA)
  const configGenDoc = await orgRef.collection("config").doc("general").get();
  const configGenData = configGenDoc.exists ? configGenDoc.data() : {};

  // flows
  const flowsSnap = await orgRef.collection("flows").get();
  const flows = [];
  const flowIdToName = {};
  for (const d of flowsSnap.docs) {
    const data = stripTimestamps(d.data());
    flows.push(data);
    if (data.name) flowIdToName[d.id] = data.name;
  }
  console.log(`  Flujos:        ${flows.length}`);

  // _collections (solo definiciones, no datos)
  const colSnap = await orgRef.collection("_collections").get();
  const collections = colSnap.docs.map(d => stripTimestamps(d.data()));
  console.log(`  Colecciones:   ${collections.length}`);

  // config/menu — sustituye flowId por flowName para portabilidad
  const menuDoc = await orgRef.collection("config").doc("menu").get();
  let menu = null;
  if (menuDoc.exists) {
    menu = stripTimestamps(menuDoc.data());
    if (Array.isArray(menu.items)) {
      menu.items = menu.items.map(item => {
        if (item.type === "flow" && item.flowId) {
          const { flowId, ...rest } = item;
          return { ...rest, flowName: flowIdToName[flowId] || flowId };
        }
        return item;
      });
    }
  }
  console.log(`  Menú items:    ${menu?.items?.length ?? 0}`);

  // botMessages
  const botMsgSnap = await orgRef.collection("botMessages").get();
  const botMessages = botMsgSnap.docs.map(d => stripTimestamps(d.data()));
  console.log(`  Bot messages:  ${botMessages.length}`);

  // info
  const [contactDoc, scheduleDoc, generalDoc] = await Promise.all([
    orgRef.collection("info").doc("contact").get(),
    orgRef.collection("info").doc("schedule").get(),
    orgRef.collection("info").doc("general").get()
  ]);

  const seed = {
    version: "1",
    exportedFrom: ORG_ID,
    exportedAt: new Date().toISOString(),
    orgDefaults: {
      orgName: configGenData.orgName || "",
      description: configGenData.description || "",
      industry: configGenData.industry || "general"
    },
    info: {
      contact: contactDoc.exists ? stripTimestamps(contactDoc.data()) : null,
      schedule: scheduleDoc.exists ? stripTimestamps(scheduleDoc.data()) : null,
      general: generalDoc.exists ? stripTimestamps(generalDoc.data()) : null
    },
    flows,
    collections,
    menu,
    botMessages
  };

  // Determinar archivo de salida
  const outArg = process.argv.find(a => a.startsWith("--out="));
  const outFile = outArg
    ? outArg.replace("--out=", "")
    : `./config-${ORG_ID}-${Date.now()}.json`;

  fs.writeFileSync(path.resolve(outFile), JSON.stringify(seed, null, 2), "utf8");

  console.log(`\n✅ Config exportada a: ${outFile}`);
  console.log(`\n  Para cargar en otro org:`);
  console.log(`  Superadmin → Organizaciones → [org] → Cargar Config → subir este archivo\n`);
}

exportOrgConfig().catch(e => {
  console.error("Error:", e);
  process.exit(1);
}).finally(() => process.exit(0));
