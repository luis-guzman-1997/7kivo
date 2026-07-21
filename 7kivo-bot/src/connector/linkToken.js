// Token de un solo enlace para compartir la vinculación del conector (QR) con el
// cliente sin darle acceso al panel. Se guarda en Firestore para sobrevivir a los
// redeploys de Railway: organizations/<orgId>/config/connectorLink { token, expiresAt }.

const crypto = require("crypto");
const { db } = require("../config/firebase");

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

const ref = (orgId) =>
  db.collection("organizations").doc(orgId).collection("config").doc("connectorLink");

// Genera un token nuevo (invalida el anterior) y lo persiste.
async function createLinkToken(orgId, ttlMs = DEFAULT_TTL_MS) {
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + ttlMs;
  await ref(orgId).set({ token, expiresAt, updatedAt: Date.now() }, { merge: true });
  return { token, expiresAt };
}

// Valida el token contra Firestore (existe, coincide y no venció).
async function checkLinkToken(orgId, token) {
  if (!orgId || !token) return false;
  try {
    const snap = await ref(orgId).get();
    if (!snap.exists) return false;
    const d = snap.data() || {};
    if (!d.token || d.token !== token) return false;
    if (d.expiresAt && Date.now() > d.expiresAt) return false;
    return true;
  } catch {
    return false;
  }
}

module.exports = { createLinkToken, checkLinkToken };
