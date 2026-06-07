const { admin, db } = require('../config/firebase');
const { sendTextMessage, sendImageMessage, sendInteractiveImageButton, sendTemplateMessage } = require('../models/messageModel');
const { runWithOrgId } = require('../config/requestContext');

const CAMPAIGN_CHECK_INTERVAL = 300000; // 5 minutos
const SEND_DELAY_MS = 1200; // 1.2 segundos entre mensajes

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Tarifas de Meta por mensaje (USD) para El Salvador (región "Rest of Latin America")
// + margen de servicio por mensaje. Deben coincidir con META_RATES/COST_MARGIN
// de campaigns.component.ts en la web.
const META_RATES = { MARKETING: 0.0625, UTILITY: 0.0340, AUTHENTICATION: 0.0304 };
const COST_MARGIN = 0.04;

// Costo unitario que se cobra al cliente por un mensaje de esta campaña
const unitCostFor = (campaign) => {
  if (campaign.channelMode === 'template' && campaign.templateName) {
    const cat = String(campaign.templateCategory || 'MARKETING').toUpperCase();
    return (META_RATES[cat] ?? META_RATES.MARKETING) + COST_MARGIN;
  }
  return COST_MARGIN;
};

// Registra un envío individual en campaigns/{id}/sends (no rompe el envío si falla el log)
const logSend = async (campaignRef, data) => {
  try {
    await campaignRef.collection('sends').add({
      ...data,
      at: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('logSend error:', err.message);
  }
};

// Acumula el gasto del mes en organizations/{orgId}/billing/{YYYY-MM}.
// Los campos de pago (paidAmount, payments, paymentStatus) los maneja el panel SA;
// el merge los preserva.
const recordBilling = async (orgId, campaign, sentCount) => {
  if (sentCount <= 0) return;
  try {
    const month = getTodayLocal().slice(0, 7);
    const isTemplate = campaign.channelMode === 'template' && !!campaign.templateName;
    const cat = isTemplate ? String(campaign.templateCategory || 'MARKETING').toUpperCase() : 'FREEFORM';
    const cost = sentCount * unitCostFor(campaign);
    // Desglose para el panel SA: costo real de Meta vs ganancia (margen de servicio)
    const profit = sentCount * COST_MARGIN;
    const metaCost = cost - profit;
    const inc = admin.firestore.FieldValue.increment;
    await db.collection('organizations').doc(orgId)
      .collection('billing').doc(month)
      .set({
        month,
        sentTotal: inc(sentCount),
        totalCost: inc(cost),
        metaCost: inc(metaCost),
        serviceProfit: inc(profit),
        byCategory: { [cat]: { sent: inc(sentCount), cost: inc(cost) } },
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
  } catch (err) {
    console.error('recordBilling error:', err.message);
  }
};

// Construye los "components" de una plantilla a partir de la config de la campaña.
// `record` opcional: si se pasa, las variables con source:'field' se resuelven por registro.
const buildTemplateComponents = (campaign, record) => {
  const components = [];
  if (campaign.templateHeaderImage && campaign.imageUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: campaign.imageUrl } }]
    });
  }
  const vars = campaign.templateVariables || [];
  if (vars.length > 0) {
    components.push({
      type: 'body',
      parameters: vars.map(v => {
        let text;
        if (record && v && v.source === 'field') text = record[v.field];
        else text = v?.value;
        return { type: 'text', text: String(text ?? '') };
      })
    });
  }
  return components;
};

// Parseo tolerante de la fecha de un registro: Timestamp de Firestore, Date,
// ISO/yyyy-mm-dd o dd/mm/yyyy. Devuelve un Date (a medianoche) o null.
const parseRecordDate = (val) => {
  if (!val) return null;
  if (typeof val.toDate === 'function') return val.toDate();
  if (val instanceof Date) return val;
  const s = String(val).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// Fecha en formato YYYY-MM-DD a partir de un Date (en su hora local)
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Fecha "hoy" en zona horaria local (El Salvador, UTC-6) en formato YYYY-MM-DD
const getTodayLocal = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/El_Salvador' }).format(new Date());

// Próxima ejecución semanal: el día(s) de la semana seleccionado(s) más cercano
const computeWeeklyNext = (days, hour, minute, from) => {
  const base = from || new Date();
  const set = (days || []).map(Number);
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, minute, 0, 0);
    if (set.includes(d.getDay()) && d > base) return d;
  }
  const f = new Date(base);
  f.setDate(f.getDate() + 7);
  f.setHours(hour, minute, 0, 0);
  return f;
};

// Próxima ejecución mensual: día fijo del mes, o el último día si el mes es más corto
const computeMonthlyNext = (day, hour, minute, from) => {
  const base = from || new Date();
  const makeDate = (y, m) => {
    const lastDay = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(day, lastDay), hour, minute, 0, 0);
  };
  let y = base.getFullYear();
  let m = base.getMonth();
  let next = makeDate(y, m);
  if (next <= base) {
    m += 1;
    if (m > 11) { m = 0; y += 1; }
    next = makeDate(y, m);
  }
  return next;
};

// Total de mensajes enviados hoy por TODA la organización (límite global, no por campaña)
const getOrgSentToday = async (orgId, today) => {
  const snap = await db
    .collection('organizations').doc(orgId)
    .collection('campaigns')
    .get();
  return snap.docs.reduce((sum, d) => {
    const c = d.data();
    return sum + (c.sentTodayDate === today ? (c.sentToday || 0) : 0);
  }, 0);
};

// ── Obtiene teléfonos que tienen una solicitud/caso activo (no resuelto) ──
const getActiveCasePhones = async (orgId) => {
  try {
    const colsSnap = await db
      .collection('organizations').doc(orgId)
      .collection('_collections')
      .get();

    const activePhones = new Set();
    for (const colDoc of colsSnap.docs) {
      const slug = colDoc.data().slug || colDoc.id;
      const subsSnap = await db
        .collection('organizations').doc(orgId)
        .collection(slug)
        .where('status', 'in', ['pending', 'taken'])
        .get();
      subsSnap.docs.forEach(d => {
        const phone = d.data().phoneNumber;
        if (phone) activePhones.add(String(phone));
      });
    }
    return activePhones;
  } catch (err) {
    console.error('getActiveCasePhones error:', err.message);
    return new Set();
  }
};

// ── Obtiene los teléfonos destinatarios de una campaña ──
const getRecipients = async (orgId, campaign) => {
  const optedOut = new Set(campaign.optedOutPhones || []);

  if (campaign.recipientSource === 'manual') {
    return (campaign.manualPhones || [])
      .filter(p => p && String(p).length >= 8 && !optedOut.has(String(p)));
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
      .filter(p => p && String(p).length >= 8 && !optedOut.has(String(p)))
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

  const today = getTodayLocal();

  // Verificar límite diario de la org (global a todas las campañas)
  const orgSnap = await db.collection('organizations').doc(orgId).get();
  const orgData = orgSnap.exists ? orgSnap.data() : {};
  const dailyLimit = orgData.dailyBulkLimit || 0;
  const campaignSentToday = campaign.sentTodayDate === today ? (campaign.sentToday || 0) : 0;
  const orgSentToday = dailyLimit > 0 ? await getOrgSentToday(orgId, today) : 0;

  if (dailyLimit > 0 && orgSentToday >= dailyLimit) {
    throw new Error(`Límite diario alcanzado (${orgSentToday}/${dailyLimit})`);
  }

  const [phones, activeCasePhones] = await Promise.all([
    getRecipients(orgId, campaign),
    getActiveCasePhones(orgId)
  ]);

  // Excluir clientes con una solicitud/caso activo abierto
  const filteredPhones = phones.filter(p => !activeCasePhones.has(String(p)));

  if (filteredPhones.length === 0) {
    await campaignRef.update({
      status: 'completed',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { sentCount: 0, failedCount: 0, total: 0 };
  }

  const remaining = dailyLimit > 0 ? dailyLimit - orgSentToday : filteredPhones.length;
  const toSend = filteredPhones.slice(0, remaining);

  let sentCount = 0;
  let failedCount = 0;

  const useTemplate = campaign.channelMode === 'template' && !!campaign.templateName;
  const hasActionButton = !useTemplate && campaign.actionKeywordEnabled && campaign.actionButtonLabel;
  let finalMessage = campaign.message;
  // El opt-out solo se concatena en mensajes libres; en plantillas debe ser un botón aprobado en Meta.
  if (!useTemplate && !hasActionButton && campaign.includeOptOut) {
    finalMessage += `\n\n_¿Deseas recibir más información como esta? Responde *SI* o *NO*_`;
  }

  const templateComponents = useTemplate ? buildTemplateComponents(campaign) : null;
  const unitCost = unitCostFor(campaign);

  for (let i = 0; i < toSend.length; i++) {
    const phone = toSend[i];
    try {
      await runWithOrgId(orgId, async () => {
        if (useTemplate) {
          await sendTemplateMessage(campaign.templateName, campaign.templateLang || 'es', templateComponents, phone);
        } else if (hasActionButton) {
          const buttonId = `campaign_order_${campaignId}`;
          const buttonTitle = (campaign.actionButtonLabel || 'Pedir').substring(0, 20);
          await sendInteractiveImageButton(campaign.imageUrl || null, finalMessage, buttonId, buttonTitle, phone);
        } else if (campaign.imageUrl) {
          await sendImageMessage(campaign.imageUrl, finalMessage, phone);
        } else {
          await sendTextMessage(finalMessage, phone);
        }
      });
      sentCount++;
      await logSend(campaignRef, { phone, status: 'sent', runDate: today, unitCost });
    } catch (err) {
      console.error(`Campaign ${campaignId}: fallo envío a ${phone}:`, err.message);
      failedCount++;
      await logSend(campaignRef, { phone, status: 'failed', runDate: today, error: err.message || 'Error desconocido' });
    }
    if (i < toSend.length - 1) await sleep(SEND_DELAY_MS);
  }

  // Acumular el gasto del mes para el control de facturación (panel SA)
  await recordBilling(orgId, campaign, sentCount);

  // Calcular siguiente ejecución o marcar completada
  const updateData = {
    sentTotal: admin.firestore.FieldValue.increment(sentCount),
    failedTotal: admin.firestore.FieldValue.increment(failedCount),
    sentToday: campaignSentToday + sentCount,
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
  } else if (campaign.type === 'weekly') {
    updateData.nextRunAt = computeWeeklyNext(
      campaign.weeklyDays || [], campaign.weeklyHour ?? 9, campaign.weeklyMinute ?? 0
    ).toISOString();
  } else if (campaign.type === 'monthly') {
    updateData.nextRunAt = computeMonthlyNext(
      campaign.monthlyDay || 1, campaign.monthlyHour ?? 9, campaign.monthlyMinute ?? 0
    ).toISOString();
  }

  await campaignRef.update(updateData);

  console.log(`✅ Campaign ${campaignId} (${orgId}): enviados ${sentCount}, fallidos ${failedCount}`);
  return { sentCount, failedCount, total: toSend.length };
};

// ── Ejecuta una campaña de recordatorio (anclada a un campo fecha de una colección) ──
// Recorre los registros y envía a los que cumplen "fecha + offsetDays === hoy", una sola vez.
const runReminderCampaign = async (orgId, campaignId) => {
  const campaignRef = db
    .collection('organizations').doc(orgId)
    .collection('campaigns').doc(campaignId);

  const snap = await campaignRef.get();
  if (!snap.exists) return { sentCount: 0, failedCount: 0 };
  const campaign = { id: campaignId, ...snap.data() };

  if (campaign.status !== 'active') return { sentCount: 0, failedCount: 0 };
  if (campaign.recipientSource !== 'collection' || !campaign.collectionId || !campaign.reminderDateField) {
    return { sentCount: 0, failedCount: 0 };
  }

  const today = getTodayLocal();
  const now = new Date();
  const sendHour = campaign.reminderHour ?? 9;
  const sendMinute = campaign.reminderMinute ?? 0;

  // Aún no es la hora de envío de hoy → se reintentará en el próximo tick
  if (now.getHours() < sendHour || (now.getHours() === sendHour && now.getMinutes() < sendMinute)) {
    return { sentCount: 0, failedCount: 0 };
  }

  // Límite diario global de la org
  const orgSnap = await db.collection('organizations').doc(orgId).get();
  const dailyLimit = (orgSnap.exists ? orgSnap.data() : {}).dailyBulkLimit || 0;
  let orgSentToday = dailyLimit > 0 ? await getOrgSentToday(orgId, today) : 0;
  if (dailyLimit > 0 && orgSentToday >= dailyLimit) return { sentCount: 0, failedCount: 0 };

  // Colección de registros
  const colDef = await db
    .collection('organizations').doc(orgId)
    .collection('_collections').doc(campaign.collectionId).get();
  if (!colDef.exists) return { sentCount: 0, failedCount: 0 };
  const slug = colDef.data().slug || campaign.collectionId;
  const recordsSnap = await db
    .collection('organizations').doc(orgId)
    .collection(slug).get();

  const optedOut = new Set(campaign.optedOutPhones || []);
  const activeCasePhones = await getActiveCasePhones(orgId);
  const offset = Number(campaign.reminderOffsetDays || 0);
  const useTemplate = campaign.channelMode === 'template' && !!campaign.templateName;

  let sentCount = 0;
  let failedCount = 0;
  let campaignSentToday = campaign.sentTodayDate === today ? (campaign.sentToday || 0) : 0;
  const unitCost = unitCostFor(campaign);

  for (const recDoc of recordsSnap.docs) {
    if (dailyLimit > 0 && orgSentToday >= dailyLimit) break;

    const rec = recDoc.data();
    const dateVal = parseRecordDate(rec[campaign.reminderDateField]);
    if (!dateVal) continue;

    // Día en que toca enviar = fecha del registro + offset
    const sendDay = new Date(dateVal);
    sendDay.setDate(sendDay.getDate() + offset);
    if (ymd(sendDay) !== today) continue;

    const phone = rec[campaign.phoneField];
    if (!phone || String(phone).length < 8) continue;
    const phoneStr = String(phone);
    if (optedOut.has(phoneStr) || activeCasePhones.has(phoneStr)) continue;

    // Evitar reenvíos: un doc por (registro, día)
    const sentRef = campaignRef.collection('reminderSends').doc(`${recDoc.id}_${today}`);
    const sentSnap = await sentRef.get();
    if (sentSnap.exists) continue;

    try {
      await runWithOrgId(orgId, async () => {
        if (useTemplate) {
          const comps = buildTemplateComponents(campaign, rec);
          await sendTemplateMessage(campaign.templateName, campaign.templateLang || 'es', comps, phoneStr);
        } else {
          // Mensaje libre: reemplaza {{campo}} con valores del registro
          let msg = String(campaign.message || '').replace(/\{\{\s*([\w.\-]+)\s*\}\}/g, (_, k) => String(rec[k] ?? ''));
          if (campaign.imageUrl) await sendImageMessage(campaign.imageUrl, msg, phoneStr);
          else await sendTextMessage(msg, phoneStr);
        }
      });
      await sentRef.set({
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        phone: phoneStr,
        recordId: recDoc.id
      });
      sentCount++; orgSentToday++; campaignSentToday++;
      await logSend(campaignRef, { phone: phoneStr, status: 'sent', runDate: today, unitCost, recordId: recDoc.id });
    } catch (err) {
      console.error(`Reminder ${campaignId}: fallo envío a ${phoneStr}:`, err.message);
      failedCount++;
      await logSend(campaignRef, { phone: phoneStr, status: 'failed', runDate: today, error: err.message || 'Error desconocido', recordId: recDoc.id });
    }
    await sleep(SEND_DELAY_MS);
  }

  // Acumular el gasto del mes para el control de facturación (panel SA)
  await recordBilling(orgId, campaign, sentCount);

  if (sentCount > 0 || failedCount > 0) {
    await campaignRef.update({
      sentTotal: admin.firestore.FieldValue.increment(sentCount),
      failedTotal: admin.firestore.FieldValue.increment(failedCount),
      sentToday: campaignSentToday,
      sentTodayDate: today,
      lastRunAt: new Date().toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`🔔 Reminder ${campaignId} (${orgId}): enviados ${sentCount}, fallidos ${failedCount}`);
  }
  return { sentCount, failedCount };
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
          .where('type', 'in', ['once', 'daily', 'interval', 'monthly', 'weekly'])
          .get();

        for (const docSnap of snap.docs) {
          const campaign = docSnap.data();
          if (!campaign.nextRunAt || campaign.nextRunAt > now) continue;
          await runCampaign(orgId, docSnap.id).catch(err => {
            console.error(`Scheduler: error en campaña ${docSnap.id}:`, err.message);
          });
        }

        // Campañas de recordatorio (ancladas a fecha) — se evalúan cada tick
        const remSnap = await db
          .collection('organizations').doc(orgId)
          .collection('campaigns')
          .where('status', '==', 'active')
          .where('type', '==', 'reminder')
          .get();

        for (const docSnap of remSnap.docs) {
          await runReminderCampaign(orgId, docSnap.id).catch(err => {
            console.error(`Scheduler: error en recordatorio ${docSnap.id}:`, err.message);
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

// ── Registra opt-out de un número en todas las campañas activas con includeOptOut ──
const registerCampaignOptOut = async (orgId, phoneNumber) => {
  try {
    const snap = await db
      .collection('organizations').doc(orgId)
      .collection('campaigns')
      .where('includeOptOut', '==', true)
      .get();

    const batch = db.batch();
    let count = 0;
    snap.docs.forEach(doc => {
      const data = doc.data();
      const phones = data.manualPhones || [];
      // Solo aplica si el número está en la lista o si es colección (opt-out global)
      if (data.recipientSource === 'collection' || phones.includes(phoneNumber)) {
        const optedOut = data.optedOutPhones || [];
        if (!optedOut.includes(phoneNumber)) {
          batch.update(doc.ref, {
            optedOutPhones: [...optedOut, phoneNumber]
          });
          count++;
        }
      }
    });

    if (count > 0) await batch.commit();
    return count;
  } catch (err) {
    console.error('Error registrando opt-out de campaña:', err.message);
    return 0;
  }
};

module.exports = { runCampaign, startCampaignScheduler, registerCampaignOptOut };
