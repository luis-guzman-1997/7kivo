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

const { getOrgId } = require("../config/orgConfig");
const { getGeneralConfig, getWhatsAppConfig } = require("../services/botMessagesService");

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

// Org info (for web dashboard)
router.get("/api/org-info", async (req, res) => {
  try {
    const config = await getGeneralConfig();
    const waConfig = await getWhatsAppConfig();
    return res.json({
      ok: true,
      orgId: getOrgId(),
      orgName: config?.orgName || config?.schoolName || "",
      hasWhatsApp: !!(waConfig?.phoneNumberId && waConfig?.token)
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = {
  router,
};
