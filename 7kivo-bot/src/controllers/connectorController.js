// Endpoints HTTP para vincular/gestionar la sesión conector de una org desde el
// panel superadmin: iniciar (devuelve QR), consultar estado, desvincular.

const {
  startSession,
  getStatus,
  logoutSession,
} = require("../connector/sessionManager");
const { invalidate } = require("../connector/connectionType");

// POST /api/:orgId/connector/start  → inicia la sesión y empieza a generar QR
const startConnector = async (req, res) => {
  try {
    const orgId = req.params.orgId;
    if (!orgId) return res.status(400).json({ ok: false, error: "orgId requerido" });
    invalidate(orgId); // por si recién se cambió a modo conector
    const status = await startSession(orgId, { force: !!req.body?.force });
    return res.json({ ok: true, ...status });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// GET /api/:orgId/connector/status  → { status, qr } para que el panel haga polling
const connectorStatus = async (req, res) => {
  try {
    const orgId = req.params.orgId;
    if (!orgId) return res.status(400).json({ ok: false, error: "orgId requerido" });
    return res.json({ ok: true, ...getStatus(orgId) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

// POST /api/:orgId/connector/logout  → cierra sesión y borra credenciales
const logoutConnector = async (req, res) => {
  try {
    const orgId = req.params.orgId;
    if (!orgId) return res.status(400).json({ ok: false, error: "orgId requerido" });
    const r = await logoutSession(orgId);
    invalidate(orgId);
    return res.json({ ok: true, ...r });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};

module.exports = { startConnector, connectorStatus, logoutConnector };
