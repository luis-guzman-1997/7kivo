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
};

const downloadAndUploadMedia = async (mediaId, phoneNumber) => {
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

  // 3. Upload to Firebase Storage
  const ext = EXT_MAP[mimeType] || "jpg";
  const path = `chat-images/${phoneNumber}/${Date.now()}.${ext}`;

  const bucket = admin.storage().bucket(BUCKET);
  const file = bucket.file(path);
  await file.save(buffer, { metadata: { contentType: mimeType } });

  // 4. Public URL (works with Storage rules: allow read: if true for chat-images)
  const encodedPath = encodeURIComponent(path);
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodedPath}?alt=media`;
};

module.exports = { downloadAndUploadMedia };
