// Estado en memoria del "puente de menús numerados" del conector.
//
// En modo conector los botones/listas de WhatsApp no se renderizan de forma
// confiable (Meta los limita en clientes no oficiales). Por eso los pintamos
// como texto numerado ("1. ... 2. ...") y guardamos el mapeo número→buttonId.
// Cuando el usuario responde "2", inbound.js convierte ese texto en un payload
// interactivo forma-Meta usando este mapeo, y la lógica de flujos existente
// (handleInteractiveResponse) funciona sin cambios.
//
// También cacheamos el jid real de cada teléfono (para responder al mismo
// destino aunque WhatsApp use @lid en vez de @s.whatsapp.net).

const TTL = 10 * 60 * 1000; // 10 min: una sesión de flujo no debería durar más

// { [orgId]: { [phone]: { options: [{n,id,title}], ts } } }
const pendingMenus = {};
// { [orgId]: { [phone]: jid } }
const jidCache = {};

const setPendingMenu = (orgId, phone, options) => {
  if (!pendingMenus[orgId]) pendingMenus[orgId] = {};
  pendingMenus[orgId][phone] = { options, ts: Date.now() };
};

const getPendingMenu = (orgId, phone) => {
  const entry = pendingMenus[orgId]?.[phone];
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL) {
    delete pendingMenus[orgId][phone];
    return null;
  }
  return entry.options;
};

const clearPendingMenu = (orgId, phone) => {
  if (pendingMenus[orgId]) delete pendingMenus[orgId][phone];
};

// Normaliza texto: minúsculas y sin acentos (rango Unicode de marcas combinantes).
const norm = (s) =>
  String(s)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Dado el texto que escribió el usuario, intenta resolverlo contra el menú
// pendiente. Acepta: el número ("2"), o el título exacto (insensible a
// mayúsculas/acentos).
const matchMenuChoice = (options, text) => {
  if (!options || !options.length) return null;
  const t = String(text).trim();
  // Por número
  const num = parseInt(t, 10);
  if (!isNaN(num)) {
    const byNum = options.find((o) => o.n === num);
    if (byNum) return byNum;
  }
  // Por título
  const byTitle = options.find((o) => norm(o.title) === norm(t));
  return byTitle || null;
};

const setJid = (orgId, phone, jid) => {
  if (!jidCache[orgId]) jidCache[orgId] = {};
  jidCache[orgId][phone] = jid;
};

const getJid = (orgId, phone) => jidCache[orgId]?.[phone] || null;

const clearOrgState = (orgId) => {
  delete pendingMenus[orgId];
  delete jidCache[orgId];
};

module.exports = {
  setPendingMenu,
  getPendingMenu,
  clearPendingMenu,
  matchMenuChoice,
  setJid,
  getJid,
  clearOrgState,
};
