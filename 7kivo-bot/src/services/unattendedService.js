const { db, admin } = require('../config/firebase');
const { sendTextMessage } = require('../models/messageModel');
const { runWithOrgId } = require('../config/requestContext');

const CHECK_INTERVAL_MS = 15 * 60 * 1000; // cada 15 minutos

const DEFAULT_MESSAGE =
  'Lo sentimos 😔 En este momento no pudimos atender tu solicitud. Te contactaremos a la brevedad posible. ¡Gracias por tu paciencia! 🙏';

// ── Procesa solicitudes no atendidas para una org ──
const processUnattendedForOrg = async (orgId) => {
  try {
    const orgRef = db.collection('organizations').doc(orgId);

    // Cargar todos los flujos con unattendedEnabled
    const flowsSnap = await orgRef.collection('flows')
      .where('unattendedEnabled', '==', true)
      .get();

    if (flowsSnap.empty) return;

    // Mapa flowId -> config del flujo
    const flowMap = {};
    flowsSnap.docs.forEach(d => {
      flowMap[d.id] = d.data();
    });

    // Obtener todas las colecciones de la org
    const colsSnap = await orgRef.collection('_collections').get();

    for (const colDoc of colsSnap.docs) {
      const slug = colDoc.data().slug || colDoc.id;

      // Buscar submissions pending no notificadas
      const subsSnap = await orgRef
        .collection(slug)
        .where('status', '==', 'pending')
        .where('unattendedNotified', '==', false)
        .get();

      for (const subDoc of subsSnap.docs) {
        const data = subDoc.data();
        const flowId = data.flowId;
        if (!flowId || !flowMap[flowId]) continue; // flujo sin unattendedEnabled

        const flowConfig = flowMap[flowId];
        const timeoutHours = Number(flowConfig.unattendedTimeoutHours) || 2;
        const message = (flowConfig.unattendedMessage || '').trim() || DEFAULT_MESSAGE;
        const cutoffMs = Date.now() - timeoutHours * 3600 * 1000;

        const createdMs = data.createdAt?.toMillis?.()
          ?? (data.createdAt?.seconds ? data.createdAt.seconds * 1000 : null);

        if (!createdMs || createdMs > cutoffMs) continue;
        if (!data.phoneNumber) continue;

        try {
          await runWithOrgId(orgId, async () => {
            await sendTextMessage(message, data.phoneNumber);
          });
          await subDoc.ref.update({
            unattendedNotified: true,
            unattendedNotifiedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`[unattended] Aviso enviado a ${data.phoneNumber} (${orgId}/${slug}/${subDoc.id})`);
        } catch (err) {
          console.error(`[unattended] Error enviando a ${data.phoneNumber}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error(`[unattended] Error procesando org ${orgId}:`, err.message);
  }
};

// ── Scheduler global ──
let schedulerRunning = false;

const processAllOrgs = async () => {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    let orgIds = [];
    const envOrgId = process.env.ORG_ID || process.env.SCHOOL_ID;
    if (envOrgId) {
      orgIds = [envOrgId];
    } else {
      const orgsSnap = await db.collection('organizations').get();
      orgIds = orgsSnap.docs.map(d => d.id);
    }
    for (const orgId of orgIds) {
      await processUnattendedForOrg(orgId);
    }
  } catch (err) {
    console.error('[unattended] Error en scheduler:', err.message);
  } finally {
    schedulerRunning = false;
  }
};

let intervalId = null;

const startUnattendedScheduler = () => {
  if (intervalId) return;
  intervalId = setInterval(processAllOrgs, CHECK_INTERVAL_MS);
  console.log(`⏰ Scheduler de solicitudes no atendidas activo (cada ${CHECK_INTERVAL_MS / 60000}min)`);
};

module.exports = { startUnattendedScheduler };
