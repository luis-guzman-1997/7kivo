// Solo lectura: keywords de todos los flujos de Canzion (para revisar colisiones en 1er mensaje).
const { db } = require("../src/config/firebase");
const ORG_ID = process.env.CANZION_ORG_ID || "instituto-canzion-sonsonate";
(async () => {
  const flows = await db.collection("organizations").doc(ORG_ID).collection("flows").get();
  flows.forEach((d) => {
    const f = d.data();
    console.log(`- ${f.name} [active=${f.active}] keywords=${JSON.stringify(f.keywords || [])}`);
  });
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
