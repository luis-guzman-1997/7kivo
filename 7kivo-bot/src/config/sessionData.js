const { db, admin } = require("./firebase");
const { getOrgId } = require("./orgConfig");

const localCache = {};

const getConvRef = (phone) => {
  return db.collection("organizations").doc(getOrgId())
    .collection("conversations").doc(phone.replace(/\D/g, ""));
};

function setSession(phone, data) {
  const prev = localCache[phone] || {};
  const merged = {
    ...prev,
    ...data,
    phone,
    last_message_time: new Date().toISOString()
  };
  localCache[phone] = merged;

  const sessionForFirestore = { ...merged };
  delete sessionForFirestore.phone;

  getConvRef(phone).set({ session: sessionForFirestore }, { merge: true })
    .catch(err => console.error("Error syncing session to Firestore:", err.message));
}

function getSession(phone) {
  return localCache[phone] || null;
}

async function getSessionAsync(phone) {
  if (localCache[phone]) return localCache[phone];

  try {
    const doc = await getConvRef(phone).get();
    if (doc.exists && doc.data()?.session) {
      const session = { ...doc.data().session, phone };
      localCache[phone] = session;
      return session;
    }
  } catch (err) {
    console.error("Error loading session from Firestore:", err.message);
  }
  return null;
}

async function clearSession(phone) {
  delete localCache[phone];

  try {
    await getConvRef(phone).set({
      session: admin.firestore.FieldValue.delete()
    }, { merge: true });
  } catch (err) {
    console.error("Error clearing session in Firestore:", err.message);
  }
}

function getAllSessions() {
  return { ...localCache };
}

module.exports = {
  setSession,
  getSession,
  getSessionAsync,
  clearSession,
  getAllSessions,
};
