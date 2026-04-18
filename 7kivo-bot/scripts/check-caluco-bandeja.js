/**
 * Diagnóstico y limpieza de solicitudes atascadas en caluco-express
 */
require("dotenv").config();
const admin = require("firebase-admin");

const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_PATH);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();
const ORG_ID = "caluco-express";
const orgRef = db.collection("organizations").doc(ORG_ID);

const COLLECTIONS = ["mandados", "viajes", "pedidos", "solicitudes", "delivery", "promo_orders"];

async function main() {
  const DELETE = process.argv[2] === "--delete";

  for (const col of COLLECTIONS) {
    const snap = await orgRef.collection(col)
      .where("status", "in", ["pending", "read", "taken"])
      .get();

    if (snap.empty) continue;

    console.log(`\n=== ${col} (${snap.size} docs) ===`);
    for (const doc of snap.docs) {
      const d = doc.data();
      console.log({
        id: doc.id,
        status: d.status,
        phoneNumber: d.phoneNumber || d.phone,
        assignedTo: d.assignedTo ? `${d.assignedTo.name} (${d.assignedTo.uid})` : null,
        createdAt: d.createdAt?.toDate?.()?.toISOString() || d.createdAt,
        assignedAt: d.assignedAt?.toDate?.()?.toISOString() || null,
      });

      if (DELETE) {
        await orgRef.collection(col).doc(doc.id).delete();
        console.log(`  ✓ ELIMINADO ${doc.id}`);
      }
    }
  }

  console.log("\nDone. Pasa --delete para eliminar los registros encontrados.");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
