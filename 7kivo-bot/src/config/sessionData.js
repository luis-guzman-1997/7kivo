const { db, admin } = require("./firebase");
const { getOrgId } = require("./orgConfig");

// Sessions expire from local cache (and are treated as stale from Firestore) after 2 hours of inactivity.
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

const localCache = {};

const getConvRef = (phone) => {
  return db.collection("organizations").doc(getOrgId())
    .collection("conversations").doc(phone.replace(/\D/g, ""));
};

function isExpired(session) {
  if (!session?.last_message_time) return false;
  return Date.now() - new Date(session.last_message_time).getTime() > SESSION_TTL_MS;
}

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
  const session = localCache[phone];
  if (!session) return null;
  if (isExpired(session)) {
    delete localCache[phone];
    return null;
  }
  return session;
}

async function getSessionAsync(phone) {
  // Check local cache first (already TTL-checked via getSession)
  const cached = getSession(phone);
  if (cached) return cached;

  try {
    const doc = await getConvRef(phone).get();
    if (doc.exists && doc.data()?.session) {
      const session = { ...doc.data().session, phone };
      // Don't restore sessions that are too old — user gets a fresh greeting
      if (isExpired(session)) return null;
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

// Periodic cleanup: remove expired sessions from local cache every 30 minutes
setInterval(() => {
  const expired = Object.keys(localCache).filter(phone => isExpired(localCache[phone]));
  expired.forEach(phone => delete localCache[phone]);
  if (expired.length > 0) {
    console.log(`[session] Cleaned ${expired.length} expired session(s) from local cache.`);
  }
}, 30 * 60 * 1000);

module.exports = {
  setSession,
  getSession,
  getSessionAsync,
  clearSession,
  getAllSessions,
};
