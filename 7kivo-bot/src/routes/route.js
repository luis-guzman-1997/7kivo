const {
  apiVerification,
  requestMessageFromWhatsapp,
  apiVerificationMulti,
  requestMessageMulti,
} = require("../controllers/messagesController");

const {
  listConversations,
  getConversationMessages,
  sendAdminMessage,
  sendAdminImage,
  takeControl,
  releaseToBot,
  checkWindow
} = require("../controllers/chatController");

const { setUserPassword, sendCampaign } = require("../controllers/adminController");

const { getOrgId } = require("../config/orgConfig");
const { getGeneralConfig, getWhatsAppConfig } = require("../services/botMessagesService");
const { deleteGoogleCalendarEvent } = require("../services/googleCalendarService");

const router = require("express").Router();

router.get("/test", async (req, res) => {
  return res.send("OK");
});

// WhatsApp webhook - single-tenant (clientes existentes con ORG_ID en .env)
router.get("/auth", apiVerification);
router.post("/auth", requestMessageFromWhatsapp);

// WhatsApp webhook - multi-tenant (un despliegue para múltiples orgs)
router.get("/auth/:orgId", apiVerificationMulti);
router.post("/auth/:orgId", requestMessageMulti);

// Chat API (admin messaging)
router.get("/api/conversations", listConversations);
router.get("/api/conversations/:phone", getConversationMessages);
router.get("/api/conversations/:phone/window", checkWindow);
router.post("/api/send-message", sendAdminMessage);
router.post("/api/send-image", sendAdminImage);
router.post("/api/take-control", takeControl);
router.post("/api/release-to-bot", releaseToBot);

// Admin operations
router.post("/api/admin/set-password", setUserPassword);
router.post("/api/campaigns/send", sendCampaign);

// Appointments
router.post("/api/appointments/cancel-gcal", async (req, res) => {
  try {
    const { gcEventId } = req.body;
    if (!gcEventId) return res.status(400).json({ ok: false, error: 'gcEventId requerido' });
    await deleteGoogleCalendarEvent(gcEventId);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

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
