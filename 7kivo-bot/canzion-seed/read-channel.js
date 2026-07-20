// Solo lectura: canal (connectionType) y config de whatsapp de Canzion.
const { db } = require("../src/config/firebase");
const ORG_ID = process.env.CANZION_ORG_ID || "instituto-canzion-sonsonate";
(async () => {
  const orgRef = db.collection("organizations").doc(ORG_ID);
  const root = (await orgRef.get()).data() || {};
  const wa = (await orgRef.collection("config").doc("whatsapp").get()).data() || {};
  const gen = (await orgRef.collection("config").doc("general").get()).data() || {};
  console.log("root.connectionType:", root.connectionType);
  console.log("config/whatsapp.connectionType:", wa.connectionType);
  console.log("config/whatsapp keys:", Object.keys(wa).join(", "));
  console.log("config/general.botApiUrl:", gen.botApiUrl);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
