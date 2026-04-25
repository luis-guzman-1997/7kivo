const { db, admin } = require("../config/firebase");
const { getOrgId } = require("../config/orgConfig");
const { getFlow, getContactInfo } = require("../services/botMessagesService");

const getCatalogData = async (req, res) => {
  try {
    const { flowId } = req.params;
    const flow = await getFlow(flowId);
    if (!flow || !flow.catalogCollection) {
      return res.status(404).json({ ok: false, error: "Catálogo no encontrado" });
    }

    const orgId = getOrgId();

    let products;
    if (flow.webStoreEnabled) {
      const snap = await db.collection("organizations").doc(orgId)
        .collection("webdelivery")
        .where("flowId", "==", flowId)
        .get();
      products = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => p.disponible !== false)
        .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    } else if (flow.catalogCollection) {
      const snap = await db.collection("organizations").doc(orgId)
        .collection(flow.catalogCollection).get();
      products = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => p.disponible !== false);
    } else {
      return res.status(404).json({ ok: false, error: "Sin catálogo configurado" });
    }

    const contact = await getContactInfo();
    const waPhone = (contact?.phone || "").replace(/\D/g, "");

    const webSteps = (flow.steps || [])
      .filter(s => s.source === "web")
      .map(s => ({
        id: s.id,
        type: s.type,
        prompt: s.prompt,
        fieldKey: s.fieldKey,
        fieldLabel: s.fieldLabel,
        required: s.required !== false,
        customOptions: s.customOptions || [],
        optionsSource: s.optionsSource || "custom",
      }));

    return res.json({
      ok: true,
      flow: {
        id: flow.id,
        name: flow.name,
        menuLabel: flow.menuLabel,
        completionMessage: flow.completionMessage,
        storeImage: flow.storeImage || "",
      },
      webSteps,
      products,
      waPhone,
    });
  } catch (err) {
    console.error("getCatalogData error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

const createOrder = async (req, res) => {
  try {
    const { code, items, itemsText, total, totalText, flowId, webData, orderDate } = req.body;
    if (!code || !items || !flowId) {
      return res.status(400).json({ ok: false, error: "Datos incompletos" });
    }

    const orgId = getOrgId();
    const ordersRef = db.collection("organizations").doc(orgId).collection("orders");

    const existing = await ordersRef.where("code", "==", code).limit(1).get();
    if (!existing.empty) {
      return res.json({ ok: true, id: existing.docs[0].id });
    }

    const docRef = await ordersRef.add({
      code,
      items,
      itemsText: itemsText || "",
      total: total || 0,
      totalText: totalText || "",
      flowId,
      webData: webData || {},
      orderDate: orderDate || new Date().toLocaleDateString("es"),
      status: "pending",
      clientPhone: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ ok: true, id: docRef.id });
  } catch (err) {
    console.error("createOrder error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

module.exports = { getCatalogData, createOrder };
