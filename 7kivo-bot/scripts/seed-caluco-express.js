/**
 * Seed script: Caluco Express — Servicio de Delivery
 *
 * Organización: caluco-express
 *
 * Flujos:
 * - Solicitar Servicio (mandado o viaje, tipo vehículo, detalles, nombre, teléfono)
 *
 * Menú:
 * - Solicitar Servicio (flujo)
 * - Horarios (builtin) — 24/7
 * - Ubicación (builtin) — Caluco, Sonsonate, El Salvador
 * - Sobre Nosotros (builtin)
 *
 * NO toca:
 * - Usuarios existentes (owners/admins)
 * - Config WhatsApp (token, phoneNumberId)
 * - Logo (orgLogo en config/general)
 * - botApiUrl
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

// ==================== INICIALIZACIÓN FIREBASE ====================

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const credsVal = process.env.GOOGLE_APPLICATION_CREDENTIALS.trim();
  if (credsVal.startsWith("{")) {
    try {
      const serviceAccount = JSON.parse(credsVal);
      if (serviceAccount.type === "service_account" && serviceAccount.private_key) {
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId });
      } else {
        admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
      }
    } catch (_) {
      admin.initializeApp({ projectId });
    }
  } else {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
  }
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
      // Solo actualizar industry (no tocar botApiUrl, orgLogo)
      await orgRef.collection("config").doc("general").update({
        industry: EMPRESA.industry,
        description,
        orgName,
        updatedAt: ts()
      });
      console.log("   Config general actualizada (industry, descripción).\n");
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

    // 3. Limpiar flujos, menú, botMessages, colecciones
    console.log("3. Limpiando datos previos...");
    const toClean = ["flows", "botMessages", "_collections", "solicitudes"];
    for (const col of toClean) {
      const count = await deleteCollection(orgRef.collection(col));
      if (count > 0) console.log(`   - ${col}: ${count} docs eliminados`);
    }
    for (const docName of ["menu"]) {
      const d = await orgRef.collection("config").doc(docName).get();
      if (d.exists) await d.ref.delete();
    }
    for (const docName of ["contact", "schedule", "general"]) {
      const d = await orgRef.collection("info").doc(docName).get();
      if (d.exists) await d.ref.delete();
    }
    console.log("   Limpieza completada.\n");

    // 4. Actualizar org raíz
    await orgRef.set({
      name: orgName,
      industry: EMPRESA.industry,
      active: true,
      setupComplete: true,
      updatedAt: ts()
    }, { merge: true });

    // 5. Definición de colección "solicitudes"
    console.log("4. Creando definición de colección...");
    await orgRef.collection("_collections").add({
      name: "Solicitudes de Servicio",
      slug: "solicitudes",
      description: "Solicitudes de mandados y viajes recibidas por el bot",
      displayField: "nombre",
      fields: [
        { key: "nombre",       label: "Nombre",               type: "text",   required: true },
        { key: "telefono",     label: "Teléfono de contacto", type: "text",   required: true },
        { key: "tipo_servicio",label: "Tipo de servicio",     type: "text",   required: true },
        { key: "vehiculo",     label: "Vehículo preferido",   type: "text",   required: true },
        { key: "descripcion",  label: "Descripción",          type: "text",   required: true },
        { key: "phoneNumber",  label: "WhatsApp",             type: "text",   required: false }
      ],
      createdAt: ts(),
      updatedAt: ts()
    });
    console.log("   solicitudes ✓\n");

    // 6. Flujo: Solicitar Servicio
    console.log("5. Creando flujo 'Solicitar Servicio'...");
    const servicioFlowRef = await orgRef.collection("flows").add({
      name: "Solicitar Servicio",
      description: "Solicita un mandado o viaje con Caluco Express",
      type: "registration",
      active: true,
      order: 1,
      saveToCollection: "solicitudes",
      menuLabel: "Solicitar Servicio",
      menuDescription: "Pide un mandado o viaje",
      showInMenu: true,
      steps: [
        {
          id: "s1",
          type: "options",
          prompt: `🛵 *Caluco Express* — Delivery 24/7\n\n¿Qué necesitas hoy?`,
          fieldKey: "tipo_servicio",
          fieldLabel: "Tipo de servicio",
          required: true,
          optionsSource: "custom",
          customOptions: [
            { label: "📦 Mandado", value: "Mandado", description: "Llevar o traer algo" },
            { label: "🚗 Viaje",   value: "Viaje",   description: "Transporte de personas" }
          ],
          validation: {},
          errorMessage: "Selecciona una opción para continuar.",
          buttonText: "Ver opciones",
          sourceCollection: "",
          displayField: "",
          detailFields: []
        },
        {
          id: "s2",
          type: "options",
          prompt: "¿Qué tipo de vehículo prefieres?",
          fieldKey: "vehiculo",
          fieldLabel: "Vehículo preferido",
          required: true,
          optionsSource: "custom",
          customOptions: [
            { label: "🏍️ Moto",        value: "Moto",       description: "Rápido y económico" },
            { label: "🚗 Cuté",         value: "Cuté",       description: "Para cargas medianas" },
            { label: "🛻 Pickup",       value: "Pickup",     description: "Para cargas grandes" },
            { label: "✅ Cualquiera",   value: "Cualquiera", description: "Lo que esté disponible" }
          ],
          validation: {},
          errorMessage: "Selecciona una opción para continuar.",
          buttonText: "Ver vehículos",
          sourceCollection: "",
          displayField: "",
          detailFields: []
        },
        {
          id: "s3",
          type: "text_input",
          prompt: "Descríbenos tu {tipo_servicio} 📝\n\n_Indica: punto de partida, destino y qué necesitas llevar o hacer._",
          fieldKey: "descripcion",
          fieldLabel: "Descripción",
          required: true,
          validation: { minLength: 10 },
          errorMessage: "Por favor da más detalles (mínimo 10 caracteres) para poder atenderte.",
          optionsSource: "custom",
          customOptions: [],
          buttonText: "",
          sourceCollection: "",
          displayField: "",
          detailFields: []
        },
        {
          id: "s4",
          type: "text_input",
          prompt: "¿Cuál es tu *nombre*?",
          fieldKey: "nombre",
          fieldLabel: "Nombre",
          required: true,
          validation: { minLength: 2 },
          errorMessage: "Escribe al menos 2 caracteres.",
          optionsSource: "custom",
          customOptions: [],
          buttonText: "",
          sourceCollection: "",
          displayField: "",
          detailFields: []
        },
        {
          id: "s5",
          type: "text_input",
          prompt: "¿Tu *número de teléfono* de contacto?\n\n_(Para coordinar la entrega)_",
          fieldKey: "telefono",
          fieldLabel: "Teléfono de contacto",
          required: true,
          validation: { minLength: 7 },
          errorMessage: "Escribe un número de teléfono válido.",
          optionsSource: "custom",
          customOptions: [],
          buttonText: "",
          sourceCollection: "",
          displayField: "",
          detailFields: []
        }
      ],
      completionMessage: `✅ *¡Solicitud recibida!*\n\n📋 *Servicio:* {tipo_servicio}\n🚗 *Vehículo:* {vehiculo}\n📝 *Detalle:* {descripcion}\n👤 *Nombre:* {nombre}\n📞 *Teléfono:* {telefono}\n\nNuestro equipo se pondrá en contacto contigo muy pronto para coordinar.\n\n_Caluco Express — Lo pedís, lo llevamos_ 🛵`,
      createdAt: ts(),
      updatedAt: ts()
    });
    console.log("   Flujo 'Solicitar Servicio' creado ✓\n");

    // 7. Menú
    console.log("6. Configurando menú...");
    await orgRef.collection("config").doc("menu").set({
      greeting: `¡Hola{name}! 👋\n\nBienvenido a *Caluco Express* 🛵\n\n_Lo pedís, lo llevamos — 24/7_\n\n¿En qué te ayudamos hoy?`,
      menuButtonText: "Ver servicios",
      fallbackMessage: "No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones disponibles.",
      exitMessage: `¡Hasta pronto! 👋\n\nFue un gusto atenderte. Escribe *hola* cuando nos necesites.\n\n_Caluco Express 🛵_`,
      items: [
        { id: "m1", type: "flow",    flowId: servicioFlowRef.id, label: "Solicitar Servicio", description: "Pide un mandado o viaje",          order: 1, active: true },
        { id: "m2", type: "builtin", action: "schedule",          label: "Horarios",            description: "Disponibles las 24 horas, 7 días", order: 2, active: true },
        { id: "m3", type: "builtin", action: "contact",           label: "Ubicación",           description: "Caluco, Sonsonate",                order: 3, active: true },
        { id: "m4", type: "builtin", action: "general",           label: "Sobre Nosotros",      description: "Conoce Caluco Express",            order: 4, active: true }
      ],
      createdAt: ts()
    });
    console.log("   Menú configurado ✓\n");

    // 8. Bot messages
    console.log("7. Configurando mensajes del bot...");
    const botMessages = [
      { key: "greeting",         label: "Saludo principal",       category: "greeting", description: "Mensaje de bienvenida",            content: `¡Hola{name}! 👋\n\nBienvenido a *Caluco Express* 🛵\n\n_Lo pedís, lo llevamos — 24/7_\n\n¿En qué te ayudamos hoy?` },
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

    // 9. Info (contact, schedule, general)
    console.log("8. Guardando info de contacto, horarios y sobre nosotros...");
    await orgRef.collection("info").doc("contact").set({
      ...EMPRESA.contact,
      createdAt: ts()
    });
    await orgRef.collection("info").doc("schedule").set({
      ...EMPRESA.schedule,
      createdAt: ts()
    });
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

    // 10. Restaurar WhatsApp config si existía
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
    console.log(`  Flujos:      Solicitar Servicio`);
    console.log(`  Colección:   solicitudes`);
    console.log(`  Menú:        Solicitar Servicio | Horarios | Ubicación | Sobre Nosotros`);
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
