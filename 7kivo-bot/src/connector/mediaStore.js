// Registro efímero de mensajes Baileys con media entrante.
//
// El controlador descarga media llamando a downloadAndUploadMedia(mediaId). En
// Meta ese id es de la Graph API; en conector NO existe. Para no tocar el
// controlador, inbound.js registra aquí el mensaje Baileys y genera un id
// sintético "connector:<orgId>:<msgId>". Cuando el controlador pide descargar
// ese id, mediaService lo resuelve contra este registro y baja el binario por
// downloadMediaMessage de Baileys.

const TTL = 10 * 60 * 1000; // 10 min

const store = {}; // ref -> { orgId, msg, ts }

const prune = () => {
  const now = Date.now();
  for (const ref in store) {
    if (now - store[ref].ts > TTL) delete store[ref];
  }
};

// Registra un mensaje (ya normalizado: { key, message }) y devuelve su ref.
const register = (orgId, msg) => {
  prune();
  const id = msg?.key?.id || `${Date.now()}`;
  const ref = `connector:${orgId}:${id}`;
  store[ref] = { orgId, msg, ts: Date.now() };
  return ref;
};

const get = (ref) => {
  const entry = store[ref];
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL) {
    delete store[ref];
    return null;
  }
  return entry;
};

const isConnectorMediaRef = (ref) =>
  typeof ref === "string" && ref.startsWith("connector:");

module.exports = { register, get, isConnectorMediaRef };
