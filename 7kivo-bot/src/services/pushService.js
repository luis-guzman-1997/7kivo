const webpush = require("web-push");
const { db } = require("../config/firebase");
const { getOrgId } = require("../config/orgConfig");

webpush.setVapidDetails(
  "mailto:admin@7kivo.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Envía push notifications a los usuarios de delivery.
 *
 * payload.flowId   → solo usuarios cuyo assignedFlows incluye el flujo
 *                    (si assignedFlows está vacío, recibe todo)
 * payload.promoOnly → solo usuarios con canSeePromoOrders !== false
 * Sin ninguno      → todos los suscritos
 */
const sendPushToDeliveries = async (payload) => {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    const orgRef = db.collection("organizations").doc(getOrgId());

    // Determinar qué UIDs deben recibir la notificación
    let targetUids = null; // null = sin restricción

    if (payload.flowId || payload.promoOnly) {
      const adminsSnap = await orgRef.collection("admins").get();
      const matched = adminsSnap.docs
        .map(d => d.data())
        .filter(a => {
          if (!a.uid) return false;
          if (payload.flowId) {
            const assigned = a.assignedFlows || [];
            // Sin restricción de flujo → recibe todo; con restricción → solo si está asignado
            return assigned.length === 0 || assigned.includes(payload.flowId);
          }
          if (payload.promoOnly) {
            return a.canSeePromoOrders !== false;
          }
          return true;
        });
      targetUids = new Set(matched.map(a => a.uid));
    }

    const snapshot = await orgRef.collection("pushSubscriptions").get();
    if (snapshot.empty) return;

    const pushPayload = JSON.stringify({
      notification: {
        title: payload.title,
        body: payload.body,
        icon: "/favicon.ico",
        data: { url: payload.url || "/admin/inbox" }
      }
    });

    for (const docSnap of snapshot.docs) {
      const { subscription, userId } = docSnap.data();
      if (!subscription?.endpoint) continue;
      if (targetUids !== null && (!userId || !targetUids.has(userId))) continue;
      try {
        await webpush.sendNotification(subscription, pushPayload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await docSnap.ref.delete();
        }
      }
    }
  } catch (err) {
    console.error("Error sending push notifications:", err.message);
  }
};

module.exports = { sendPushToDeliveries };
