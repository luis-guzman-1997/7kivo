const { admin, db } = require('../config/firebase');
const { sendTextMessage, sendImageMessage } = require('../models/messageModel');
const { runWithOrgId } = require('../config/requestContext');

const CAMPAIGN_CHECK_INTERVAL = 300000; // 5 minutos
const SEND_DELAY_MS = 1200; // 1.2 segundos entre mensajes

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Obtiene los teléfonos destinatarios de una campaña ──
const getRecipients = async (orgId, campaign) => {
  if (campaign.recipientSource === 'manual') {
    return (campaign.manualPhones || []).filter(p => p && String(p).length >= 8);
  }

  if (campaign.recipientSource === 'collection') {
    const colDefDoc = await db
      .collection('organizations').doc(orgId)
      .collection('_collections').doc(campaign.collectionId)
      .get();
    if (!colDefDoc.exists) return [];
    const slug = colDefDoc.data().slug || campaign.collectionId;

    const dataSnap = await db
      .collection('organizations').doc(orgId)
      .collection(slug)
      .get();

    return dataSnap.docs
      .map(d => d.data()[campaign.phoneField])
      .filter(p => p && String(p).length >= 8)
      .map(p => String(p));
  }

  return [];
};

// ── Ejecuta el envío de una campaña ──
const runCampaign = async (orgId, campaignId) => {
  const campaignRef = db
    .collection('organizations').doc(orgId)
    .collection('campaigns').doc(campaignId);

  const campaignSnap = await campaignRef.get();
  if (!campaignSnap.exists) throw new Error('Campaña no encontrada');

  const campaign = { id: campaignId, ...campaignSnap.data() };

  if (campaign.status !== 'active' && campaign.status !== 'scheduled') {
    throw new Error(`La campaña está en estado "${campaign.status}", no se puede enviar`);
  }

  const today = new Date().toISOString().slice(0, 10);

  // Verificar límite diario de la org
  const orgSnap = await db.collection('organizations').doc(orgId).get();
  const orgData = orgSnap.exists ? orgSnap.data() : {};
  const dailyLimit = orgData.dailyBulkLimit || 0;
  const sentToday = campaign.sentTodayDate === today ? (campaign.sentToday || 0) : 0;

  if (dailyLimit > 0 && sentToday >= dailyLimit) {
    throw new Error(`Límite diario alcanzado (${sentToday}/${dailyLimit})`);
  }

  const phones = await getRecipients(orgId, campaign);
  if (phones.length === 0) {
    // Sin destinatarios: completar de igual forma
    await campaignRef.update({
      status: 'completed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { sentCount: 0, failedCount: 0, total: 0 };
  }

  const remaining = dailyLimit > 0 ? dailyLimit - sentToday : phones.length;
  const toSend = phones.slice(0, remaining);

  let sentCount = 0;
  let failedCount = 0;

  const finalMessage = campaign.actionKeywordEnabled && campaign.actionKeyword
    ? `${campaign.message}\n\nResponde *${campaign.actionKeyword.toUpperCase()}* para hacer tu pedido 🛵`
    : campaign.message;

  for (let i = 0; i < toSend.length; i++) {
    const phone = toSend[i];
    try {
      await runWithOrgId(orgId, async () => {
        if (campaign.imageUrl) {
          await sendImageMessage(campaign.imageUrl, finalMessage, phone);
        } else {
          await sendTextMessage(finalMessage, phone);
        }
      });
      sentCount++;
    } catch (err) {
      console.error(`Campaign ${campaignId}: fallo envío a ${phone}:`, err.message);
      failedCount++;
    }
    if (i < toSend.length - 1) await sleep(SEND_DELAY_MS);
  }

  // Calcular siguiente ejecución o marcar completada
  const updateData = {
    sentTotal: admin.firestore.FieldValue.increment(sentCount),
    failedTotal: admin.firestore.FieldValue.increment(failedCount),
    sentToday: sentToday + sentCount,
    sentTodayDate: today,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  if (campaign.type === 'immediate' || campaign.type === 'once') {
    updateData.status = 'completed';
  } else if (campaign.type === 'daily') {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(campaign.dailyHour ?? 9, campaign.dailyMinute ?? 0, 0, 0);
    updateData.nextRunAt = next.toISOString();
  } else if (campaign.type === 'interval') {
    const next = new Date(Date.now() + (campaign.intervalHours || 24) * 3600000);
    updateData.nextRunAt = next.toISOString();
  }

  await campaignRef.update(updateData);

  console.log(`✅ Campaign ${campaignId} (${orgId}): enviados ${sentCount}, fallidos ${failedCount}`);
  return { sentCount, failedCount, total: toSend.length };
};

// ── Scheduler: procesa campañas programadas/recurrentes ──
let schedulerRunning = false;

const processDueCampaigns = async () => {
  if (schedulerRunning) return;
  schedulerRunning = true;

  try {
    const now = new Date().toISOString();

    let orgIds = [];
    const envOrgId = process.env.ORG_ID || process.env.SCHOOL_ID;
    if (envOrgId) {
      orgIds = [envOrgId];
    } else {
      const orgsSnap = await db.collection('organizations').get();
      orgIds = orgsSnap.docs.map(d => d.id);
    }

    for (const orgId of orgIds) {
      try {
        const snap = await db
          .collection('organizations').doc(orgId)
          .collection('campaigns')
          .where('status', 'in', ['active', 'scheduled'])
          .where('type', 'in', ['once', 'daily', 'interval'])
          .get();

        for (const docSnap of snap.docs) {
          const campaign = docSnap.data();
          if (!campaign.nextRunAt || campaign.nextRunAt > now) continue;
          await runCampaign(orgId, docSnap.id).catch(err => {
            console.error(`Scheduler: error en campaña ${docSnap.id}:`, err.message);
          });
        }
      } catch (err) {
        console.error(`Scheduler: error escaneando org ${orgId}:`, err.message);
      }
    }
  } catch (err) {
    console.error('Campaign scheduler error:', err.message);
  } finally {
    schedulerRunning = false;
  }
};

let schedulerIntervalId = null;

const startCampaignScheduler = () => {
  if (schedulerIntervalId) return;
  schedulerIntervalId = setInterval(processDueCampaigns, CAMPAIGN_CHECK_INTERVAL);
  console.log(`📣 Scheduler de campañas activo (cada ${CAMPAIGN_CHECK_INTERVAL / 60000}min)`);
};

module.exports = { runCampaign, startCampaignScheduler };
