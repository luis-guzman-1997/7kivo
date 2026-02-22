const axios = require("axios");

const sendTextMessage = async (text, phoneNumber) => {
  try {
    if (!phoneNumber) {
      throw new Error("phoneNumber es requerido para enviar mensaje");
    }

    const version = process.env.VERSION_META_WHATSAPP;
    const phoneId = process.env.PHONE_NUMBER_WHATSAPP;
    const token = process.env.TOKEN_META_WHATSAPP;

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
    console.log("❌ Error al enviar mensaje:", error?.response?.data);
    throw new Error(error?.response?.data || "Failed to send message");
  }
};

const sendInteractiveButtons = async (text, buttons, phoneNumber) => {
  try {
    if (!phoneNumber) {
      throw new Error("phoneNumber es requerido para enviar botones");
    }

    // Validar que no haya más de 3 botones
    if (!buttons || buttons.length === 0) {
      throw new Error("Debe haber al menos 1 botón");
    }
    if (buttons.length > 3) {
      console.error(`⚠️ Advertencia: Se intentaron enviar ${buttons.length} botones. WhatsApp solo permite máximo 3. Se enviarán solo los primeros 3.`);
      buttons = buttons.slice(0, 3);
    }

    const version = process.env.VERSION_META_WHATSAPP;
    const phoneId = process.env.PHONE_NUMBER_WHATSAPP;
    const token = process.env.TOKEN_META_WHATSAPP;

    // Validar y truncar títulos de botones (máximo 20 caracteres)
    const validButtons = buttons.map((btn) => {
      let title = btn.title || "";
      if (title.length > 20) {
        console.warn(`⚠️ Título de botón truncado: "${title}" (${title.length} caracteres) -> "${title.substring(0, 20)}"`);
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
    console.log("❌ Error al enviar botones:", error?.response?.data);
    throw new Error(error?.response?.data || "Failed to send buttons");
  }
};

const sendInteractiveList = async (text, buttonText, sections, phoneNumber) => {
  try {
    if (!phoneNumber) {
      throw new Error("phoneNumber es requerido para enviar lista");
    }

    const version = process.env.VERSION_META_WHATSAPP;
    const phoneId = process.env.PHONE_NUMBER_WHATSAPP;
    const token = process.env.TOKEN_META_WHATSAPP;

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
    console.log("❌ Error al enviar lista:", error?.response?.data);
    throw new Error(error?.response?.data || "Failed to send list");
  }
};

module.exports = {
  sendTextMessage,
  sendInteractiveButtons,
  sendInteractiveList,
};

