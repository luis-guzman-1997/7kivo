// Solo lectura: imprime el menú actual y los flujos de Canzion.
const { db } = require("../src/config/firebase");
const ORG_ID = process.env.CANZION_ORG_ID || "instituto-canzion-sonsonate";
(async () => {
  const orgRef = db.collection("organizations").doc(ORG_ID);
  const menuSnap = await orgRef.collection("config").doc("menu").get();
  const menu = menuSnap.data() || {};
  const items = Array.isArray(menu.items) ? menu.items : [];
  console.log(`MENU (${items.length} items):`);
  items.forEach((it) =>
    console.log(`  - order=${it.order} type=${it.type} label="${it.label}" flowId=${it.flowId || ""} active=${it.active}`)
  );
  const flows = await orgRef.collection("flows").get();
  console.log(`\nFLOWS (${flows.size}):`);
  flows.forEach((d) => console.log(`  - ${d.id} name="${d.data().name}" saveToCollection="${d.data().saveToCollection || ""}"`));
  const defs = await orgRef.collection("_collections").get();
  console.log(`\n_collections (${defs.size}): ${defs.docs.map((d) => d.data().slug).join(", ")}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
