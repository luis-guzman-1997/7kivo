// Solo lectura: muestra phoneNumber de submissions recientes en colecciones de la bandeja.
const { db } = require("../src/config/firebase");
const ORG_ID = process.env.CANZION_ORG_ID || "instituto-canzion-sonsonate";
const COLS = ["pedidos_camisas", "permisos", "prematriculas", "quejas-o-sugerencias"];
(async () => {
  const orgRef = db.collection("organizations").doc(ORG_ID);
  for (const c of COLS) {
    const snap = await orgRef.collection(c).limit(5).get();
    console.log(`\n=== ${c} (${snap.size}) ===`);
    snap.forEach((d) => {
      const x = d.data();
      const pn = x.phoneNumber;
      const kind = pn == null ? "NULL" : /^\d{8,15}$/.test(String(pn)) ? "MSISDN?" : `len=${String(pn).length}`;
      console.log(`  ${d.id}: phoneNumber=${JSON.stringify(pn)} [${kind}] nombre=${JSON.stringify(x.nombre || x.nombreEstudiante || "")}`);
    });
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
