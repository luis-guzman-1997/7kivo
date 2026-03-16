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
  checkWindow,
  takeDeliveryCase,
  resolveDeliveryCase
} = require("../controllers/chatController");

const { setUserPassword, sendCampaign } = require("../controllers/adminController");

const { getOrgId } = require("../config/orgConfig");
const { runWithOrgId } = require("../config/requestContext");
const { getGeneralConfig, getWhatsAppConfig } = require("../services/botMessagesService");
const { deleteGoogleCalendarEvent } = require("../services/googleCalendarService");

// Middleware: orgId puede venir de params URL, body o query
const withOrgContext = (handler) => async (req, res) => {
  const orgId = req.params?.orgId || req.body?.orgId || req.query?.orgId || null;
  if (orgId) {
    return runWithOrgId(orgId, () => handler(req, res));
  }
  return handler(req, res);
};

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

// Chat API (admin messaging) — orgId en URL para contexto explícito
router.get("/api/:orgId/conversations", withOrgContext(listConversations));
router.get("/api/:orgId/conversations/:phone", withOrgContext(getConversationMessages));
router.get("/api/:orgId/conversations/:phone/window", withOrgContext(checkWindow));
router.post("/api/:orgId/send-message", withOrgContext(sendAdminMessage));
router.post("/api/:orgId/send-image", withOrgContext(sendAdminImage));
router.post("/api/:orgId/take-control", withOrgContext(takeControl));
router.post("/api/:orgId/release-to-bot", withOrgContext(releaseToBot));
router.post("/api/:orgId/take-delivery-case", withOrgContext(takeDeliveryCase));
router.post("/api/:orgId/resolve-delivery-case", withOrgContext(resolveDeliveryCase));

// Rutas legacy sin orgId en URL (backward compat — se pueden remover cuando el frontend esté actualizado)
router.get("/api/conversations", withOrgContext(listConversations));
router.get("/api/conversations/:phone", withOrgContext(getConversationMessages));
router.get("/api/conversations/:phone/window", withOrgContext(checkWindow));
router.post("/api/send-message", withOrgContext(sendAdminMessage));
router.post("/api/send-image", withOrgContext(sendAdminImage));
router.post("/api/take-control", withOrgContext(takeControl));
router.post("/api/release-to-bot", withOrgContext(releaseToBot));

// Admin operations
router.post("/api/admin/set-password", setUserPassword);
router.post("/api/campaigns/send", withOrgContext(sendCampaign));

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
