const webpush = require("web-push");
const { db } = require("../config/firebase");
const { getOrgId } = require("../config/orgConfig");

webpush.setVapidDetails(
  "mailto:admin@7kivo.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const sendPushToDeliveries = async (payload) => {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    const orgRef = db.collection("organizations").doc(getOrgId());
    const snapshot = await orgRef.collection("pushSubscriptions").get();
    if (snapshot.empty) return;

    // Angular NGSW expects { notification: { title, body, data } }
    const pushPayload = JSON.stringify({
      notification: {
        title: payload.title,
        body: payload.body,
        icon: "/favicon.ico",
        data: { url: payload.url || "/admin/inbox" }
      }
    });

    for (const docSnap of snapshot.docs) {
      const { subscription } = docSnap.data();
      if (!subscription?.endpoint) continue;
      try {
        await webpush.sendNotification(subscription, pushPayload);
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscripción expirada — la eliminamos
          await docSnap.ref.delete();
        }
      }
    }
  } catch (err) {
    console.error("Error sending push notifications:", err.message);
  }
};

module.exports = { sendPushToDeliveries };
