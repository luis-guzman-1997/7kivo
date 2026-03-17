const { sendTextMessage, sendImageMessage } = require("../models/messageModel");
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

const cancelDeliveryCase = async (req, res) => {
  try {
    const { phone, clientName, cancelCount } = req.body;
    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    let msg;
    if (cancelCount >= 3) {
      msg = `Lo sentimos${clientName ? ' ' + clientName : ''} 😔 En este momento ningún delivery puede atender tu solicitud. Puedes intentarlo más tarde o contactarnos directamente.`;
    } else {
      msg = `Tu pedido fue cancelado por el delivery asignado. ¡No te preocupes! Estamos buscando otro delivery para atenderte 🔄`;
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
    const { phone, clientName, deliveryName, deliveryPhone } = req.body;
    if (!phone) {
      return res.status(400).json({ ok: false, error: "phone is required" });
    }

    let msg = `¡Hola${clientName ? ' ' + clientName : ''}! 🚗 *${deliveryName || 'Un repartidor'}* ha tomado tu pedido`;
    if (deliveryPhone) {
      msg += ` y te contactará desde el número *${deliveryPhone}*`;
    }
    msg += `. ¡Estamos en camino! 🎉`;

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

    const msg = `¡Tu pedido ha sido completado${clientName ? ', ' + clientName : ''}! 🎉 Gracias por confiar en nosotros.\n\nSi tienes alguna duda o comentario, escríbenos y selecciona la opción *Quejas y Sugerencias* del menú.`;

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

module.exports = {
  listConversations,
  getConversationMessages,
  sendAdminMessage,
  sendAdminImage,
  takeControl,
  releaseToBot,
  checkWindow,
  takeDeliveryCase,
  resolveDeliveryCase,
  cancelDeliveryCase
};
