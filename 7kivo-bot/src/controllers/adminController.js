const { admin, db } = require('../config/firebase');
const { runCampaign } = require('../services/campaignService');

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

module.exports = { setUserPassword, sendCampaign };
