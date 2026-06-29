const axios = require("axios");
const { getOrgId } = require("../config/orgConfig");
const { isConnector } = require("../connector/connectionType");

// orgId del contexto, tolerante a single-tenant sin contexto.
const _orgId = () => {
  try {
    return getOrgId();
  } catch {
    return null;
  }
};
// require perezoso del adaptador de salida del conector (evita ciclos de carga).
const _out = () => require("../connector/outbound");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");
const os = require("os");
ffmpeg.setFfmpegPath(ffmpegPath);

// OGG/Opus requiere seek en la salida para escribir el granule position final
// (que es lo que WhatsApp usa para mostrar la duración). Con pipes ffmpeg no
// puede hacer seek → WhatsApp siempre muestra 1s. Solución: archivos temp.
const convertToOgg = (inputBuffer) => new Promise((resolve, reject) => {
  const tmpIn  = path.join(os.tmpdir(), `wa_audio_in_${Date.now()}.webm`);
  const tmpOut = path.join(os.tmpdir(), `wa_audio_out_${Date.now()}.ogg`);

  const cleanup = () => {
    try { fs.unlinkSync(tmpIn);  } catch {}
    try { fs.unlinkSync(tmpOut); } catch {}
  };

  fs.writeFileSync(tmpIn, inputBuffer);

  // Problema: MediaRecorder WebM tiene PTS inflados (ej. 5s real → 13min PTS).
  // asetpts=NB_CONSUMED_SAMPLES/SR/TB regenera el PTS de cada frame desde el conteo real
  // de muestras acumuladas, ignorando completamente los PTS del input.
  // Frame 1: PTS=0, Frame 2: PTS=960/48000=0.02s, ..., garantizando que el granule
  // position del OGG sea correcto y WhatsApp muestre la duración real.
  // No usamos -t: el archivo WebM es finito, ffmpeg termina solo al leerlo completo.
  const cmd = ffmpeg(tmpIn)
    .inputOptions(["-fflags", "+discardcorrupt"])
    .audioFilters("asetpts=NB_CONSUMED_SAMPLES/SR/TB")
    .audioFrequency(48000)
    .audioChannels(1)
    .audioCodec("libopus")
    .format("ogg");

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
        token: fsConfig.token,
        wabaId: fsConfig.wabaId || process.env.WABA_ID || "",
        appId: fsConfig.appId || process.env.META_APP_ID || ""
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
    token: process.env.TOKEN_META_WHATSAPP,
    wabaId: process.env.WABA_ID || "",
    appId: process.env.META_APP_ID || ""
  };
};

// ── Lista plantillas usando credenciales explícitas (para probar sin guardar) ──
const listTemplatesWithCreds = async ({ version, token, wabaId }) => {
  if (!wabaId) throw new Error("WABA ID no configurado para esta organización");
  if (!token) throw new Error("Token de WhatsApp no configurado");

  const ver = version || process.env.VERSION_META_WHATSAPP || "v21.0";
  const templates = [];
  let url = `https://graph.facebook.com/${ver}/${wabaId}/message_templates`;
  let params = { limit: 100, fields: "name,status,category,language,components" };

  try {
    // Paginar hasta traer todas
    for (let i = 0; i < 20 && url; i++) {
      const res = await axios.get(url, {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = res.data || {};
      (data.data || []).forEach((t) => templates.push(t));
      url = data.paging?.next || null;
      params = undefined; // el "next" ya trae los query params embebidos
    }
    return templates;
  } catch (error) {
    // Propagar el motivo REAL de Meta (no el genérico de axios)
    const gErr = error?.response?.data?.error;
    console.log("Error listando plantillas (Graph):", error?.response?.data || error.message);
    if (gErr) {
      const code = gErr.code ? ` (código ${gErr.code})` : "";
      throw new Error(`Meta: ${gErr.message}${code}. Verifica el WABA ID y que el token tenga permiso whatsapp_business_management.`);
    }
    throw new Error(error.message || "No se pudieron listar las plantillas");
  }
};

// ── Lista las plantillas de la WABA configurada en la org actual ──
const listMessageTemplates = async () => {
  const creds = await getWACredentials();
  return listTemplatesWithCreds(creds);
};

// ── Sube una imagen de muestra a Meta (Resumable Upload) y devuelve el handle ──
// Necesario para crear plantillas con encabezado de imagen. Requiere App ID.
const uploadSampleMedia = async ({ version, token, appId }, imageUrl) => {
  if (!appId) throw new Error("Falta el App ID de Meta para subir la imagen de encabezado");
  const ver = version || process.env.VERSION_META_WHATSAPP || "v21.0";

  // 1) Descargar la imagen
  const imgRes = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const buffer = Buffer.from(imgRes.data);
  const fileType = imgRes.headers["content-type"] || "image/jpeg";

  // 2) Iniciar sesión de subida
  const startRes = await axios.post(
    `https://graph.facebook.com/${ver}/${appId}/uploads`,
    null,
    { params: { file_name: "header_sample", file_length: buffer.length, file_type: fileType },
      headers: { Authorization: `OAuth ${token}` } }
  );
  const sessionId = startRes.data.id; // "upload:XXXX"

  // 3) Subir los bytes
  const upRes = await axios.post(
    `https://graph.facebook.com/${ver}/${sessionId}`,
    buffer,
    { headers: { Authorization: `OAuth ${token}`, file_offset: 0, "Content-Type": fileType },
      maxBodyLength: Infinity, maxContentLength: Infinity }
  );
  if (!upRes.data.h) throw new Error("Meta no devolvió el handle de la imagen");
  return upRes.data.h;
};

// ── Borra una plantilla por nombre ──
const deleteTemplateWithCreds = async ({ version, token, wabaId }, name) => {
  if (!wabaId) throw new Error("WABA ID no configurado");
  if (!token) throw new Error("Token de WhatsApp no configurado");
  if (!name) throw new Error("Nombre de plantilla requerido");
  const ver = version || process.env.VERSION_META_WHATSAPP || "v21.0";
  try {
    const res = await axios.delete(`https://graph.facebook.com/${ver}/${wabaId}/message_templates`, {
      params: { name },
      headers: { Authorization: `Bearer ${token}` }
    });
    return res.data; // { success: true }
  } catch (error) {
    const gErr = error?.response?.data?.error;
    if (gErr) throw new Error(`Meta: ${gErr.error_user_msg || gErr.message}${gErr.code ? ` (código ${gErr.code})` : ""}`);
    throw new Error(error.message || "No se pudo borrar la plantilla");
  }
};

// ── Crea una plantilla en Meta (queda en PENDING hasta que Meta la apruebe) ──
const createTemplateWithCreds = async ({ version, token, wabaId }, template) => {
  if (!wabaId) throw new Error("WABA ID no configurado para esta organización");
  if (!token) throw new Error("Token de WhatsApp no configurado");

  const ver = version || process.env.VERSION_META_WHATSAPP || "v21.0";
  const url = `https://graph.facebook.com/${ver}/${wabaId}/message_templates`;
  try {
    const res = await axios.post(url, template, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    });
    return res.data; // { id, status, category }
  } catch (error) {
    const gErr = error?.response?.data?.error;
    console.log("Error creando plantilla (Graph):", error?.response?.data || error.message);
    if (gErr) {
      const code = gErr.code ? ` (código ${gErr.code})` : "";
      const detail = gErr.error_user_msg || gErr.error_user_title || gErr.message;
      throw new Error(`Meta: ${detail}${code}`);
    }
    throw new Error(error.message || "No se pudo crear la plantilla");
  }
};

// ── Envía un mensaje de plantilla (funciona fuera de la ventana de 24h) ──
// components: array tal cual lo espera la Cloud API, ej:
//   [{ type:"body", parameters:[{ type:"text", text:"Juan" }] }]
const sendTemplateMessage = async (templateName, languageCode, components, phoneNumber) => {
  try {
    if (!phoneNumber) throw new Error("phoneNumber es requerido para enviar plantilla");
    if (!templateName) throw new Error("templateName es requerido");

    // Las plantillas son un concepto exclusivo de Meta (mensajes fuera de la
    // ventana de 24h). El conector (Baileys) no las soporta.
    if (await isConnector()) {
      throw new Error("Las plantillas de Meta no están disponibles en modo conector");
    }

    const { version, phoneId, token } = await getWACredentials();
    const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;
    const template = {
      name: templateName,
      language: { code: languageCode || "es" }
    };
    if (Array.isArray(components) && components.length > 0) {
      template.components = components;
    }
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phoneNumber,
      type: "template",
      template
    };
    const config = {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    };
    return await axios.post(url, body, config);
  } catch (error) {
    const errData = error?.response?.data;
    console.log("Error al enviar plantilla:", errData);
    const errMsg = errData?.error?.message || (typeof errData === "string" ? errData : null) || error?.message || "Failed to send template";
    throw new Error(errMsg);
  }
};

const sendTextMessage = async (text, phoneNumber) => {
  try {
    if (!phoneNumber) {
      throw new Error("phoneNumber es requerido para enviar mensaje");
    }

    if (await isConnector()) {
      return _out().sendText(_orgId(), phoneNumber, text);
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
    if (await isConnector()) {
      return _out().sendButtons(_orgId(), phoneNumber, text, buttons);
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

    if (await isConnector()) {
      return _out().sendList(_orgId(), phoneNumber, text, sections);
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
    if (await isConnector()) {
      return _out().sendImageButton(_orgId(), phoneNumber, imageUrl, text, buttonId, buttonTitle);
    }
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

    if (await isConnector()) {
      return _out().sendImage(_orgId(), phoneNumber, imageUrl, caption);
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

    if (await isConnector()) {
      return _out().sendAudio(_orgId(), phoneNumber, audioUrl);
    }

    const { version, phoneId, token } = await getWACredentials();

    // 1. Download audio from Firebase Storage
    const dlRes = await axios.get(audioUrl, { responseType: "arraybuffer" });
    let buffer = Buffer.from(dlRes.data);
    const srcType = dlRes.headers["content-type"] || "audio/ogg";

    // 2. Convert webm → ogg if needed (WhatsApp doesn't accept audio/webm)
    let uploadType = srcType;
    if (srcType.includes("webm")) {
      buffer = await convertToOgg(buffer);
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

const sendCtaUrlMessage = async (text, url, buttonLabel, phoneNumber) => {
  try {
    if (!phoneNumber) throw new Error("phoneNumber es requerido");
    if (await isConnector()) {
      return _out().sendCtaUrl(_orgId(), phoneNumber, text, url, buttonLabel);
    }
    const { version, phoneId, token } = await getWACredentials();
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phoneNumber,
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: text || url },
        action: {
          name: "cta_url",
          parameters: {
            display_text: (buttonLabel || "Ver más").substring(0, 20),
            url
          }
        }
      }
    };
    const config = { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } };
    return await axios.post(`https://graph.facebook.com/${version}/${phoneId}/messages`, body, config);
  } catch (error) {
    const errData = error?.response?.data;
    console.log("Error al enviar CTA URL:", errData);
    const errMsg = errData?.error?.message || error?.message || "Failed to send CTA URL";
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
  sendCtaUrlMessage,
  listMessageTemplates,
  listTemplatesWithCreds,
  createTemplateWithCreds,
  deleteTemplateWithCreds,
  uploadSampleMedia,
  sendTemplateMessage,
};
