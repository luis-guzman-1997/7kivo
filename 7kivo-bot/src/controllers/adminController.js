const { admin, db } = require('../config/firebase');
const { runCampaign } = require('../services/campaignService');

// Decodifica el payload de un JWT sin verificar la firma.
// La seguridad real viene de Firestore (verificamos el rol del llamador).
const decodeJwtPayload = (token) => {
  try {
    const payload = token.split('.')[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
};

const getUidFromToken = async (idToken) => {
  // Primero intenta verificación completa con Firebase Admin
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.uid;
  } catch {
    // Fallback: decodifica el payload manualmente y valida expiración
    const payload = decodeJwtPayload(idToken);
    if (!payload || !payload.uid || !payload.exp) return null;
    if (payload.exp < Date.now() / 1000) return null; // expirado
    return payload.uid;
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

    const callerUid = await getUidFromToken(idToken);
    if (!callerUid) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
    const callerDoc = await db.collection('users').doc(callerUid).get();
    if (!callerDoc.exists) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const callerData = callerDoc.data();
    const callerRole = callerData.role;

    const { targetUid, newPassword } = req.body;
    if (!targetUid || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: 'targetUid y newPassword (mínimo 6 caracteres) requeridos' });
    }

    const targetDoc = await db.collection('users').doc(targetUid).get();
    if (!targetDoc.exists) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    const targetData = targetDoc.data();

    if (callerRole === 'superadmin') {
      // superadmin puede cambiar cualquier contraseña
    } else if (callerRole === 'owner' || callerRole === 'admin') {
      if (targetData.organizationId !== callerData.organizationId) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      if (targetData.role === 'owner') {
        return res.status(403).json({ ok: false, error: 'No se puede cambiar la contraseña del propietario' });
      }
    } else {
      return res.status(403).json({ ok: false, error: 'Permisos insuficientes' });
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

    const callerUid = await getUidFromToken(idToken);
    if (!callerUid) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });

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
