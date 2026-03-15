const axios = require("axios");
const { getOrgId } = require("../config/orgConfig");

const waConfigCacheMap = {}; // { [orgId]: { data, ts } }
const CACHE_TTL = 300000; // 5 min

const getWACredentials = async () => {
  // Try Firestore config first, fallback to env vars
  const now = Date.now();
  const orgId = (() => { try { return getOrgId(); } catch { return "_default"; } })();
  const cached = waConfigCacheMap[orgId];
  if (cached && now - cached.ts < CACHE_TTL) return cached.data;

  try {
    const { getWhatsAppConfig } = require("../services/botMessagesService");
    const fsConfig = await getWhatsAppConfig();
    if (fsConfig?.phoneNumberId && fsConfig?.token) {
      const credentials = {
        version: fsConfig.version || process.env.VERSION_META_WHATSAPP || "v21.0",
        phoneId: fsConfig.phoneNumberId,
        token: fsConfig.token
      };
      waConfigCacheMap[orgId] = { data: credentials, ts: now };
      return credentials;
    }
  } catch (e) {
    // Firestore not available, use env vars
  }

  return {
    version: process.env.VERSION_META_WHATSAPP || "v21.0",
    phoneId: process.env.PHONE_NUMBER_WHATSAPP,
    token: process.env.TOKEN_META_WHATSAPP
  };
};

const sendTextMessage = async (text, phoneNumber) => {
  try {
    if (!phoneNumber) {
      throw new Error("phoneNumber es requerido para enviar mensaje");
    }

    const { version, phoneId, token } = await getWACredentials();

    const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phoneNumber,
      type: "text",
      text: { preview_url: false, body: text }
    };
    
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    };

    const result = await axios.post(url, body, config);
    return result;

  } catch (error) {
    const errData = error?.response?.data;
    console.log("Error al enviar mensaje:", errData);
    const errMsg = errData?.error?.message || (typeof errData === 'string' ? errData : null) || error?.message || "Failed to send message";
    throw new Error(errMsg);
  }
};

const sendInteractiveButtons = async (text, buttons, phoneNumber) => {
  try {
    if (!phoneNumber) {
      throw new Error("phoneNumber es requerido para enviar botones");
    }

    if (!buttons || buttons.length === 0) {
      throw new Error("Debe haber al menos 1 botón");
    }
    if (buttons.length > 3) {
      console.error(`Advertencia: Se intentaron enviar ${buttons.length} botones. WhatsApp solo permite máximo 3. Se enviarán solo los primeros 3.`);
      buttons = buttons.slice(0, 3);
    }

    const { version, phoneId, token } = await getWACredentials();

    const validButtons = buttons.map((btn) => {
      let title = btn.title || "";
      if (title.length > 20) {
        console.warn(`Título de botón truncado: "${title}" -> "${title.substring(0, 20)}"`);
        title = title.substring(0, 20);
      }
      return {
        type: "reply",
        reply: {
          id: btn.id,
          title: title
        }
      };
    });

    const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phoneNumber,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: text
        },
        action: {
          buttons: validButtons
        }
      }
    };
    
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    };

    const result = await axios.post(url, body, config);
    return result;

  } catch (error) {
    const errData = error?.response?.data;
    console.log("Error al enviar botones:", errData);
    const errMsg = errData?.error?.message || (typeof errData === 'string' ? errData : null) || error?.message || "Failed to send buttons";
    throw new Error(errMsg);
  }
};

const sendInteractiveList = async (text, buttonText, sections, phoneNumber) => {
  try {
    if (!phoneNumber) {
      throw new Error("phoneNumber es requerido para enviar lista");
    }

    const { version, phoneId, token } = await getWACredentials();

    const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phoneNumber,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: text
        },
        action: {
          button: buttonText,
          sections: sections
        }
      }
    };
    
    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    };

    const result = await axios.post(url, body, config);
    return result;

  } catch (error) {
    const errData = error?.response?.data;
    console.log("Error al enviar lista:", errData);
    const errMsg = errData?.error?.message || (typeof errData === 'string' ? errData : null) || error?.message || "Failed to send list";
    throw new Error(errMsg);
  }
};

const sendImageMessage = async (imageUrl, caption, phoneNumber) => {
  try {
    if (!phoneNumber) {
      throw new Error("phoneNumber es requerido para enviar imagen");
    }

    const { version, phoneId, token } = await getWACredentials();

    const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phoneNumber,
      type: "image",
      image: {
        link: imageUrl,
        caption: caption || ""
      }
    };

    const config = {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    };

    const result = await axios.post(url, body, config);
    return result;

  } catch (error) {
    const errData = error?.response?.data;
    console.log("Error al enviar imagen:", errData);
    const errMsg = errData?.error?.message || (typeof errData === 'string' ? errData : null) || error?.message || "Failed to send image";
    throw new Error(errMsg);
  }
};

module.exports = {
  getWACredentials,
  sendTextMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendImageMessage,
};
