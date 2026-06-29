// Envío de mensajes vía el socket Baileys de la org (modo conector).
//
// Mantiene la MISMA firma conceptual que messageModel (texto, botones, listas,
// imagen, audio, CTA) pero traduce a lo que Baileys soporta de forma confiable:
// - texto e imagen: nativos
// - botones y listas: se degradan a TEXTO NUMERADO + se registra el mapeo
//   número→id en menuState para que la respuesta del usuario se reinterprete
//   como un botón (ver inbound.js).

const { getSock } = require("./sessionManager");
const { setPendingMenu, getJid } = require("./menuState");

const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

// A dónde responder: el jid exacto del que recibimos (cubre @lid) o, si no lo
// tenemos cacheado, el formato estándar número@s.whatsapp.net.
const jidFor = (orgId, phone) =>
  getJid(orgId, phone) || `${onlyDigits(phone)}@s.whatsapp.net`;

const requireSock = (orgId) => {
  const sock = getSock(orgId);
  if (!sock) {
    throw new Error(`Sesión conector de ${orgId} no está conectada`);
  }
  return sock;
};

const sendText = async (orgId, phone, text) => {
  const sock = requireSock(orgId);
  return sock.sendMessage(jidFor(orgId, phone), { text: String(text ?? "") });
};

// Pinta opciones como texto numerado y guarda el mapeo para el puente de menús.
// options: [{ id, title }]
const sendOptionsAsText = async (orgId, phone, bodyText, options) => {
  const opts = (options || [])
    .filter((o) => o && o.id)
    .map((o, i) => ({ n: i + 1, id: o.id, title: o.title || `Opción ${i + 1}` }));

  if (!opts.length) {
    return sendText(orgId, phone, bodyText || "");
  }

  setPendingMenu(orgId, phone, opts);
  const lines = opts.map((o) => `*${o.n}.* ${o.title}`).join("\n");
  const full = `${bodyText ? bodyText + "\n\n" : ""}${lines}\n\n_Responde con el número de la opción._`;
  return sendText(orgId, phone, full);
};

// buttons: [{ id, title }]  (forma de messageModel.sendInteractiveButtons)
const sendButtons = async (orgId, phone, text, buttons) =>
  sendOptionsAsText(orgId, phone, text, buttons);

// sections: [{ title, rows: [{ id, title, description }] }]
const sendList = async (orgId, phone, text, sections) => {
  const options = [];
  (sections || []).forEach((sec) => {
    (sec.rows || []).forEach((r) =>
      options.push({
        id: r.id,
        title: r.description ? `${r.title} — ${r.description}` : r.title,
      })
    );
  });
  return sendOptionsAsText(orgId, phone, text, options);
};

const sendImage = async (orgId, phone, imageUrl, caption) => {
  const sock = requireSock(orgId);
  // Baileys descarga la imagen desde la URL directamente.
  return sock.sendMessage(jidFor(orgId, phone), {
    image: { url: imageUrl },
    caption: caption || "",
  });
};

const sendAudio = async (orgId, phone, audioUrl) => {
  const sock = requireSock(orgId);
  return sock.sendMessage(jidFor(orgId, phone), {
    audio: { url: audioUrl },
    mimetype: "audio/ogg; codecs=opus",
    ptt: true,
  });
};

// CTA URL: Baileys no tiene botón CTA confiable → texto con el enlace.
const sendCtaUrl = async (orgId, phone, text, url, buttonLabel) => {
  const label = buttonLabel ? `${buttonLabel}: ` : "";
  return sendText(orgId, phone, `${text ? text + "\n\n" : ""}${label}${url}`);
};

// Imagen + un solo botón → imagen con caption y la opción como texto numerado.
const sendImageButton = async (orgId, phone, imageUrl, text, buttonId, buttonTitle) => {
  if (imageUrl) {
    await sendImage(orgId, phone, imageUrl, "");
  }
  return sendOptionsAsText(orgId, phone, text, [{ id: buttonId, title: buttonTitle }]);
};

module.exports = {
  sendText,
  sendButtons,
  sendList,
  sendImage,
  sendAudio,
  sendCtaUrl,
  sendImageButton,
};
