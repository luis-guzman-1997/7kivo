/**
 * Seed script: Caluco Express — Servicio de Delivery
 *
 * Organización: caluco-express
 *
 * Flujos:
 * - Solicitar Mandado  → colección "mandados"  (nombre, necesidad)
 * - Solicitar Viaje    → colección "viajes"    (nombre, necesidad)
 *   El tipo de servicio queda implícito en la elección del menú.
 *   phoneNumber se captura automáticamente de WhatsApp.
 *
 * Menú:
 * - 📦 Solicitar Mandado (flujo)
 * - 🚗 Solicitar Viaje   (flujo)
 * - Horarios (builtin) — 24/7
 *
 * NO toca:
 * - Usuarios existentes (owners/admins)
 * - Config WhatsApp (token, phoneNumberId)
 * - Logo (orgLogo en config/general)
 * - botApiUrl
 * - Greeting y mensajes del menú existentes en Firebase
 *
 * Uso:
 *   cd 7kivo-bot
 *   ORG_ID=caluco-express node scripts/seed-caluco-express.js
 */

require("dotenv").config();
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID || "kivo7-app";
const ORG_ID = process.env.ORG_ID || "caluco-express";

// ==================== CONFIGURACIÓN ====================

const EMPRESA = {
  orgName: "Caluco Express",
  description: "Lo pedís, lo llevamos. Servicio de delivery y transporte en Caluco.",
  industry: "shipping",

  contact: {
    address: "Caluco, Sonsonate, El Salvador",
    city: "Caluco",
    country: "El Salvador",
    phone: "+15551727026",
    email: "",
    showFields: { address: true, city: true, country: true, phone: true, email: false }
  },

  // 24/7: todos los días, turno completo
  schedule: {
    days: [
      { name: "Lunes",     active: true, shifts: [{ from: "00:00", to: "23:59" }] },
      { name: "Martes",    active: true, shifts: [{ from: "00:00", to: "23:59" }] },
      { name: "Miércoles", active: true, shifts: [{ from: "00:00", to: "23:59" }] },
      { name: "Jueves",    active: true, shifts: [{ from: "00:00", to: "23:59" }] },
      { name: "Viernes",   active: true, shifts: [{ from: "00:00", to: "23:59" }] },
      { name: "Sábado",    active: true, shifts: [{ from: "00:00", to: "23:59" }] },
      { name: "Domingo",   active: true, shifts: [{ from: "00:00", to: "23:59" }] }
    ],
    slotDuration: 30,
    blockedDates: [],
    offersAppointments: false
  },

  general: {
    focus: ["Mandados", "Viajes", "Transporte rápido"],
    modality: "A domicilio",
    services: "Mandados, viajes, transporte en moto, cuté o pickup.",
    note: "Operamos las 24 horas del día, los 7 días de la semana."
  }
};

// Pasos compartidos para ambos flujos
const FLOW_STEPS = [
  {
    id: "s1",
    type: "text_input",
    prompt: "¿Cuál es tu *nombre*?",
    fieldKey: "nombre",
    fieldLabel: "Nombre",
    required: true,
    validation: { minLength: 2 },
    errorMessage: "Escribe al menos 2 caracteres.",
    optional: false,
    optionsSource: "custom",
    customOptions: [],
    buttonText: "",
    sourceCollection: "",
    displayField: "",
    detailFields: []
  },
  {
    id: "s2",
    type: "text_input",
    prompt: "Cuéntanos *qué necesitas* 📝\n\n_Incluye: punto de partida, destino y cualquier detalle importante._",
    fieldKey: "necesidad",
    fieldLabel: "Detalle",
    required: true,
    validation: { minLength: 5 },
    errorMessage: "Por favor describe mejor lo que necesitas para poder atenderte.",
    optional: false,
    optionsSource: "custom",
    customOptions: [],
    buttonText: "",
    sourceCollection: "",
    displayField: "",
    detailFields: []
  }
];

// ==================== INICIALIZACIÓN FIREBASE ====================

const credsVal = (
  process.env.GOOGLE_SERVICE_ACCOUNT_PATH ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  ""
).trim();

if (credsVal.startsWith("{")) {
  try {
    const sa = JSON.parse(credsVal);
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId });
  } catch (e) {
    console.error("Error parseando credenciales:", e.message);
    process.exit(1);
  }
} else if (credsVal) {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
} else {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
const ts = admin.firestore.FieldValue.serverTimestamp;
const orgRef = db.collection("organizations").doc(ORG_ID);

// ==================== HELPERS ====================

async function deleteCollection(collRef) {
  const snapshot = await collRef.get();
  if (snapshot.empty) return 0;
  const batchSize = 400;
  let deleted = 0;
  for (let i = 0; i < snapshot.docs.length; i += batchSize) {
    const batch = db.batch();
    snapshot.docs.slice(i, i + batchSize).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += Math.min(batchSize, snapshot.docs.length - i);
  }
  return deleted;
}

// ==================== MAIN ====================

async function seedCalucoExpress() {
  console.log("\n========================================");
  console.log("  Caluco Express — Delivery");
  console.log(`  Org ID: ${ORG_ID}`);
  console.log("========================================\n");

  try {
    // 1. Leer config/general existente (preservar orgLogo, botApiUrl, etc.)
    console.log("1. Leyendo configuración actual...");
    let existingConfig = {};
    const configDoc = await orgRef.collection("config").doc("general").get();
    if (configDoc.exists) {
      existingConfig = configDoc.data();
      console.log(`   orgName:   ${existingConfig.orgName || "(vacío)"}`);
      console.log(`   botApiUrl: ${existingConfig.botApiUrl ? "✓" : "(vacío)"}`);
      console.log(`   logo:      ${existingConfig.orgLogo ? "✓ preservado" : "(sin logo)"}`);
    } else {
      console.log("   Sin config previa — se creará con valores por defecto.");
    }

    const orgName = existingConfig.orgName || EMPRESA.orgName;
    const description = existingConfig.description || EMPRESA.description;

    // Crear o actualizar config/general (sin tocar botApiUrl, orgLogo, token)
    if (!configDoc.exists) {
      await orgRef.collection("config").doc("general").set({
        orgName,
        description,
        industry: EMPRESA.industry,
        personalWhatsApp: "",
        welcomeMessage: `Bienvenido a ${orgName}`,
        inactivityTimeout: 180000,
        botApiUrl: "",
        createdAt: ts()
      });
      console.log("   Config general creada.\n");
    } else {
      await orgRef.collection("config").doc("general").update({
        industry: EMPRESA.industry,
        description,
        orgName,
        updatedAt: ts()
      });
      console.log("   Config general actualizada. ✓\n");
    }

    // 2. Preservar WhatsApp config
    let savedWAConfig = null;
    const waDoc = await orgRef.collection("config").doc("whatsapp").get();
    if (waDoc.exists && waDoc.data()?.token) {
      savedWAConfig = waDoc.data();
      console.log("2. Credenciales WhatsApp preservadas. ✓\n");
    } else {
      console.log("2. Sin credenciales WhatsApp configuradas aún.\n");
    }

    // 3. Preservar greeting y mensajes del menú existentes
    console.log("3. Leyendo menú existente...");
    let existingMenu = {};
    const menuDoc = await orgRef.collection("config").doc("menu").get();
    if (menuDoc.exists) {
      existingMenu = menuDoc.data();
      console.log("   Greeting y mensajes del menú preservados. ✓\n");
    } else {
      console.log("   Sin menú previo — se usarán valores por defecto.\n");
    }

    // 4. Limpiar flujos, colecciones (solicitudes → se reemplaza por mandados/viajes)
    console.log("4. Limpiando datos previos...");
    const toClean = ["flows", "botMessages", "_collections", "solicitudes", "mandados", "viajes"];
    for (const col of toClean) {
      const count = await deleteCollection(orgRef.collection(col));
      if (count > 0) console.log(`   - ${col}: ${count} docs eliminados`);
    }
    const menuDocRef = orgRef.collection("config").doc("menu");
    if ((await menuDocRef.get()).exists) await menuDocRef.delete();
    console.log("   Limpieza completada.\n");

    // 5. Actualizar org raíz
    await orgRef.set({
      name: orgName,
      industry: EMPRESA.industry,
      active: true,
      setupComplete: true,
      updatedAt: ts()
    }, { merge: true });

    // 6. Definición de colecciones
    console.log("5. Creando definición de colecciones...");
    const collectionFields = [
      { key: "nombre",      label: "Nombre",  type: "text", required: true },
      { key: "necesidad",   label: "Detalle", type: "text", required: true },
      { key: "phoneNumber", label: "WhatsApp", type: "text", required: false }
    ];
    await orgRef.collection("_collections").add({
      name: "Mandados",
      slug: "mandados",
      description: "Solicitudes de mandados recibidas por el bot",
      displayField: "nombre",
      fields: collectionFields,
      createdAt: ts(),
      updatedAt: ts()
    });
    console.log("   mandados ✓");
    await orgRef.collection("_collections").add({
      name: "Viajes",
      slug: "viajes",
      description: "Solicitudes de viajes recibidas por el bot",
      displayField: "nombre",
      fields: collectionFields,
      createdAt: ts(),
      updatedAt: ts()
    });
    console.log("   viajes ✓\n");

    // 7. Flujos
    console.log("6. Creando flujos...");
    const mandadoFlowRef = await orgRef.collection("flows").add({
      name: "Solicitar Mandado",
      description: "Solicita un mandado con Caluco Express",
      type: "registration",
      active: true,
      order: 1,
      saveToCollection: "mandados",
      menuLabel: "Solicitar Mandado",
      menuDescription: "Llevar o traer algo",
      showInMenu: true,
      steps: FLOW_STEPS,
      completionMessage: "✅ *¡Mandado registrado!*\n\n👤 *Nombre:* {nombre}\n📝 *Detalle:* {necesidad}\n\nNuestro equipo se pondrá en contacto contigo muy pronto para coordinar. 🛵\n\n_Caluco Express — Lo pedís, lo llevamos_",
      createdAt: ts(),
      updatedAt: ts()
    });
    console.log("   Solicitar Mandado ✓");

    const viajeFlowRef = await orgRef.collection("flows").add({
      name: "Solicitar Viaje",
      description: "Solicita un viaje con Caluco Express",
      type: "registration",
      active: true,
      order: 2,
      saveToCollection: "viajes",
      menuLabel: "Solicitar Viaje",
      menuDescription: "Transporte de personas",
      showInMenu: true,
      steps: FLOW_STEPS,
      completionMessage: "✅ *¡Viaje registrado!*\n\n👤 *Nombre:* {nombre}\n📝 *Detalle:* {necesidad}\n\nNuestro equipo se pondrá en contacto contigo muy pronto para coordinar. 🚗\n\n_Caluco Express — Lo pedís, lo llevamos_",
      createdAt: ts(),
      updatedAt: ts()
    });
    console.log("   Solicitar Viaje ✓\n");

    // 8. Menú (preservar greeting/fallback/exit/menuButtonText existentes)
    console.log("7. Configurando menú...");
    await orgRef.collection("config").doc("menu").set({
      greeting: existingMenu.greeting ||
        "¡Hola{name}! 👋\n\nBienvenido a *Caluco Express* 🛵\n\n_Lo pedís, lo llevamos — 24/7_\n\n¿En qué te ayudamos hoy?",
      menuButtonText: existingMenu.menuButtonText || "Ver servicios",
      fallbackMessage: existingMenu.fallbackMessage ||
        "No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones disponibles.",
      exitMessage: existingMenu.exitMessage ||
        "¡Hasta pronto! 👋\n\nFue un gusto atenderte. Escribe *hola* cuando nos necesites.\n\n_Caluco Express 🛵_",
      items: [
        { id: "m1", type: "flow",    flowId: mandadoFlowRef.id, label: "📦 Solicitar Mandado", description: "Llevar o traer algo",          order: 1, active: true },
        { id: "m2", type: "flow",    flowId: viajeFlowRef.id,   label: "🚗 Solicitar Viaje",   description: "Transporte de personas",       order: 2, active: true },
        { id: "m3", type: "builtin", action: "schedule",         label: "Horarios",             description: "Disponibles las 24 horas, 7 días", order: 3, active: true }
      ],
      createdAt: ts()
    });
    console.log("   Menú configurado ✓\n");

    // 9. Bot messages
    console.log("8. Configurando mensajes del bot...");
    const botMessages = [
      { key: "greeting",         label: "Saludo principal",       category: "greeting", description: "Mensaje de bienvenida",            content: existingMenu.greeting || "¡Hola{name}! 👋\n\nBienvenido a *Caluco Express* 🛵\n\n_Lo pedís, lo llevamos — 24/7_\n\n¿En qué te ayudamos hoy?" },
      { key: "fallback",         label: "Mensaje no reconocido",  category: "fallback", description: "Cuando el bot no entiende",        content: "No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones disponibles." },
      { key: "goodbye",          label: "Despedida",              category: "general",  description: "Cuando el usuario se despide",     content: "¡Hasta pronto! 👋\n\nFue un gusto atenderte. Escribe *hola* cuando nos necesites.\n\n_Caluco Express 🛵_" },
      { key: "session_expired",  label: "Sesión expirada",        category: "general",  description: "Cierre por inactividad",           content: "Tu sesión se cerró por inactividad.\n\nEscribe *hola* para volver al menú." },
      { key: "cancel",           label: "Cancelación",            category: "general",  description: "Cuando cancela un proceso",        content: "Proceso cancelado. Escribe *hola* para volver al menú." },
      { key: "flow_cancel_hint", label: "Aviso de cancelación",   category: "flow",     description: "Al iniciar un flujo",              content: "Puedes escribir *cancelar* en cualquier momento para detener este proceso.\n" },
      { key: "admin_farewell",   label: "Despedida de admin",     category: "admin",    description: "Cuando admin devuelve el control", content: "La conversación con nuestro equipo ha finalizado.\n\nEscribe *hola* para ver el menú." },
      { key: "no_registration",  label: "Registro no disponible", category: "flow",     description: "Sin flujo de registro activo",     content: "El servicio no está disponible en este momento.\n\nEscribe *hola* para ver otras opciones." }
    ];
    for (const msg of botMessages) {
      await orgRef.collection("botMessages").add({ ...msg, createdAt: ts() });
    }
    console.log("   Mensajes del bot configurados ✓\n");

    // 10. Info (contact, schedule, general)
    console.log("9. Guardando info de contacto, horarios y sobre nosotros...");
    await orgRef.collection("info").doc("contact").set({ ...EMPRESA.contact, createdAt: ts() });
    await orgRef.collection("info").doc("schedule").set({ ...EMPRESA.schedule, createdAt: ts() });
    await orgRef.collection("info").doc("general").set({
      name: orgName,
      description,
      focus: EMPRESA.general.focus,
      modality: EMPRESA.general.modality,
      services: EMPRESA.general.services,
      note: EMPRESA.general.note,
      createdAt: ts()
    });
    console.log("   Info guardada ✓\n");

    // 11. Restaurar WhatsApp config si existía
    if (savedWAConfig && savedWAConfig.token) {
      await orgRef.collection("config").doc("whatsapp").set({ ...savedWAConfig, updatedAt: ts() });
      console.log("   WhatsApp config restaurada. ✓\n");
    }

    // ==================== RESUMEN ====================
    console.log("\n========================================");
    console.log("  ✅ Seed completado — Caluco Express");
    console.log("========================================\n");
    console.log(`  Org:         ${ORG_ID}`);
    console.log(`  Nombre:      ${orgName}`);
    console.log(`  Industry:    shipping`);
    console.log(`  Horario:     24/7 todos los días`);
    console.log(`  Contacto:    Caluco, Sonsonate, El Salvador`);
    console.log(`  Teléfono:    +15551727026`);
    console.log(`  Flujos:      Solicitar Mandado | Solicitar Viaje`);
    console.log(`  Colecciones: mandados (nombre, necesidad, phoneNumber)`);
    console.log(`               viajes   (nombre, necesidad, phoneNumber)`);
    console.log(`  Menú:        📦 Solicitar Mandado | 🚗 Solicitar Viaje | Horarios`);
    console.log(`  Greeting:    ${existingMenu.greeting ? "preservado de Firebase" : "por defecto"}`);
    console.log(`  Usuarios:    NO modificados`);
    console.log(`  WhatsApp:    NO modificado`);
    console.log(`  Logo:        NO modificado`);
    console.log("\n  Pendiente (desde SA panel):");
    console.log("  - Configurar WhatsApp: phoneNumberId + token");
    console.log("  - Configurar botApiUrl");
    console.log("  - Activar el bot (botEnabled)");
    console.log("");

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    process.exit(0);
  }
}

seedCalucoExpress();
