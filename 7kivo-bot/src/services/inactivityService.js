const { getAllSessions, clearSession } = require("../config/sessionData");
const { sendTextMessage } = require("../models/messageModel");
const { getGeneralConfig, getMessage } = require("./botMessagesService");
const { getConversationMode, saveMessage } = require("./conversationService");

const CHECK_INTERVAL = 30000; // Check every 30 seconds

let running = false;

const checkInactiveSessions = async () => {
  if (running) return;
  running = true;

  try {
    const config = await getGeneralConfig();
    const timeout = config?.inactivityTimeout || 180000;
    const sessions = getAllSessions();
    const now = Date.now();

    for (const [phone, session] of Object.entries(sessions)) {
      if (!session.hasGreeted) continue;

      const lastTime = session.last_message_time
        ? new Date(session.last_message_time).getTime()
        : 0;

      if (lastTime === 0) continue;
      if ((now - lastTime) <= timeout) continue;

      try {
        const mode = await getConversationMode(phone);
        if (mode === "admin") continue;

        const msg = await getMessage("session_expired",
          "Tu sesión se cerró por inactividad. ¡Hasta luego! 👋\n\nEscribe *hola* cuando necesites ayuda.");
        await sendTextMessage(msg, phone);

        saveMessage(phone, msg, "bot").catch(() => {});

        await clearSession(phone);
        console.log(`Session expired for ${phone} (inactive ${Math.round((now - lastTime) / 60000)}min)`);
      } catch (err) {
        console.error(`Error expiring session ${phone}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Error in inactivity check:", err.message);
  } finally {
    running = false;
  }
};

let intervalId = null;

const startInactivityMonitor = () => {
  if (intervalId) return;
  intervalId = setInterval(checkInactiveSessions, CHECK_INTERVAL);
  console.log(`🕐 Monitor de inactividad activo (cada ${CHECK_INTERVAL / 1000}s)`);
};

const stopInactivityMonitor = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
};

module.exports = { startInactivityMonitor, stopInactivityMonitor };
