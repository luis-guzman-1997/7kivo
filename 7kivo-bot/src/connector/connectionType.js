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

// Estado del canal de la org, cacheado: { value: 'meta'|'connector', flowsEnabled }.
// flowsEnabled solo es relevante para connector (default true).
const getConnectorState = async (orgId) => {
  const id = orgId || resolveOrgId();
  const cached = cache[id];
  if (cached && Date.now() - cached.ts < TTL) return cached;

  let value = "meta";
  let flowsEnabled = true;
  try {
    const { getWhatsAppConfig } = require("../services/botMessagesService");
    const wa = await getWhatsAppConfig();
    if (wa?.connectionType === "connector") value = "connector";
    if (wa?.flowsEnabled === false) flowsEnabled = false;
  } catch (e) {
    // ante la duda, Meta con flujos activos (comportamiento actual)
  }
  const state = { value, flowsEnabled, ts: Date.now() };
  cache[id] = state;
  return state;
};

const getConnectionType = async (orgId) => (await getConnectorState(orgId)).value;

const isConnector = async (orgId) => (await getConnectorState(orgId)).value === "connector";

// Invalida el caché (al cambiar el tipo desde el panel).
const invalidate = (orgId) => {
  if (orgId) delete cache[orgId];
  else Object.keys(cache).forEach((k) => delete cache[k]);
};

module.exports = { getConnectionType, getConnectorState, isConnector, invalidate };
