const { getAllSessions, clearSession } = require("../config/sessionData");
const { sendTextMessage } = require("../models/messageModel");
const { getGeneralConfig, getMessage } = require("./botMessagesService");
const { getConversationMode, saveMessage } = require("./conversationService");
const { runWithOrgId } = require("../config/requestContext");

const CHECK_INTERVAL = 30000; // Check every 30 seconds
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos de cooldown tras enviar aviso

let running = false;
// configCache por org: { [orgId]: { config, cachedAt } }
const configCacheByOrg = {};
const recentlyExpired = new Map(); // "orgId:phone" -> timestamp

const checkInactiveSessions = async () => {
  if (running) return;
  running = true;

  try {
    const sessions = getAllSessions(); // claves: "orgId:phone"
    const now = Date.now();

    // Limpiar cooldowns vencidos
    for (const [key, ts] of recentlyExpired.entries()) {
      if (now - ts > COOLDOWN_MS) recentlyExpired.delete(key);
    }

    // Agrupar sesiones por orgId
    const byOrg = {};
    for (const [key, session] of Object.entries(sessions)) {
      const colonIdx = key.indexOf(":");
      if (colonIdx === -1) continue;
      const orgId = key.slice(0, colonIdx);
      const phone = key.slice(colonIdx + 1);
      if (!byOrg[orgId]) byOrg[orgId] = [];
      byOrg[orgId].push({ phone, session });
    }

    for (const [orgId, entries] of Object.entries(byOrg)) {
      await runWithOrgId(orgId, async () => {
        // Config con cache por org
        if (!configCacheByOrg[orgId] || (now - configCacheByOrg[orgId].cachedAt) > CONFIG_CACHE_TTL) {
          try {
            configCacheByOrg[orgId] = { config: await getGeneralConfig(), cachedAt: now };
          } catch (err) {
            console.error(`[inactivity] Error loading config for ${orgId}:`, err.message);
            return;
          }
        }
        const timeout = configCacheByOrg[orgId].config?.inactivityTimeout || 180000;

        for (const { phone, session } of entries) {
          const cacheKey = `${orgId}:${phone}`;
          if (!session.hasGreeted) continue;
          if (recentlyExpired.has(cacheKey)) continue;

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

            recentlyExpired.set(cacheKey, now);
            await clearSession(phone);
            console.log(`Session expired for ${orgId}:${phone} (inactive ${Math.round((now - lastTime) / 60000)}min)`);
          } catch (err) {
            console.error(`Error expiring session ${orgId}:${phone}:`, err.message);
          }
        }
      });
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
