const { getAllSessions, clearSession } = require("../config/sessionData");
const { sendTextMessage } = require("../models/messageModel");
const { getGeneralConfig, getMessage } = require("./botMessagesService");
const { getConversationMode, saveMessage } = require("./conversationService");

const CHECK_INTERVAL = 30000; // Check every 30 seconds
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos de cooldown tras enviar aviso

let running = false;
let cachedConfig = null;
let configCachedAt = 0;
const recentlyExpired = new Map(); // phone -> timestamp

const checkInactiveSessions = async () => {
  if (running) return;
  running = true;

  try {
    if (!cachedConfig || (Date.now() - configCachedAt) > CONFIG_CACHE_TTL) {
      cachedConfig = await getGeneralConfig();
      configCachedAt = Date.now();
    }
    const config = cachedConfig;
    const timeout = config?.inactivityTimeout || 180000;
    const sessions = getAllSessions();
    const now = Date.now();

    // Limpiar cooldowns vencidos
    for (const [p, ts] of recentlyExpired.entries()) {
      if (now - ts > COOLDOWN_MS) recentlyExpired.delete(p);
    }

    for (const [phone, session] of Object.entries(sessions)) {
      if (!session.hasGreeted) continue;
      if (recentlyExpired.has(phone)) continue;

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

        recentlyExpired.set(phone, now);
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
