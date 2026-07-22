const { admin, db } = require('../config/firebase');
const { runCampaign } = require('../services/campaignService');
const { listMessageTemplates, listTemplatesWithCreds, createTemplateWithCreds, deleteTemplateWithCreds, uploadSampleMedia } = require('../models/messageModel');
const { runWithOrgId } = require('../config/requestContext');
const { isConnector } = require('../connector/connectionType');

// Emails que tienen permisos de superadmin (deben coincidir con SUPER_ADMIN_EMAILS del frontend)
const SUPER_ADMIN_EMAILS = ['admin@7kivo.com'];

// Decodifica el payload de un JWT sin verificar la firma.
const decodeJwtPayload = (token) => {
  try {
    const payload = token.split('.')[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

// Retorna { uid, email } del token. Intenta verificación completa primero,
// cae a decode manual si el Admin SDK no puede verificar la firma.
const getTokenClaims = async (idToken) => {
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email || '' };
  } catch {
    const payload = decodeJwtPayload(idToken);
    if (!payload || !payload.uid || !payload.exp) return null;
    if (payload.exp < Date.now() / 1000) return null; // expirado
    return { uid: payload.uid, email: payload.email || '' };
  }
};

/**
 * POST /api/admin/set-password
 * Body: { targetUid, newPassword }
 * Header: Authorization: Bearer <idToken>
 *
 * Allows owner/admin to change passwords of team members in their org.
 * Allows superadmin to change any user's password.
 */
async function setUserPassword(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const claims = await getTokenClaims(idToken);
    if (!claims) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });

    const { targetUid, newPassword } = req.body;
    if (!targetUid || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: 'targetUid y newPassword (mínimo 6 caracteres) requeridos' });
    }

    // Superadmin identificado por email — no necesita doc en users
    const isSuperAdmin = SUPER_ADMIN_EMAILS.includes(claims.email);

    if (!isSuperAdmin) {
      const callerDoc = await db.collection('users').doc(claims.uid).get();
      if (!callerDoc.exists) return res.status(403).json({ ok: false, error: 'Forbidden' });
      const callerData = callerDoc.data();
      const callerRole = callerData.role;

      const targetDoc = await db.collection('users').doc(targetUid).get();
      if (!targetDoc.exists) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
      const targetData = targetDoc.data();

      if (callerRole === 'owner' || callerRole === 'admin') {
        if (targetData.organizationId !== callerData.organizationId) {
          return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        if (targetData.role === 'owner') {
          return res.status(403).json({ ok: false, error: 'No se puede cambiar la contraseña del propietario' });
        }
      } else {
        return res.status(403).json({ ok: false, error: 'Permisos insuficientes' });
      }
    } else {
      // Verificar que el target existe
      const targetDoc = await db.collection('users').doc(targetUid).get();
      if (!targetDoc.exists) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    await admin.auth().updateUser(targetUid, { password: newPassword });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error setting password:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * POST /api/campaigns/send
 * Body: { orgId, campaignId }
 * Header: Authorization: Bearer <idToken>
 *
 * Dispara el envío inmediato de una campaña.
 */
async function sendCampaign(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const claims = await getTokenClaims(idToken);
    if (!claims) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });

    const { orgId, campaignId } = req.body;
    if (!orgId || !campaignId) {
      return res.status(400).json({ ok: false, error: 'orgId y campaignId son requeridos' });
    }

    const result = await runCampaign(orgId, campaignId);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Error enviando campaña:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * GET /api/campaigns/templates?orgId=...&status=APPROVED
 * Header: Authorization: Bearer <idToken>
 *
 * Lista las plantillas de WhatsApp de la organización (sincronizadas desde Meta).
 */
async function listCampaignTemplates(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const claims = await getTokenClaims(idToken);
    if (!claims) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });

    const orgId = req.query.orgId || req.body?.orgId;
    if (!orgId) return res.status(400).json({ ok: false, error: 'orgId es requerido' });

    const statusFilter = (req.query.status || '').toUpperCase();

    // Orgs en modo conector (QR) no usan plantillas de Meta: evitamos la llamada
    // a Graph (que falla con "Application has been deleted" si no hay app Meta).
    const conn = await runWithOrgId(orgId, () => isConnector());
    if (conn) return res.json({ ok: true, templates: [] });

    const templates = await runWithOrgId(orgId, () => listMessageTemplates());
    const filtered = statusFilter
      ? templates.filter(t => (t.status || '').toUpperCase() === statusFilter)
      : templates;

    return res.json({ ok: true, templates: filtered });
  } catch (err) {
    console.error('Error listando plantillas:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * POST /api/campaigns/test-wa
 * Body: { token, wabaId, version? }
 * Header: Authorization: Bearer <idToken>
 *
 * Prueba credenciales de WhatsApp (token + WABA) contra Meta SIN guardarlas.
 * Devuelve siempre 200; el resultado va en el cuerpo (ok true/false).
 */
async function testWhatsAppConfig(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const claims = await getTokenClaims(idToken);
    if (!claims) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });

    const { token, wabaId, version } = req.body || {};
    if (!token || !wabaId) {
      return res.json({ ok: false, error: 'Falta el token o el WABA ID' });
    }

    const templates = await listTemplatesWithCreds({ token, wabaId, version });
    const approved = templates.filter(t => (t.status || '').toUpperCase() === 'APPROVED').length;
    return res.json({ ok: true, total: templates.length, approved });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
}

/**
 * POST /api/campaigns/create-template
 * Body: { token, wabaId, version?, name, language?, category?, body, footer?, examples? }
 * Header: Authorization: Bearer <idToken>
 *
 * Crea una plantilla en Meta (queda PENDING hasta su aprobación).
 */
async function createTemplate(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const claims = await getTokenClaims(idToken);
    if (!claims) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });

    const { token, wabaId, version, appId, name, language, category, body, footer, examples, header, buttons } = req.body || {};
    if (!token || !wabaId) return res.json({ ok: false, error: 'Falta el token o el WABA ID' });
    if (!name || !body) return res.json({ ok: false, error: 'El nombre y el cuerpo del mensaje son requeridos' });

    // Meta exige nombres en minúsculas, sin espacios ni símbolos
    const safeName = String(name).toLowerCase().trim()
      .replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 512);
    if (!safeName) return res.json({ ok: false, error: 'Nombre de plantilla inválido' });

    const components = [];

    // ── HEADER (opcional): texto o imagen ──
    if (header && header.type === 'text' && String(header.text || '').trim()) {
      components.push({ type: 'HEADER', format: 'TEXT', text: String(header.text).trim().slice(0, 60) });
    } else if (header && header.type === 'image') {
      if (!header.imageUrl) return res.json({ ok: false, error: 'Falta la URL de la imagen de encabezado' });
      let handle;
      try {
        handle = await uploadSampleMedia({ token, version, appId }, header.imageUrl);
      } catch (upErr) {
        return res.json({ ok: false, error: `No se pudo subir la imagen de encabezado: ${upErr.message}` });
      }
      components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } });
    }

    // ── BODY ──
    const bodyComp = { type: 'BODY', text: String(body) };
    const ex = (examples || []).map(e => String(e || '')).filter(e => e.length > 0);
    if (ex.length > 0) bodyComp.example = { body_text: [ex] };
    components.push(bodyComp);

    // ── FOOTER (opcional) ──
    if (footer && String(footer).trim()) {
      components.push({ type: 'FOOTER', text: String(footer).trim().slice(0, 60) });
    }

    // ── BUTTONS (opcional): quick_reply / url ──
    if (Array.isArray(buttons) && buttons.length > 0) {
      const btns = buttons
        .filter(b => b && b.text && String(b.text).trim())
        .slice(0, 10)
        .map(b => {
          const text = String(b.text).trim().slice(0, 25);
          if (b.type === 'url' && b.url) {
            return { type: 'URL', text, url: String(b.url).trim() };
          }
          return { type: 'QUICK_REPLY', text };
        });
      if (btns.length > 0) components.push({ type: 'BUTTONS', buttons: btns });
    }

    const template = {
      name: safeName,
      language: language || 'es',
      category: (category || 'UTILITY').toUpperCase(),
      components
    };

    const data = await createTemplateWithCreds({ token, wabaId, version }, template);
    return res.json({ ok: true, id: data.id, status: data.status, category: data.category, name: safeName });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
}

/**
 * POST /api/campaigns/delete-template
 * Body: { token, wabaId, version?, name }
 * Header: Authorization: Bearer <idToken>
 */
async function deleteTemplate(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!idToken) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const claims = await getTokenClaims(idToken);
    if (!claims) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });

    const { token, wabaId, version, name } = req.body || {};
    if (!token || !wabaId || !name) return res.json({ ok: false, error: 'Falta token, WABA ID o nombre' });

    await deleteTemplateWithCreds({ token, wabaId, version }, name);
    return res.json({ ok: true });
  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
}

module.exports = { setUserPassword, sendCampaign, listCampaignTemplates, testWhatsAppConfig, createTemplate, deleteTemplate };
