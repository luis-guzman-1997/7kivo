const {
  apiVerification,
  requestMessageFromWhatsapp,
} = require("../controllers/messagesController");

const {
  listConversations,
  getConversationMessages,
  sendAdminMessage,
  takeControl,
  releaseToBot,
  checkWindow
} = require("../controllers/chatController");

const router = require("express").Router();

router.get("/test", async (req, res) => {
  return res.send("OK");
});

// WhatsApp webhook
router.get("/auth", apiVerification);
router.post("/auth", requestMessageFromWhatsapp);

// Chat API (admin messaging)
router.get("/api/conversations", listConversations);
router.get("/api/conversations/:phone", getConversationMessages);
router.get("/api/conversations/:phone/window", checkWindow);
router.post("/api/send-message", sendAdminMessage);
router.post("/api/take-control", takeControl);
router.post("/api/release-to-bot", releaseToBot);

module.exports = {
  router,
};
