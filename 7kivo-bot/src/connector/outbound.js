// Envío de mensajes vía el socket Baileys de la org (modo conector).
//
// Mantiene la MISMA firma conceptual que messageModel (texto, botones, listas,
// imagen, audio, CTA) pero traduce a lo que Baileys soporta de forma confiable:
// - texto e imagen: nativos
// - botones y listas: se degradan a TEXTO NUMERADO + se registra el mapeo
//   número→id en menuState para que la respuesta del usuario se reinterprete
//   como un botón (ver inbound.js).

const { getSock } = require("./sessionManager");
const { setPendingMenu, getJid, setJid } = require("./menuState");
const { markSent } = require("./botSentTracker");
const { loadJid, persistJid } = require("./jidStore");

// Envía por Baileys y registra el id (para distinguir ecos del bot de mensajes
// manuales del operador en inbound.js).
const send = async (sock, jid, content) => {
  try {
    const r = await sock.sendMessage(jid, content);
    markSent(r?.key?.id);
    console.log(`[connector:OUT] enviado a ${jid} id=${r?.key?.id || "?"}`);
    return r;
  } catch (e) {
    console.log(`[connector:OUT] ERROR enviando a ${jid}: ${e.message}`);
    throw e;
  }
};

const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

// A dónde responder. WhatsApp migró contactos a @lid: hay que enviar al jid @lid
// real, no a "<numero>@s.whatsapp.net" (que acepta pero no entrega). Orden:
//   1) cache en memoria (el jid del que recibimos en esta sesión),
//   2) jid persistido en Firestore (de una conversación previa, sobrevive redeploys),
//   3) resolución en vivo con onWhatsApp (incluye el lid si el contacto está migrado),
//   4) fallback estándar "<numero>@s.whatsapp.net".
const resolveJid = async (orgId, phone) => {
  const cached = getJid(orgId, phone);
  if (cached) {
    console.log(`[connector:OUT] resolveJid ${phone} → ${cached} (memoria)`);
    return cached;
  }

  const persisted = await loadJid(orgId, phone);
  if (persisted) {
    setJid(orgId, phone, persisted);
    console.log(`[connector:OUT] resolveJid ${phone} → ${persisted} (Firestore)`);
    return persisted;
  }

  // Sin historial (p.ej. campaña a un número que nunca escribió): preguntar a WA.
  try {
    const sock = getSock(orgId);
    const digits = onlyDigits(phone);
    if (sock && digits) {
      const res = await sock.onWhatsApp(digits);
      const hit = Array.isArray(res) ? res[0] : null;
      // Preferir el lid (destino real para contactos migrados) sobre el jid clásico.
      const jid = hit && (hit.lid || hit.jid);
      if (jid) {
        setJid(orgId, phone, jid);
        persistJid(orgId, phone, jid).catch(() => {});
        console.log(`[connector:OUT] resolveJid ${phone} → ${jid} (onWhatsApp lid=${hit.lid || "-"} jid=${hit.jid || "-"})`);
        return jid;
      }
      console.log(`[connector:OUT] resolveJid ${phone}: onWhatsApp sin resultado`);
    }
  } catch (e) {
    console.log(`[connector:OUT] resolveJid ${phone}: onWhatsApp error ${e.message}`);
  }

  const fb = `${onlyDigits(phone)}@s.whatsapp.net`;
  console.log(`[connector:OUT] resolveJid ${phone} → ${fb} (FALLBACK @s.whatsapp.net — puede NO entregar si el contacto está en @lid)`);
  return fb;
};

const requireSock = (orgId) => {
  const sock = getSock(orgId);
  if (!sock) {
    console.log(`[connector:OUT] SIN SOCKET para ${orgId} (sesión no conectada) → no se puede enviar`);
    throw new Error(`Sesión conector de ${orgId} no está conectada`);
  }
  return sock;
};

const sendText = async (orgId, phone, text) => {
  const sock = requireSock(orgId);
  const jid = await resolveJid(orgId, phone);
  return send(sock, jid, { text: String(text ?? "") });
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
// En conector las opciones se pintan como texto numerado; mostramos SOLO el
// título (incluir la descripción satura el mensaje y se ve mal).
const sendList = async (orgId, phone, text, sections) => {
  const options = [];
  (sections || []).forEach((sec) => {
    (sec.rows || []).forEach((r) =>
      options.push({ id: r.id, title: r.title })
    );
  });
  return sendOptionsAsText(orgId, phone, text, options);
};

const sendImage = async (orgId, phone, imageUrl, caption) => {
  const sock = requireSock(orgId);
  const jid = await resolveJid(orgId, phone);
  // Baileys descarga la imagen desde la URL directamente.
  return send(sock, jid, {
    image: { url: imageUrl },
    caption: caption || "",
  });
};

const sendAudio = async (orgId, phone, audioUrl) => {
  const sock = requireSock(orgId);
  const jid = await resolveJid(orgId, phone);
  return send(sock, jid, {
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
