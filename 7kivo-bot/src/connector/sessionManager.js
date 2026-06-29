// Gestor multi-sesión de Baileys DENTRO del proceso del bot (Opción A).
//
// Mantiene un Map<orgId, sesión> con un socket vivo por organización que opera
// en modo "connector". Todas las sesiones viven en este mismo proceso de Railway
// (no hay un deploy por cliente). El auth state se persiste en Firestore, así que
// un redeploy las rehidrata y reconecta solas.
//
// Si algún día el volumen lo exige, este módulo se puede extraer a un servicio
// aparte cambiando las llamadas de outbound.js de función a HTTP — la interfaz
// (startSession/getStatus/getSock) no cambia.

const makeWASocket = require("@whiskeysockets/baileys").default;
const {
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const pino = require("pino");
const {
  useFirestoreAuthState,
  clearFirestoreAuthState,
} = require("./firestoreAuthState");
const { clearOrgState } = require("./menuState");

const logger = pino({ level: "silent" });

// orgId -> {
//   sock, status, qr (dataURL), qrRaw, lastError, startedAt, me, reconnects
// }
const sessions = {};

const STATUS = {
  CONNECTING: "connecting",
  QR: "qr",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  LOGGED_OUT: "logged_out",
};

const getSession = (orgId) => sessions[orgId] || null;

const getStatus = (orgId) => {
  const s = sessions[orgId];
  if (!s) return { status: STATUS.DISCONNECTED, qr: null };
  return {
    status: s.status,
    qr: s.status === STATUS.QR ? s.qr : null,
    me: s.me || null,
    lastError: s.lastError || null,
  };
};

const getSock = (orgId) => {
  const s = sessions[orgId];
  return s && s.status === STATUS.CONNECTED ? s.sock : null;
};

const isConnected = (orgId) =>
  sessions[orgId]?.status === STATUS.CONNECTED;

// Inicia (o reinicia) la sesión de una org. Idempotente: si ya está conectada
// o conectando, no hace nada y devuelve el estado actual.
const startSession = async (orgId, { force = false } = {}) => {
  const existing = sessions[orgId];
  if (
    existing &&
    !force &&
    (existing.status === STATUS.CONNECTED ||
      existing.status === STATUS.CONNECTING ||
      existing.status === STATUS.QR)
  ) {
    return getStatus(orgId);
  }

  if (existing?.sock) {
    try {
      existing.sock.ev.removeAllListeners();
      existing.sock.end();
    } catch (e) {}
  }

  const session = {
    sock: null,
    status: STATUS.CONNECTING,
    qr: null,
    qrRaw: null,
    lastError: null,
    startedAt: Date.now(),
    me: null,
    reconnects: existing?.reconnects || 0,
  };
  sessions[orgId] = session;

  try {
    const { state, saveCreds } = await useFirestoreAuthState(orgId);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger,
      browser: ["7kivo", "Chrome", "1.0.0"],
      // No marcar como en línea: respondemos como bot, no como humano.
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    session.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        session.qrRaw = qr;
        session.status = STATUS.QR;
        try {
          session.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        } catch (e) {
          session.qr = null;
        }
        console.log(`[connector:${orgId}] QR generado, esperando escaneo`);
      }

      if (connection === "open") {
        session.status = STATUS.CONNECTED;
        session.qr = null;
        session.qrRaw = null;
        session.reconnects = 0;
        session.lastError = null;
        session.me = sock.user
          ? { id: sock.user.id, name: sock.user.name || sock.user.verifiedName || "" }
          : null;
        console.log(`[connector:${orgId}] ✅ conectado como ${session.me?.id || "?"}`);
      }

      if (connection === "close") {
        const statusCode =
          lastDisconnect?.error?.output?.statusCode ??
          lastDisconnect?.error?.output?.payload?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          session.status = STATUS.LOGGED_OUT;
          session.lastError = "Sesión cerrada desde el teléfono";
          console.log(`[connector:${orgId}] sesión cerrada (logged out)`);
          try {
            await clearFirestoreAuthState(orgId);
          } catch (e) {}
          clearOrgState(orgId);
          delete sessions[orgId];
          return;
        }

        // Reconexión con backoff básico (cap a ~30s)
        session.status = STATUS.DISCONNECTED;
        session.reconnects = (session.reconnects || 0) + 1;
        session.lastError = lastDisconnect?.error?.message || "Conexión cerrada";
        const delay = Math.min(30000, 2000 * session.reconnects);
        console.log(
          `[connector:${orgId}] desconectado (code ${statusCode}). Reintento #${session.reconnects} en ${delay}ms`
        );
        setTimeout(() => {
          // Solo reconectar si nadie la cerró explícitamente mientras tanto.
          if (sessions[orgId]) startSession(orgId, { force: true }).catch(() => {});
        }, delay);
      }
    });

    sock.ev.on("messages.upsert", async (payload) => {
      try {
        if (payload.type !== "notify") return;
        const { handleIncoming } = require("./inbound");
        for (const msg of payload.messages || []) {
          await handleIncoming(orgId, sock, msg);
        }
      } catch (e) {
        console.error(`[connector:${orgId}] error en messages.upsert:`, e.message);
      }
    });

    return getStatus(orgId);
  } catch (e) {
    session.status = STATUS.DISCONNECTED;
    session.lastError = e.message;
    console.error(`[connector:${orgId}] error al iniciar sesión:`, e.message);
    return getStatus(orgId);
  }
};

// Cierra sesión y borra credenciales (desvincular el WhatsApp).
const logoutSession = async (orgId) => {
  const s = sessions[orgId];
  if (s?.sock) {
    try {
      await s.sock.logout();
    } catch (e) {}
    try {
      s.sock.ev.removeAllListeners();
      s.sock.end();
    } catch (e) {}
  }
  try {
    await clearFirestoreAuthState(orgId);
  } catch (e) {}
  clearOrgState(orgId);
  delete sessions[orgId];
  return { status: STATUS.LOGGED_OUT };
};

// Detiene la sesión en memoria SIN borrar credenciales (p.ej. al cambiar a Meta).
const stopSession = (orgId) => {
  const s = sessions[orgId];
  if (s?.sock) {
    try {
      s.sock.ev.removeAllListeners();
      s.sock.end();
    } catch (e) {}
  }
  clearOrgState(orgId);
  delete sessions[orgId];
};

// Rehidrata todas las orgs en modo conector al arrancar el proceso.
const rehydrateAll = async () => {
  try {
    const { db } = require("../config/firebase");
    // connectionType se espeja en el doc raíz de la org (además de en
    // config/whatsapp) para poder consultarlo con un índice de campo simple.
    const snap = await db
      .collection("organizations")
      .where("connectionType", "==", "connector")
      .get();
    const orgIds = [];
    snap.forEach((doc) => {
      // Solo rehidratar orgs activas y con bot habilitado.
      const d = doc.data() || {};
      if (d.active === false) return;
      orgIds.push(doc.id);
    });
    if (!orgIds.length) {
      console.log("[connector] no hay organizaciones en modo conector");
      return;
    }
    console.log(`[connector] rehidratando ${orgIds.length} sesión(es): ${orgIds.join(", ")}`);
    for (const orgId of orgIds) {
      startSession(orgId).catch((e) =>
        console.error(`[connector:${orgId}] rehidratación falló:`, e.message)
      );
    }
  } catch (e) {
    console.error("[connector] rehydrateAll error:", e.message);
  }
};

module.exports = {
  STATUS,
  startSession,
  logoutSession,
  stopSession,
  getStatus,
  getSock,
  getSession,
  isConnected,
  rehydrateAll,
};
