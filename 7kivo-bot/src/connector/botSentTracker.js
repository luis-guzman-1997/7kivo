// Registro de IDs de mensajes que envió el PROPIO bot por Baileys.
//
// En conector, el número está compartido: tanto los mensajes del bot como los
// que escribe el operador desde su teléfono llegan como `fromMe`. Para no
// confundir un envío del bot con una respuesta manual del operador (que activa
// la toma de control), registramos aquí cada id que envía el bot y lo
// "consumimos" cuando vuelve como eco en messages.upsert.

const ids = new Set();
const MAX = 3000;

const markSent = (id) => {
  if (!id) return;
  if (ids.size >= MAX) ids.clear(); // backstop de memoria (los ecos se consumen al instante)
  ids.add(id);
};

// Devuelve true si el id corresponde a un envío del bot (y lo consume).
const wasSentByBot = (id) => {
  if (!id) return false;
  if (ids.has(id)) {
    ids.delete(id);
    return true;
  }
  return false;
};

module.exports = { markSent, wasSentByBot };
