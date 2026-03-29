const { db, admin } = require("../config/firebase");
const { getOrgId } = require("../config/orgConfig");

const getOrgRef = () => {
  return db.collection("organizations").doc(getOrgId());
};

// ==================== ORG STATUS ====================
const orgStatusCacheMap = {}; // { [orgId]: { data, ts } }
const ORG_STATUS_TTL = 30000;

const getOrgStatus = async () => {
  const orgId = getOrgId();
  const now = Date.now();
  const cached = orgStatusCacheMap[orgId];
  if (cached && now - cached.ts < ORG_STATUS_TTL) return cached.data;
  try {
    const snap = await db.collection("organizations").doc(orgId).get();
    orgStatusCacheMap[orgId] = { data: snap.exists ? snap.data() : {}, ts: now };
    return orgStatusCacheMap[orgId].data;
  } catch (err) {
    console.error("Error loading org status:", err.message);
    return cached?.data || {};
  }
};

// ==================== CACHE ====================
const messagesCacheMap = {}; // { [orgId]: { data, ts } }
const flowsCacheMap = {};    // { [orgId]: { data, ts } }
const menuCacheMap = {};     // { [orgId]: { data, ts } }
const keywordsCacheMap = {}; // { [orgId]: { data, ts } }
const campaignKeywordsCacheMap = {}; // { [orgId]: { data, ts } }
const CACHE_TTL = 60000;

const clearCache = (orgId) => {
  const id = orgId || getOrgId();
  delete messagesCacheMap[id];
  delete flowsCacheMap[id];
  delete menuCacheMap[id];
  delete keywordsCacheMap[id];
  delete campaignKeywordsCacheMap[id];
  delete orgStatusCacheMap[id];
};

// ==================== BOT MESSAGES ====================
const loadBotMessages = async () => {
  const orgId = getOrgId();
  const now = Date.now();
  const cached = messagesCacheMap[orgId];
  if (cached && now - cached.ts < CACHE_TTL && Object.keys(cached.data).length > 0) {
    return cached.data;
  }
  try {
    const snapshot = await getOrgRef().collection("botMessages").get();
    const messages = {};
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      messages[data.key] = data.content;
    });
    messagesCacheMap[orgId] = { data: messages, ts: now };
    return messages;
  } catch (error) {
    console.error("Error loading bot messages:", error);
    return cached?.data || {};
  }
};

const getMessage = async (key, fallback = "") => {
  const messages = await loadBotMessages();
  return messages[key] || fallback;
};

// ==================== INFO ====================
const getContactInfo = async () => {
  try {
    const doc = await getOrgRef().collection("info").doc("contact").get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error("Error loading contact info:", error);
    return null;
  }
};

const getScheduleInfo = async () => {
  try {
    const doc = await getOrgRef().collection("info").doc("schedule").get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error("Error loading schedule info:", error);
    return null;
  }
};

const getGeneralInfo = async () => {
  try {
    const doc = await getOrgRef().collection("info").doc("general").get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error("Error loading general info:", error);
    return null;
  }
};

// ==================== PROGRAMS ====================
const getProgramInfo = async (programId) => {
  try {
    const doc = await getOrgRef().collection("programs").doc(programId).get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error("Error loading program:", error);
    return null;
  }
};

const getAllPrograms = async () => {
  try {
    const snapshot = await getOrgRef().collection("programs").get();
    return snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(p => p.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (error) {
    console.error("Error loading programs:", error);
    return [];
  }
};

// ==================== CONFIG ====================
const getGeneralConfig = async () => {
  try {
    const doc = await getOrgRef().collection("config").doc("general").get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error("Error loading config:", error);
    return null;
  }
};

const getWhatsAppConfig = async () => {
  try {
    const doc = await getOrgRef().collection("config").doc("whatsapp").get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error("Error loading WhatsApp config:", error);
    return null;
  }
};

// ==================== FLOWS ====================
const getFlows = async () => {
  const orgId = getOrgId();
  const now = Date.now();
  const cached = flowsCacheMap[orgId];
  if (cached && now - cached.ts < CACHE_TTL) return cached.data;
  try {
    const snapshot = await getOrgRef().collection("flows").get();
    const flows = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(f => f.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    flowsCacheMap[orgId] = { data: flows, ts: now };
    return flows;
  } catch (error) {
    console.error("Error loading flows:", error);
    return cached?.data || [];
  }
};

const getFlow = async (flowId) => {
  try {
    const doc = await getOrgRef().collection("flows").doc(flowId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (error) {
    console.error("Error loading flow:", error);
    return null;
  }
};

// ==================== MENU CONFIG ====================
const getMenuConfig = async () => {
  const orgId = getOrgId();
  const now = Date.now();
  const cached = menuCacheMap[orgId];
  if (cached && now - cached.ts < CACHE_TTL) return cached.data;
  try {
    const doc = await getOrgRef().collection("config").doc("menu").get();
    if (doc.exists) {
      menuCacheMap[orgId] = { data: doc.data(), ts: now };
      return menuCacheMap[orgId].data;
    }
    return null;
  } catch (error) {
    console.error("Error loading menu config:", error);
    return cached?.data || null;
  }
};

// ==================== DYNAMIC COLLECTIONS ====================
const getCollectionItems = async (collectionName) => {
  try {
    const snapshot = await getOrgRef().collection(collectionName).get();
    return snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => item.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (error) {
    console.error(`Error loading collection ${collectionName}:`, error);
    return [];
  }
};

const getCollectionDef = async (slug) => {
  try {
    const snapshot = await getOrgRef().collection("_collections").where("slug", "==", slug).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error(`Error loading collection def for ${slug}:`, error);
    return null;
  }
};

const getCollectionItem = async (collectionName, itemId) => {
  try {
    const doc = await getOrgRef().collection(collectionName).doc(itemId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (error) {
    console.error(`Error loading item ${itemId} from ${collectionName}:`, error);
    return null;
  }
};

// ==================== APPOINTMENTS ====================
const getAppointmentsByDate = async (fecha, collectionName = "citas") => {
  try {
    const col = collectionName || "citas";
    const snapshot = await getOrgRef().collection(col)
      .where("_apptFecha", "==", fecha)
      .where("status", "in", ["confirmed", "pending"])
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error loading appointments:", error);
    return [];
  }
};

// ==================== APPOINTMENTS BY PHONE ====================
const getUpcomingAppointmentsByPhone = async (phoneNumber) => {
  try {
    const flows = await getFlows();
    const apptFlows = flows.filter(f => f.steps && f.steps.some(s => s.type === 'appointment_slot'));
    const collections = [...new Set(apptFlows.map(f => f.saveToCollection).filter(Boolean))];
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const results = [];
    for (const collectionName of collections) {
      try {
        const snapshot = await getOrgRef().collection(collectionName)
          .where('phoneNumber', '==', phoneNumber)
          .where('status', 'in', ['confirmed', 'pending'])
          .get();
        const items = snapshot.docs.map(doc => ({ id: doc.id, collectionName, ...doc.data() }));
        const future = items.filter(item => item._apptFecha && item._apptFecha >= todayStr);
        results.push(...future);
      } catch (err) {
        console.error(`Error querying ${collectionName}:`, err.message);
      }
    }
    results.sort((a, b) => {
      const da = (a._apptFecha || '') + (a._apptHora || '');
      const db = (b._apptFecha || '') + (b._apptHora || '');
      return da.localeCompare(db);
    });
    return results;
  } catch (err) {
    console.error('Error getting upcoming appointments:', err.message);
    return [];
  }
};

const cancelAppointment = async (collectionName, docId) => {
  try {
    const { admin } = require('../config/firebase');
    const docRef = getOrgRef().collection(collectionName).doc(docId);
    const snap = await docRef.get();
    const gcEventId = snap.exists ? snap.data()?.gcEventId || null : null;
    await docRef.update({
      status: 'cancelled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return gcEventId;
  } catch (err) {
    console.error('Error cancelling appointment:', err.message);
    throw err;
  }
};

const saveGcEventId = async (collectionName, docId, gcEventId) => {
  try {
    await getOrgRef().collection(collectionName).doc(docId).update({ gcEventId });
  } catch (err) {
    console.error('Error saving gcEventId:', err.message);
  }
};

// ==================== SAVE FLOW SUBMISSION ====================
const saveFlowSubmission = async (collectionName, data) => {
  try {
    const { admin } = require("../config/firebase");
    const docRef = await getOrgRef().collection(collectionName).add({
      ...data,
      organizationId: getOrgId(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending"
    });
    console.log(`Flow submission saved to ${collectionName}:`, docRef.id);
    return docRef.id;
  } catch (error) {
    console.error("Error saving flow submission:", error);
    throw error;
  }
};

// ==================== KEYWORDS ====================
const getKeywords = async () => {
  const orgId = getOrgId();
  const now = Date.now();
  const cached = keywordsCacheMap[orgId];
  if (cached && now - cached.ts < CACHE_TTL) return cached.data;
  try {
    const doc = await getOrgRef().collection("config").doc("keywords").get();
    const keywords = doc.exists ? (doc.data().keywords || []) : [];
    keywordsCacheMap[orgId] = { data: keywords, ts: now };
    return keywords;
  } catch (error) {
    console.error("Error loading keywords:", error);
    return cached?.data || [];
  }
};

// ==================== PROMO ORDERS ====================
const getCampaignById = async (campaignId) => {
  try {
    const doc = await getOrgRef().collection('campaigns').doc(campaignId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (error) {
    console.error('Error loading campaign:', error);
    return null;
  }
};

const createPromoOrder = async (phone, campaign) => {
  const campaignRef = getOrgRef().collection('campaigns').doc(campaign.id);
  const ordersCol = getOrgRef().collection('promo_orders');

  let orderId = null;
  let outOfStock = false;

  await admin.firestore().runTransaction(async (tx) => {
    const campaignSnap = await tx.get(campaignRef);
    if (!campaignSnap.exists) { outOfStock = true; return; }

    const data = campaignSnap.data();
    const stock = data.stock;

    // stock === null/undefined → ilimitado; stock <= 0 → agotado
    if (stock !== null && stock !== undefined && stock <= 0) {
      outOfStock = true;
      // Registrar intento rechazado por sin existencias
      tx.update(campaignRef, { stockDenied: admin.firestore.FieldValue.increment(1) });
      return;
    }

    const orderRef = ordersCol.doc();
    tx.set(orderRef, {
      phone,
      campaignId: campaign.id,
      campaignName: campaign.name || '',
      promoMessage: campaign.message || '',
      imageUrl: campaign.imageUrl || '',
      businessName: campaign.businessName || '',
      contactName: campaign.contactName || '',
      address: campaign.address || '',
      contactWhatsapp: campaign.contactWhatsapp || '',
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Descontar existencia y acumular total de pedidos recibidos
    const campaignUpdate = { totalOrders: admin.firestore.FieldValue.increment(1) };
    if (stock !== null && stock !== undefined) {
      campaignUpdate.stock = admin.firestore.FieldValue.increment(-1);
    }
    tx.update(campaignRef, campaignUpdate);

    orderId = orderRef.id;
  });

  return { orderId, outOfStock };
};

// ==================== CAMPAIGN KEYWORD TRIGGERS ====================
const getCampaignKeywordTriggers = async () => {
  const orgId = getOrgId();
  const now = Date.now();
  const cached = campaignKeywordsCacheMap[orgId];
  if (cached && now - cached.ts < CACHE_TTL) return cached.data;
  try {
    const doc = await getOrgRef().collection('config').doc('campaign_keywords').get();
    const triggers = doc.exists ? (doc.data().triggers || []) : [];
    campaignKeywordsCacheMap[orgId] = { data: triggers, ts: now };
    return triggers;
  } catch (error) {
    console.error('Error loading campaign keyword triggers:', error);
    return cached?.data || [];
  }
};

const lookupCollectionByField = async (collectionName, fieldKey, value) => {
  try {
    const snapshot = await getOrgRef().collection(collectionName)
      .where(fieldKey, '==', value)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const d = snapshot.docs[0];
    return { id: d.id, ...d.data() };
  } catch (error) {
    console.error(`Error looking up ${fieldKey}=${value} in ${collectionName}:`, error);
    return null;
  }
};

module.exports = {
  loadBotMessages,
  getMessage,
  getContactInfo,
  getScheduleInfo,
  getGeneralInfo,
  getProgramInfo,
  getAllPrograms,
  getGeneralConfig,
  getWhatsAppConfig,
  getFlows,
  getFlow,
  getMenuConfig,
  getKeywords,
  getCollectionItems,
  getCollectionItem,
  getCollectionDef,
  saveFlowSubmission,
  getAppointmentsByDate,
  getUpcomingAppointmentsByPhone,
  cancelAppointment,
  saveGcEventId,
  lookupCollectionByField,
  getCampaignById,
  createPromoOrder,
  getCampaignKeywordTriggers,
  getOrgStatus,
  clearCache
};
