const { db, admin } = require("../config/firebase");
const { getOrgId } = require("../config/orgConfig");

const getOrgRef = () => db.collection("organizations").doc(getOrgId());

const getConversationRef = (phoneNumber) => {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  return getOrgRef().collection("conversations").doc(cleanPhone);
};

const saveMessage = async (phoneNumber, text, from, extra = {}) => {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  const convRef = getConversationRef(cleanPhone);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const convUpdate = {
    phoneNumber: cleanPhone,
    lastMessageAt: now,
    updatedAt: now
  };

  if (from === "user") {
    convUpdate.lastUserMessageAt = now;
    convUpdate.lastUserMessageMs = Date.now();
    convUpdate.unreadCount = admin.firestore.FieldValue.increment(1);
  }

  if (extra.contactName) {
    convUpdate.contactName = extra.contactName;
  }

  await convRef.set(convUpdate, { merge: true });

  const msgData = {
    from,
    text,
    timestamp: now,
    createdMs: Date.now()
  };

  if (extra.adminEmail) msgData.adminEmail = extra.adminEmail;
  if (extra.adminName) msgData.adminName = extra.adminName;
  if (extra.type) msgData.type = extra.type;
  if (extra.mediaId) msgData.mediaId = extra.mediaId;
  if (extra.imageUrl) msgData.imageUrl = extra.imageUrl;
  if (extra.audioUrl) msgData.audioUrl = extra.audioUrl;
  if (extra.duration != null) msgData.duration = extra.duration;

  await convRef.collection("messages").add(msgData);
};

// ==================== MODE MANAGEMENT ====================

const getConversationMode = async (phoneNumber) => {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  const doc = await getConversationRef(cleanPhone).get();
  if (!doc.exists) return "bot";
  return doc.data()?.mode || "bot";
};

const setConversationMode = async (phoneNumber, mode, extra = {}) => {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  const update = {
    mode,
    modeChangedAt: admin.firestore.FieldValue.serverTimestamp(),
    modeChangedMs: Date.now()
  };
  if (extra.adminEmail) update.modeAdminEmail = extra.adminEmail;
  if (extra.adminName) update.modeAdminName = extra.adminName;

  await getConversationRef(cleanPhone).set(update, { merge: true });
};

// ==================== QUERIES ====================

const getConversations = async () => {
  const snapshot = await getOrgRef()
    .collection("conversations")
    .orderBy("lastMessageAt", "desc")
    .get();

  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
};

const getMessages = async (phoneNumber, limitCount = 50) => {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  const snapshot = await getConversationRef(cleanPhone)
    .collection("messages")
    .orderBy("timestamp", "asc")
    .limitToLast(limitCount)
    .get();

  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
};

const markAsRead = async (phoneNumber) => {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  await getConversationRef(cleanPhone).update({ unreadCount: 0 });
};

const getConversation = async (phoneNumber) => {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  const doc = await getConversationRef(cleanPhone).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
};

module.exports = {
  saveMessage,
  getConversationMode,
  setConversationMode,
  getConversations,
  getMessages,
  markAsRead,
  getConversation
};
