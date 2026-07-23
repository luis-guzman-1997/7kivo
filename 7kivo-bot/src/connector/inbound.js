// Traduce mensajes entrantes de Baileys a un payload con FORMA de webhook de
// Meta y los inyecta en requestMessageMulti(). Así toda la lógica de flujos,
// menús, citas y CRM se reutiliza sin cambios: el controlador no sabe (ni le
// importa) si el mensaje vino de Meta o del conector.
//
// Pieza clave — puente de menús numerados: si la org tiene un menú pendiente
// (pintado como texto numerado por outbound.js) y el usuario responde con un
// número/título, lo convertimos en un payload "interactive" forma-Meta para que
// handleInteractiveResponse lo procese igual que un botón real de Meta.

const {
  getPendingMenu,
  clearPendingMenu,
  matchMenuChoice,
  setJid,
  setLidPhone,
  getLidPhone,
} = require("./menuState");
const { runWithOrgId } = require("../config/requestContext");
const { wasSentByBot } = require("./botSentTracker");

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// jid -> phone "limpio" para usar como clave de conversación.
const jidToPhone = (jid) => {
  if (!jid) return "";
  return String(jid).split("@")[0].split(":")[0];
};

// Resuelve el número REAL (MSISDN) del contacto a partir del msg de Baileys.
// Con direccionamiento @lid, remoteJid es un LID (no el teléfono): el número real
// viene en msg.key.senderPn en los mensajes entrantes. Se cachea LID→número para
// poder resolverlo también en mensajes fromMe (operador). Fallback al valor del
// jid (comportamiento previo) si no hay forma de resolverlo → sin regresión.
const resolvePhone = (orgId, msg) => {
  const remoteJid = msg.key?.remoteJid || "";
  const raw = jidToPhone(remoteJid);
  if (!remoteJid.endsWith("@lid")) return raw; // direccionamiento normal (@s.whatsapp.net)

  // Entrante: senderPn trae el número real → usar y cachear.
  if (!msg.key?.fromMe && msg.key?.senderPn) {
    const pn = jidToPhone(msg.key.senderPn);
    if (pn) {
      setLidPhone(orgId, raw, pn);
      return pn;
    }
  }
  // fromMe o sin senderPn: intentar el cache LID→número.
  const cached = getLidPhone(orgId, raw);
  if (cached) return cached;

  // No se pudo resolver: log para diagnóstico (¿senderPn ausente en este rollout?).
  console.log(
    `[connector:${orgId}] @lid sin resolver: lid=${raw} senderPn=${msg.key?.senderPn || "-"} senderLid=${msg.key?.senderLid || "-"} fromMe=${!!msg.key?.fromMe}`
  );
  return raw; // fallback: se guarda el LID (como antes)
};

// Desenvuelve mensajes efímeros / viewOnce que anidan el contenido real.
const unwrap = (message) => {
  if (!message) return message;
  if (message.ephemeralMessage) return unwrap(message.ephemeralMessage.message);
  if (message.viewOnceMessage) return unwrap(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2) return unwrap(message.viewOnceMessageV2.message);
  if (message.documentWithCaptionMessage)
    return unwrap(message.documentWithCaptionMessage.message);
  return message;
};

// Extrae { text, interactiveId, interactiveTitle, mediaType } de un msg Baileys.
const extractContent = (rawMessage) => {
  const m = unwrap(rawMessage);
  if (!m) return {};

  // Respuestas a botones/listas NATIVOS (por si algún cliente sí los renderiza)
  if (m.buttonsResponseMessage) {
    return {
      interactiveId: m.buttonsResponseMessage.selectedButtonId,
      interactiveTitle: m.buttonsResponseMessage.selectedDisplayText,
    };
  }
  if (m.listResponseMessage) {
    return {
      interactiveId:
        m.listResponseMessage.singleSelectReply?.selectedRowId,
      interactiveTitle: m.listResponseMessage.title,
    };
  }
  if (m.templateButtonReplyMessage) {
    return {
      interactiveId: m.templateButtonReplyMessage.selectedId,
      interactiveTitle: m.templateButtonReplyMessage.selectedDisplayText,
    };
  }

  // Texto
  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    "";
  if (text) return { text };

  // Multimedia → mapeamos a un tipo "Meta" con los detalles que el controlador lee.
  if (m.imageMessage) return { mediaType: "image", media: { caption: m.imageMessage.caption || "" } };
  if (m.audioMessage) return { mediaType: m.audioMessage.ptt ? "voice" : "audio", media: { duration: m.audioMessage.seconds ?? null } };
  if (m.videoMessage) return { mediaType: "video", media: { caption: m.videoMessage.caption || "" } };
  if (m.documentMessage) return { mediaType: "document", media: { fileName: m.documentMessage.fileName || "" } };
  if (m.stickerMessage) return { mediaType: "sticker", media: {} };
  if (m.locationMessage) {
    return {
      mediaType: "location",
      location: {
        latitude: m.locationMessage.degreesLatitude,
        longitude: m.locationMessage.degreesLongitude,
        name: m.locationMessage.name,
        address: m.locationMessage.address,
      },
    };
  }
  if (m.contactMessage || m.contactsArrayMessage) return { mediaType: "contacts" };
  return {};
};

// Construye un payload con forma de webhook de Meta.
// Omitimos metadata.phone_number_id a propósito: el controlador solo valida ese
// campo contra waConfig.phoneNumberId si existe, y en orgs conector no lo hay.
const buildMetaBody = ({ phone, id, contactName, message }) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: {},
            contacts: contactName
              ? [{ profile: { name: contactName }, wa_id: phone }]
              : [{ wa_id: phone }],
            messages: [{ from: phone, id, timestamp: `${Math.floor(Date.now() / 1000)}`, ...message }],
          },
        },
      ],
    },
  ],
});

// res falso: requestMessageMulti solo usa sendStatus()/status().send().
const makeFakeRes = () => {
  const noop = () => fake;
  const fake = {
    sendStatus: noop,
    send: noop,
    json: noop,
    status: () => ({ send: noop, json: noop, sendStatus: noop }),
  };
  return fake;
};

const handleIncoming = async (orgId, sock, msg) => {
  const remoteJid = msg.key?.remoteJid;
  if (!remoteJid) return;
  if (remoteJid === "status@broadcast") return;
  if (remoteJid.endsWith("@g.us")) return; // ignorar grupos
  if (remoteJid.endsWith("@newsletter")) return;

  const phone = resolvePhone(orgId, msg);
  if (!phone) return;

  // ── Mensajes fromMe (el número del conector es compartido) ──
  if (msg.key.fromMe) {
    // Eco de un envío del propio bot → ignorar.
    if (wasSentByBot(msg.key.id)) return;
    // Mensaje escrito por el OPERADOR desde el teléfono.
    const { text: opText } = extractContent(msg.message);
    const cmd = (opText || "").trim().toLowerCase();
    const { setConversationMode } = require("../services/conversationService");
    if (cmd === "/yo") {
      // Toma de control PERMANENTE: el bot no responde hasta /bot.
      await runWithOrgId(orgId, () => setConversationMode(phone, "admin", { expiresAt: null }));
    } else if (cmd === "/bot") {
      // Devuelve el control al bot.
      await runWithOrgId(orgId, () => setConversationMode(phone, "bot"));
    } else {
      // Respuesta manual del operador → toma de control TEMPORAL (2 h).
      await runWithOrgId(orgId, () => setConversationMode(phone, "admin", { expiresAt: Date.now() + TWO_HOURS_MS }));
    }
    return;
  }

  setJid(orgId, phone, remoteJid); // recordar a dónde responder (memoria)
  // Persistir el jid REAL de destino (cubre @lid) para que sobreviva a los
  // redeploys: así las respuestas del bot y las campañas entregan al jid correcto
  // en vez de caer al fallback "<numero>@s.whatsapp.net" que WhatsApp no entrega.
  require("./jidStore").persistJid(orgId, phone, remoteJid).catch(() => {});

  // ── Modo de la conversación ──
  // Si está en 'admin' (/yo permanente o toma temporal vigente): NO guardar ni
  // responder. Si la toma temporal ya expiró, vuelve a 'bot' y se procesa normal.
  const dropMessage = await runWithOrgId(orgId, async () => {
    const { getConversation, setConversationMode } = require("../services/conversationService");
    const conv = await getConversation(phone);
    if (conv?.mode === "admin") {
      const exp = conv.modeExpiresAt;
      if (exp && Date.now() > exp) {
        await setConversationMode(phone, "bot"); // expiró la toma temporal
        return false;
      }
      return true; // toma vigente → descartar
    }
    return false;
  });
  if (dropMessage) return;

  const id = msg.key.id || `${Date.now()}`;
  const contactName = msg.pushName || null;
  const { text, interactiveId, interactiveTitle, mediaType, location, media } =
    extractContent(msg.message);

  let message = null;

  // 1) Botón/lista nativo → interactive directo
  if (interactiveId) {
    message = {
      type: "interactive",
      interactive: { button_reply: { id: interactiveId, title: interactiveTitle || interactiveId } },
    };
  } else if (text) {
    // 2) Puente de menú numerado: ¿hay un menú pendiente y el texto lo resuelve?
    const pending = getPendingMenu(orgId, phone);
    const choice = pending ? matchMenuChoice(pending, text) : null;
    if (choice) {
      clearPendingMenu(orgId, phone);
      message = {
        type: "interactive",
        interactive: { button_reply: { id: choice.id, title: choice.title } },
      };
    } else {
      // 3) Texto normal (al escribir texto libre, descartamos el menú pendiente)
      if (pending) clearPendingMenu(orgId, phone);
      message = { type: "text", text: { body: text } };
    }
  } else if (mediaType === "location") {
    message = {
      type: "location",
      location: {
        latitude: location?.latitude,
        longitude: location?.longitude,
        ...(location?.name ? { name: location.name } : {}),
        ...(location?.address ? { address: location.address } : {}),
      },
    };
  } else if (mediaType) {
    // Registramos el mensaje Baileys para que mediaService pueda descargarlo
    // bajo demanda (image_input en flujos, media en modo admin, etc.).
    const { register } = require("./mediaStore");
    const normalized = { key: msg.key, message: unwrap(msg.message) };
    const mediaRef = register(orgId, normalized);
    const node = { id: mediaRef };
    if (media?.caption) node.caption = media.caption;
    if (media?.duration !== undefined && media?.duration !== null) node.duration = media.duration;
    if (media?.fileName) node.filename = media.fileName;
    message = { type: mediaType, [mediaType]: node };
  } else {
    return; // nada procesable
  }

  const body = buildMetaBody({ phone, id, contactName, message });
  const { requestMessageMulti } = require("../controllers/messagesController");
  await requestMessageMulti({ params: { orgId }, body, query: {} }, makeFakeRes());
};

module.exports = { handleIncoming, jidToPhone };
