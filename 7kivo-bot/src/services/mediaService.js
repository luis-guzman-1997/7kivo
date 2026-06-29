const axios = require("axios");
const { admin } = require("../config/firebase");
const { getWACredentials } = require("../models/messageModel");
const crypto = require("crypto");

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || "kivo7-app.firebasestorage.app";

const EXT_MAP = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/opus": "opus",
  "audio/webm": "webm",
};

const isAudioMime = (mimeType) => (mimeType || "").split(";")[0].trim().startsWith("audio/");

// Sube un buffer a Firebase Storage y devuelve una URL con download token.
// Compartido por la ruta Meta y la ruta conector.
const uploadBufferToStorage = async (buffer, mimeType, phoneNumber) => {
  const baseMime = (mimeType || "image/jpeg").split(";")[0].trim();
  const isAudio = isAudioMime(baseMime);
  const isImage = baseMime.startsWith("image/");
  const ext = EXT_MAP[baseMime] || (isAudio ? "ogg" : isImage ? "jpg" : "bin");
  const folder = isAudio ? "chat-audios" : isImage ? "chat-images" : "chat-docs";
  const path = `${folder}/${phoneNumber}/${Date.now()}.${ext}`;

  const downloadToken = crypto.randomUUID();
  const bucket = admin.storage().bucket(BUCKET);
  const file = bucket.file(path);
  await file.save(buffer, {
    metadata: {
      contentType: baseMime,
      metadata: { firebaseStorageDownloadTokens: downloadToken }
    }
  });

  const encodedPath = encodeURIComponent(path);
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media&token=${downloadToken}`;
};

// Descarga media de un mensaje Baileys (modo conector) y la sube a Storage.
const downloadConnectorMedia = async (mediaRef, phoneNumber) => {
  const { get } = require("../connector/mediaStore");
  const { getSock } = require("../connector/sessionManager");
  const { downloadMediaMessage } = require("@whiskeysockets/baileys");
  const pino = require("pino");

  const entry = get(mediaRef);
  if (!entry) throw new Error("La media del conector expiró o no se encontró");

  const sock = getSock(entry.orgId);
  const msg = entry.msg;

  const buffer = await downloadMediaMessage(
    msg,
    "buffer",
    {},
    { logger: pino({ level: "silent" }), reuploadRequest: sock?.updateMediaMessage }
  );

  const content = msg.message || {};
  const node =
    content.imageMessage ||
    content.audioMessage ||
    content.videoMessage ||
    content.documentMessage ||
    content.stickerMessage ||
    {};
  const mimeType = node.mimetype || "application/octet-stream";

  return uploadBufferToStorage(Buffer.from(buffer), mimeType, phoneNumber);
};

const downloadAndUploadMedia = async (mediaId, phoneNumber) => {
  // Modo conector: el id sintético apunta a un mensaje Baileys registrado.
  const { isConnectorMediaRef } = require("../connector/mediaStore");
  if (isConnectorMediaRef(mediaId)) {
    return downloadConnectorMedia(mediaId, phoneNumber);
  }

  const { version, token } = await getWACredentials();

  // 1. Get media URL from Meta
  const metaRes = await axios.get(
    `https://graph.facebook.com/${version}/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const mediaUrl = metaRes.data.url;
  const mimeType = metaRes.data.mime_type || "image/jpeg";

  // 2. Download binary
  const imgRes = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${token}` },
  });
  const buffer = Buffer.from(imgRes.data);

  // 3+4. Upload to Firebase Storage and return URL
  return uploadBufferToStorage(buffer, mimeType, phoneNumber);
};

module.exports = { downloadAndUploadMedia };
