const { db } = require("../config/firebase");
const { getOrgId } = require("../config/orgConfig");

const getOrgRef = () => {
  return db.collection("organizations").doc(getOrgId());
};

// ==================== CACHE ====================
let messagesCache = {};
let cacheTimestamp = 0;
const CACHE_TTL = 60000;

let flowsCache = null;
let flowsCacheTimestamp = 0;

let menuCache = null;
let menuCacheTimestamp = 0;

const clearCache = () => {
  messagesCache = {};
  cacheTimestamp = 0;
  flowsCache = null;
  flowsCacheTimestamp = 0;
  menuCache = null;
  menuCacheTimestamp = 0;
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
  getCollectionItems,
  getCollectionItem,
  getCollectionDef,
  saveFlowSubmission,
  clearCache
};
