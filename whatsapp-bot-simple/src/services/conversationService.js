const { db, admin } = require("../config/firebase");
const { getSchoolId } = require("../config/schoolConfig");

const getSchoolRef = () => db.collection("schools").doc(getSchoolId());

const getConversationRef = (phoneNumber) => {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  return getSchoolRef().collection("conversations").doc(cleanPhone);
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
    await convRef.set(convUpdate, { merge: true });
    await convRef.update({
      unreadCount: admin.firestore.FieldValue.increment(1)
    });
  } else {
    await convRef.set(convUpdate, { merge: true });
  }

  if (extra.contactName) {
    await convRef.update({ contactName: extra.contactName });
  }

  const msgData = {
    from,
    text,
    timestamp: now,
    createdMs: Date.now()
  };

  if (extra.adminEmail) msgData.adminEmail = extra.adminEmail;
  if (extra.adminName) msgData.adminName = extra.adminName;

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
  const snapshot = await getSchoolRef()
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
