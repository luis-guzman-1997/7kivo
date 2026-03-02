const { db } = require("../config/firebase");
const { getOrgId } = require("../config/orgConfig");

const getOrgRef = () => {
  return db.collection("organizations").doc(getOrgId());
};

// ==================== ORG STATUS ====================
let orgStatusCache = null;
let orgStatusCacheTs = 0;
const ORG_STATUS_TTL = 30000;

const getOrgStatus = async () => {
  const now = Date.now();
  if (orgStatusCache && now - orgStatusCacheTs < ORG_STATUS_TTL) return orgStatusCache;
  try {
    const snap = await db.collection("organizations").doc(getOrgId()).get();
    orgStatusCache = snap.exists ? snap.data() : {};
    orgStatusCacheTs = now;
    return orgStatusCache;
  } catch (err) {
    console.error("Error loading org status:", err.message);
    return orgStatusCache || {};
  }
};

// ==================== CACHE ====================
let messagesCache = {};
let cacheTimestamp = 0;
const CACHE_TTL = 60000;

let flowsCache = null;
let flowsCacheTimestamp = 0;

let menuCache = null;
let menuCacheTimestamp = 0;

let keywordsCache = null;
let keywordsCacheTimestamp = 0;

const clearCache = () => {
  messagesCache = {};
  cacheTimestamp = 0;
  flowsCache = null;
  flowsCacheTimestamp = 0;
  menuCache = null;
  menuCacheTimestamp = 0;
  keywordsCache = null;
  keywordsCacheTimestamp = 0;
};

// ==================== BOT MESSAGES ====================
const loadBotMessages = async () => {
  const now = Date.now();
  if (now - cacheTimestamp < CACHE_TTL && Object.keys(messagesCache).length > 0) {
    return messagesCache;
  }
  try {
    const snapshot = await getOrgRef().collection("botMessages").get();
    const messages = {};
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      messages[data.key] = data.content;
    });
    messagesCache = messages;
    cacheTimestamp = now;
    return messages;
  } catch (error) {
    console.error("Error loading bot messages:", error);
    return messagesCache;
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
  const now = Date.now();
  if (flowsCache && now - flowsCacheTimestamp < CACHE_TTL) {
    return flowsCache;
  }
  try {
    const snapshot = await getOrgRef().collection("flows").get();
    const flows = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(f => f.active !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    flowsCache = flows;
    flowsCacheTimestamp = now;
    return flows;
  } catch (error) {
    console.error("Error loading flows:", error);
    return flowsCache || [];
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
  const now = Date.now();
  if (menuCache && now - menuCacheTimestamp < CACHE_TTL) {
    return menuCache;
  }
  try {
    const doc = await getOrgRef().collection("config").doc("menu").get();
    if (doc.exists) {
      menuCache = doc.data();
      menuCacheTimestamp = now;
      return menuCache;
    }
    return null;
  } catch (error) {
    console.error("Error loading menu config:", error);
    return menuCache;
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
    await getOrgRef().collection(collectionName).doc(docId).update({
      status: 'cancelled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('Error cancelling appointment:', err.message);
    throw err;
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
  const now = Date.now();
  if (keywordsCache && now - keywordsCacheTimestamp < CACHE_TTL) {
    return keywordsCache;
  }
  try {
    const doc = await getOrgRef().collection("config").doc("keywords").get();
    keywordsCache = doc.exists ? (doc.data().keywords || []) : [];
    keywordsCacheTimestamp = now;
    return keywordsCache;
  } catch (error) {
    console.error("Error loading keywords:", error);
    return keywordsCache || [];
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
  lookupCollectionByField,
  getOrgStatus,
  clearCache
};
