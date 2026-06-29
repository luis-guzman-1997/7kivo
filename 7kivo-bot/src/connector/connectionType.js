// Resuelve el canal de una org: 'meta' (Cloud API oficial, por defecto) o
// 'connector' (Baileys). El valor vive en config/whatsapp.connectionType.
// Retrocompatible: si no existe el campo, es 'meta'.
//
// Cachea por orgId (TTL corto) para no leer Firestore en cada mensaje saliente.

const { getContextOrgId } = require("../config/requestContext");

const cache = {}; // orgId -> { value, ts }
const TTL = 60000; // 1 min

const resolveOrgId = () => {
  const ctx = getContextOrgId();
  if (ctx) return ctx;
  return process.env.ORG_ID || process.env.SCHOOL_ID || "_default";
};

const getConnectionType = async (orgId) => {
  const id = orgId || resolveOrgId();
  const cached = cache[id];
  if (cached && Date.now() - cached.ts < TTL) return cached.value;

  let value = "meta";
  try {
    const { getWhatsAppConfig } = require("../services/botMessagesService");
    const wa = await getWhatsAppConfig();
    if (wa?.connectionType === "connector") value = "connector";
  } catch (e) {
    // ante la duda, Meta (comportamiento actual)
  }
  cache[id] = { value, ts: Date.now() };
  return value;
};

const isConnector = async (orgId) => (await getConnectionType(orgId)) === "connector";

// Invalida el caché (al cambiar el tipo desde el panel).
const invalidate = (orgId) => {
  if (orgId) delete cache[orgId];
  else Object.keys(cache).forEach((k) => delete cache[k]);
};

module.exports = { getConnectionType, isConnector, invalidate };
