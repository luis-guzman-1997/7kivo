const axios = require("axios");
const { admin } = require("../config/firebase");
const { getWACredentials } = require("../models/messageModel");

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

const downloadAndUploadMedia = async (mediaId, phoneNumber) => {
  const { version, token } = await getWACredentials();

  // 1. Get media URL from Meta
  const metaRes = await axios.get(
    `https://graph.facebook.com/${version}/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const mediaUrl = metaRes.data.url;
  const mimeType = metaRes.data.mime_type || "image/jpeg";
  const baseMime = mimeType.split(";")[0].trim(); // strip codecs params

  // 2. Download binary
  const imgRes = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${token}` },
  });
  const buffer = Buffer.from(imgRes.data);

  // 3. Upload to Firebase Storage
  const ext = EXT_MAP[baseMime] || (isAudioMime(mimeType) ? "ogg" : "jpg");
  const folder = isAudioMime(mimeType) ? "chat-audios" : "chat-images";
  const path = `${folder}/${phoneNumber}/${Date.now()}.${ext}`;

  const bucket = admin.storage().bucket(BUCKET);
  const file = bucket.file(path);
  await file.save(buffer, { metadata: { contentType: baseMime } });

  // 4. Public URL
  const encodedPath = encodeURIComponent(path);
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media`;
};

module.exports = { downloadAndUploadMedia };
