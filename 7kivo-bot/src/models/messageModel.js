const axios = require("axios");
const { getOrgId } = require("../config/orgConfig");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");
const os = require("os");
ffmpeg.setFfmpegPath(ffmpegPath);

// OGG/Opus requiere seek en la salida para escribir el granule position final
// (que es lo que WhatsApp usa para mostrar la duración). Con pipes ffmpeg no
// puede hacer seek → WhatsApp siempre muestra 1s. Solución: archivos temp.
const convertToOgg = (inputBuffer, durationSeconds) => new Promise((resolve, reject) => {
  const tmpIn  = path.join(os.tmpdir(), `wa_audio_in_${Date.now()}.webm`);
  const tmpOut = path.join(os.tmpdir(), `wa_audio_out_${Date.now()}.ogg`);

  const cleanup = () => {
    try { fs.unlinkSync(tmpIn);  } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  };

  fs.writeFileSync(tmpIn, inputBuffer);

  // +igndts+discardcorrupt: tolera timestamps rotos del WebM de MediaRecorder.
  // -t N (output): limita la salida a N segundos reales de audio codificado,
  //   sin depender de los timestamps del input (que pueden estar inflados).
  //   Requiere escribir a archivo (no pipe) para que ffmpeg finalice el OGG
  //   correctamente con el granule position real en la última página.
  const cmd = ffmpeg(tmpIn)
    .inputOptions(["-fflags", "+igndts+discardcorrupt"])
    .audioCodec("libopus")
    .format("ogg");

  if (durationSeconds && durationSeconds > 0) {
    // recordingSeconds es entero (setInterval cada 1s), el audio real puede ser
    // hasta ~1s más largo. Se añaden 2s de buffer para no cortar el final.
    // ffmpeg para al agotar el audio real, no añade silencio, así que el
    // buffer extra no afecta la duración final del OGG.
    cmd.outputOptions(["-t", String(durationSeconds + 2)]);
  }

  cmd
    .on("error", (err) => { cleanup(); reject(err); })
    .on("end", () => {
      try {
        const buf = fs.readFileSync(tmpOut);
        cleanup();
        resolve(buf);
      } catch (e) { cleanup(); reject(e); }
    })
    .save(tmpOut);
});

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

const sendInteractiveImageButton = async (imageUrl, text, buttonId, buttonTitle, phoneNumber) => {
  try {
    if (!phoneNumber) throw new Error("phoneNumber es requerido");
    const { version, phoneId, token } = await getWACredentials();
    const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;
    const interactive = {
      type: "button",
      body: { text: text.substring(0, 1024) },
      action: {
        buttons: [{
          type: "reply",
          reply: {
            id: buttonId.substring(0, 256),
            title: buttonTitle.substring(0, 20)
          }
        }]
      }
    };
    if (imageUrl) {
      interactive.header = { type: "image", image: { link: imageUrl } };
    }
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phoneNumber,
      type: "interactive",
      interactive
    };
    const config = { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } };
    return await axios.post(url, body, config);
  } catch (error) {
    const errData = error?.response?.data;
    console.log("Error al enviar botón interactivo:", errData);
    const errMsg = errData?.error?.message || error?.message || "Failed to send interactive button";
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

const sendAudioMessage = async (audioUrl, phoneNumber, durationSeconds) => {
  try {
    if (!phoneNumber) {
      throw new Error("phoneNumber es requerido para enviar audio");
    }

    const { version, phoneId, token } = await getWACredentials();

    // 1. Download audio from Firebase Storage
    const dlRes = await axios.get(audioUrl, { responseType: "arraybuffer" });
    let buffer = Buffer.from(dlRes.data);
    const srcType = dlRes.headers["content-type"] || "audio/ogg";

    // 2. Convert webm → ogg if needed (WhatsApp doesn't accept audio/webm)
    let uploadType = srcType;
    if (srcType.includes("webm")) {
      buffer = await convertToOgg(buffer, durationSeconds);
      uploadType = "audio/ogg";
    }

    // 3. Upload to WhatsApp media API
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: uploadType }), "audio.ogg");
    form.append("type", uploadType);
    form.append("messaging_product", "whatsapp");

    const uploadRes = await axios.post(
      `https://graph.facebook.com/${version}/${phoneId}/media`,
      form,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const mediaId = uploadRes.data.id;

    // 3. Send via media ID
    const result = await axios.post(
      `https://graph.facebook.com/${version}/${phoneId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phoneNumber,
        type: "audio",
        audio: { id: mediaId }
      },
      { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } }
    );
    return result;

  } catch (error) {
    const errData = error?.response?.data;
    console.log("Error al enviar audio:", errData);
    const errMsg = errData?.error?.message || (typeof errData === 'string' ? errData : null) || error?.message || "Failed to send audio";
    throw new Error(errMsg);
  }
};

module.exports = {
  getWACredentials,
  sendTextMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendInteractiveImageButton,
  sendImageMessage,
  sendAudioMessage,
};
