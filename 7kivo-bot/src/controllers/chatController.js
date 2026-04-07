const { sendTextMessage, sendImageMessage, sendAudioMessage } = require("../models/messageModel");
const { getGeneralConfig } = require("../services/botMessagesService");
const { sendPushToDeliveries } = require("../services/pushService");
const {
  saveMessage,
  getConversations,
  getMessages,
  markAsRead,
  getConversation,
  getConversationMode,
  setConversationMode
} = require("../services/conversationService");
const { clearSession } = require("../config/sessionData");

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

const listConversations = async (req, res) => {
  try {
    const conversations = await getConversations();
    return res.json({ ok: true, conversations });
  } catch (error) {
    console.error("Error listing conversations:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

const getConversationMessages = async (req, res) => {
  try {
    const { phone } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    const messages = await getMessages(phone, limit);
    const conversation = await getConversation(phone);

    let withinWindow = false;
    if (conversation?.lastUserMessageMs) {
      withinWindow = (Date.now() - conversation.lastUserMessageMs) < WINDOW_24H_MS;
    }

    await markAsRead(phone);

    return res.json({
      ok: true,
      messages,
      conversation,
      withinWindow,
      windowExpiresAt: conversation?.lastUserMessageMs
        ? conversation.lastUserMessageMs + WINDOW_24H_MS
        : null
    });
  } catch (error) {
    console.error("Error getting messages:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

const sendAdminMessage = async (req, res) => {
  try {
    const { phone, message, adminEmail, adminName } = req.body;

    if (!phone || !message) {
      return res.status(400).json({ ok: false, error: "phone and message are required" });
    }

    const conversation = await getConversation(phone);
    let withinWindow = false;
    if (conversation?.lastUserMessageMs) {
      withinWindow = (Date.now() - conversation.lastUserMessageMs) < WINDOW_24H_MS;
    }

    if (!withinWindow) {
      return res.status(403).json({
        ok: false,
        error: "24h_window_expired",
        message: "La ventana de 24 horas expiró. Debe contactar al usuario desde WhatsApp personal.",
        windowExpiredAt: conversation?.lastUserMessageMs
          ? new Date(conversation.lastUserMessageMs + WINDOW_24H_MS).toISOString()
          : null
      });
    }

    // Auto-switch to admin mode and clear bot session
    const currentMode = await getConversationMode(phone);
    if (currentMode !== "admin") {
      await clearSession(phone);
      await setConversationMode(phone, "admin", { adminEmail, adminName });
    }

    await sendTextMessage(message, phone);
    await saveMessage(phone, message, "admin", { adminEmail, adminName });

    return res.json({ ok: true, message: "Mensaje enviado correctamente" });
  } catch (error) {
    console.error("Error sending admin message:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

const takeControl = async (req, res) => {
  try {
    const { phone, adminEmail, adminName } = req.body;

    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    await clearSession(phone);
    await setConversationMode(phone, "admin", { adminEmail, adminName });

    return res.json({ ok: true, mode: "admin" });
  } catch (error) {
    console.error("Error taking control:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

const releaseToBot = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    // Solo enviar despedida si hubo mensajes del admin en esta conversación
    const conversation = await getConversation(phone);
    const messages = await getMessages(phone, 100);
    const adminSentMessages = messages.filter(m => m.from === "admin");

    if (adminSentMessages.length > 0) {
      const farewellMsg = "La conversación con nuestro equipo ha finalizado. ¡Gracias por comunicarte! 👋\n\nSi necesitas algo más, escribe *hola* para volver al menú.";
      try {
        await sendTextMessage(farewellMsg, phone);
        await saveMessage(phone, farewellMsg, "admin", { adminName: "Sistema" });
      } catch (msgErr) {
        // Ventana de 24h expirada u otro error de WA — continuamos de todas formas
        console.warn("releaseToBot: no se pudo enviar despedida:", msgErr.message);
      }
    }

    await clearSession(phone);
    await setConversationMode(phone, "bot");

    return res.json({ ok: true, mode: "bot" });
  } catch (error) {
    console.error("Error releasing to bot:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

const checkWindow = async (req, res) => {
  try {
    const { phone } = req.params;
    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    const conversation = await getConversation(phone);
    let withinWindow = false;
    let windowExpiresAt = null;

    if (conversation?.lastUserMessageMs) {
      const expiresAt = conversation.lastUserMessageMs + WINDOW_24H_MS;
      withinWindow = Date.now() < expiresAt;
      windowExpiresAt = expiresAt;
    }

    return res.json({
      ok: true,
      withinWindow,
      windowExpiresAt,
      mode: conversation?.mode || "bot"
    });
  } catch (error) {
    console.error("Error checking window:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

const sendAdminImage = async (req, res) => {
  try {
    const { phone, imageUrl, caption, adminEmail, adminName } = req.body;

    if (!phone || !imageUrl) {
      return res.status(400).json({ ok: false, error: "phone and imageUrl are required" });
    }

    const conversation = await getConversation(phone);
    let withinWindow = false;
    if (conversation?.lastUserMessageMs) {
      withinWindow = (Date.now() - conversation.lastUserMessageMs) < WINDOW_24H_MS;
    }

    if (!withinWindow) {
      return res.status(403).json({
        ok: false,
        error: "24h_window_expired",
        message: "La ventana de 24 horas expiró.",
        windowExpiredAt: conversation?.lastUserMessageMs
          ? new Date(conversation.lastUserMessageMs + WINDOW_24H_MS).toISOString()
          : null
      });
    }

    const currentMode = await getConversationMode(phone);
    if (currentMode !== "admin") {
      await clearSession(phone);
      await setConversationMode(phone, "admin", { adminEmail, adminName });
    }

    await sendImageMessage(imageUrl, caption || "", phone);
    await saveMessage(phone, caption || "📷 Foto", "admin", {
      adminEmail,
      adminName,
      type: "image",
      imageUrl
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("Error sending admin image:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

const sendAdminAudio = async (req, res) => {
  try {
    const { phone, audioUrl, duration, adminEmail, adminName } = req.body;

    if (!phone || !audioUrl) {
      return res.status(400).json({ ok: false, error: "phone and audioUrl are required" });
    }

    // Validate duration against org config
    const orgConfig = await getGeneralConfig().catch(() => ({}));
    const maxSeconds = orgConfig?.deliveryAudioMaxSeconds || 30;
    if (duration && duration > maxSeconds) {
      return res.status(400).json({ ok: false, error: "audio_too_long", maxSeconds });
    }

    const conversation = await getConversation(phone);
    let withinWindow = false;
    if (conversation?.lastUserMessageMs) {
      withinWindow = (Date.now() - conversation.lastUserMessageMs) < WINDOW_24H_MS;
    }

    if (!withinWindow) {
      return res.status(403).json({
        ok: false,
        error: "24h_window_expired",
        message: "La ventana de 24 horas expiró.",
        windowExpiredAt: conversation?.lastUserMessageMs
          ? new Date(conversation.lastUserMessageMs + WINDOW_24H_MS).toISOString()
          : null
      });
    }

    const currentMode = await getConversationMode(phone);
    if (currentMode !== "admin") {
      await clearSession(phone);
      await setConversationMode(phone, "admin", { adminEmail, adminName });
    }

    await sendAudioMessage(audioUrl, phone, duration || null);
    await saveMessage(phone, "🎵 Audio", "admin", {
      adminEmail,
      adminName,
      type: "audio",
      audioUrl,
      duration: duration || null,
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error("Error sending admin audio:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

const cancelDeliveryCase = async (req, res) => {
  try {
    const { phone, clientName, cancelCount, cancelReason, isPromoOrder } = req.body;
    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    const reasonLine = cancelReason ? `\n\n📋 *Motivo:* ${cancelReason}` : '';
    let msg;
    if (isPromoOrder) {
      msg = `Lo sentimos${clientName ? ' ' + clientName : ''} 😔\n\nEl Delivery asignado canceló tu solicitud. 🚗${reasonLine}\n\n🙏 Gracias por tu comprensión. ¡Te esperamos! 💚`;
    } else if (cancelCount >= 3) {
      msg = `Lo sentimos${clientName ? ' ' + clientName : ''} 😔\n\nEn este momento no tenemos ningún Delivery disponible para atender tu solicitud. 🚗${reasonLine}\n\n🔄 *Puedes volver a solicitarlo:* Escribe *hola* en cualquier momento y vuelve a elegir el servicio. Estaremos atentos para atenderte cuando lo solicites de nuevo. 👍\n\n🙏 Gracias por tu comprensión. ¡Te esperamos! 💚`;
    } else {
      msg = `Lo sentimos${clientName ? ' ' + clientName : ''} 😔\n\nEl Delivery asignado canceló tu solicitud. 🚗${reasonLine}\n\n¡No te preocupes! 👍 Ya estamos buscando otro que pueda atenderte. 🔍\n\n📢 Te avisaremos en cuanto uno esté disponible. 🔄`;
    }

    try {
      await sendTextMessage(msg, phone);
      await saveMessage(phone, msg, "bot", {});
    } catch (msgErr) {
      console.warn("cancelDeliveryCase: no se pudo enviar mensaje:", msgErr.message);
    }

    await clearSession(phone);
    await setConversationMode(phone, "bot");

    return res.json({ ok: true });
  } catch (error) {
    console.error("Error in cancelDeliveryCase:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

const takeDeliveryCase = async (req, res) => {
  try {
    const { phone, clientName, deliveryCode, deliveryName } = req.body;
    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    const clientGreeting = clientName ? ` *${clientName}*` : "";
    const myName = deliveryName ? `Soy *${deliveryName}*` : "Soy tu repartidor";
    let msg = `¡Hola${clientGreeting}! 👋\n\n${myName}. Acabo de tomar tu solicitud y seguiré en contacto contigo por este chat. 🚗`;
    if (deliveryCode) {
      msg += `\n\n*Tu código de confirmación es: ${deliveryCode}*\n\nGuárdalo: te lo pediré al entregar para confirmar que soy yo quien te entrega. ✅\n\n⚠️ Si alguien te escribe desde otro número, no confíes y avísanos.`;
    } else {
      msg += `\n\nTe pediré un código de confirmación al momento de la entrega.`;
    }

    // Switch to admin mode so client media (audio/images) gets forwarded to delivery
    await clearSession(phone);
    await setConversationMode(phone, "admin", {});

    try {
      await sendTextMessage(msg, phone);
      await saveMessage(phone, msg, "bot", {});
    } catch (msgErr) {
      console.warn("takeDeliveryCase: no se pudo enviar mensaje:", msgErr.message);
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("Error in takeDeliveryCase:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

const resolveDeliveryCase = async (req, res) => {
  try {
    const { phone, clientName } = req.body;
    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    const msg = `¡Tu pedido ha sido completado${clientName ? ', ' + clientName : ''}! 🎉✅\n\n💚 Gracias por confiar en nosotros.\n\n💬 Si tienes alguna duda o comentario, escríbenos y selecciona la opción *Quejas y Sugerencias* del menú. 👍`;

    try {
      await sendTextMessage(msg, phone);
      await saveMessage(phone, msg, "bot", {});
    } catch (msgErr) {
      console.warn("resolveDeliveryCase: no se pudo enviar mensaje de cierre:", msgErr.message);
    }

    await clearSession(phone);
    await setConversationMode(phone, "bot");

    return res.json({ ok: true });
  } catch (error) {
    console.error("Error in resolveDeliveryCase:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

const notifyDeliveries = async (req, res) => {
  try {
    const { flowName, clientName } = req.body;
    await sendPushToDeliveries({
      title: "Nuevo caso disponible",
      body: flowName ? `${flowName}${clientName ? ' — ' + clientName : ''}` : "Un caso fue reasignado y está disponible",
      url: "/admin/bandeja"
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Error in notifyDeliveries:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

module.exports = {
  listConversations,
  getConversationMessages,
  sendAdminMessage,
  sendAdminImage,
  sendAdminAudio,
  takeControl,
  releaseToBot,
  checkWindow,
  takeDeliveryCase,
  resolveDeliveryCase,
  cancelDeliveryCase,
  notifyDeliveries
};
