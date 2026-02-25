/**
 * Script exclusivo: Clínica Dr. David La Guardia
 *
 * Organización: dr-david-laguardia
 *
 * Este script inicializa/actualiza el bot con flujos de clínica médica:
 * - Contáctanos (consultas generales)
 * - Agendar Cita (citas médicas)
 *
 * RESPETA los datos del registro del negocio (config/general):
 * - orgName, description, personalWhatsApp, industry
 * Estos NO se sobrescriben.
 *
 * Uso:
 *   cd 7kivo-bot
 *   ORG_ID=dr-david-laguardia node scripts/seed-clinica-dr-david-laguardia.js
 *
 * Para ajustar: edita las variables en la sección "CONFIGURACIÓN DUMMY" abajo.
 */

require("dotenv").config();
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID || "kivo7-app";
const ORG_ID = process.env.ORG_ID || "dr-david-laguardia";

// ==================== CONFIGURACIÓN DUMMY (ajusta aquí) ====================
const CLINIC_DEFAULTS = {
  // Si no hay datos en config/general, se usan estos
  orgName: "Clínica Dr. David La Guardia",
  description: "Atención médica de calidad. Tu salud es nuestra prioridad.",
  industry: "healthcare",

  // Info de contacto (placeholders - complétalos en el panel admin)
  contact: {
    address: "[Tu dirección - ej: Col. Escalón, San Salvador]",
    city: "[Ciudad]",
    country: "El Salvador",
    phone: "[503XXXXXXXX]",
    email: "[tuclinica@email.com]"
  },

  // Horarios (ajusta los días y turnos según tu clínica)
  schedule: {
    days: [
      { name: "Lunes", active: true, shifts: [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] },
      { name: "Martes", active: true, shifts: [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] },
      { name: "Miércoles", active: true, shifts: [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] },
      { name: "Jueves", active: true, shifts: [{ from: "08:00", to: "12:00" }, { from: "14:00", to: "18:00" }] },
      { name: "Viernes", active: true, shifts: [{ from: "08:00", to: "12:00" }] },
      { name: "Sábado", active: false, shifts: [] },
      { name: "Domingo", active: false, shifts: [] }
    ],
    slotDuration: 30,
    blockedDates: []
  },

  // Info general (Sobre Nosotros)
  general: {
    focus: ["Consulta general", "Medicina preventiva", "Seguimiento de pacientes"],
    modality: "Presencial",
    services: "Consulta médica general, valoraciones, seguimiento.",
    note: "Priorizamos un trato cercano y atención personalizada."
  }
};

// ==================== INICIALIZACIÓN FIREBASE ====================

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const credsVal = process.env.GOOGLE_APPLICATION_CREDENTIALS.trim();
  if (credsVal.startsWith("{")) {
    try {
      const serviceAccount = JSON.parse(credsVal);
      if (serviceAccount.type === "service_account" && serviceAccount.private_key) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId
        });
      } else {
        admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
      }
    } catch (e) {
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

async function seedClinica() {
  console.log("\n========================================");
  console.log(`  Clínica Dr. David La Guardia`);
  console.log(`  Org ID: ${ORG_ID}`);
  console.log("========================================\n");

  try {
    // 1. Leer datos existentes del negocio (NO sobrescribir)
    console.log("1. Leyendo configuración actual del negocio...");
    let existingConfig = {};
    try {
      const configDoc = await orgRef.collection("config").doc("general").get();
      if (configDoc.exists) {
        existingConfig = configDoc.data();
        console.log(`   orgName: ${existingConfig.orgName || "(por definir)"}`);
        console.log(`   industry: ${existingConfig.industry || "(por definir)"}`);
      }
    } catch (e) {
      console.log("   Sin config previa.");
    }

    const orgName = existingConfig.orgName || CLINIC_DEFAULTS.orgName;
    const description = existingConfig.description || CLINIC_DEFAULTS.description;
    const industry = existingConfig.industry || CLINIC_DEFAULTS.industry;
    const personalWhatsApp = existingConfig.personalWhatsApp || "";
    const welcomeMessage = existingConfig.welcomeMessage || `Bienvenido a ${orgName}`;
    const inactivityTimeout = existingConfig.inactivityTimeout ?? 180000;

    // Mantener config/general SIN sobrescribir (solo merge si no existe)
    const configGeneralDoc = await orgRef.collection("config").doc("general").get();
    if (!configGeneralDoc.exists) {
      await orgRef.collection("config").doc("general").set({
        orgName,
        description,
        industry,
        personalWhatsApp,
        welcomeMessage,
        inactivityTimeout,
        botApiUrl: "",
        createdAt: ts()
      });
      console.log("   Config general creada (con valores por defecto).\n");
    } else {
      console.log("   Config general preservada (datos del registro).\n");
    }

    // 2. Preservar WhatsApp si existe
    let savedWAConfig = null;
    try {
      const waDoc = await orgRef.collection("config").doc("whatsapp").get();
      if (waDoc.exists && waDoc.data()?.token) {
        savedWAConfig = waDoc.data();
        console.log("2. Credenciales WhatsApp preservadas.\n");
      }
    } catch (_) {}

    // 3. Limpiar flujos, menú, bot messages, collections (para re-crear)
    console.log("3. Limpiando flujos y colecciones previas...");
    const toClean = ["flows", "botMessages", "_collections", "consultas", "citas"];
    for (const col of toClean) {
      const count = await deleteCollection(orgRef.collection(col));
      if (count > 0) console.log(`   - ${col}: ${count} docs`);
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

    // 4. Crear organización si no existe
    await orgRef.set({
      name: orgName,
      industry,
      active: true,
      plan: "Business",
      botEnabled: true,
      setupComplete: true,
      createdAt: ts()
    }, { merge: true });

    // 5. Colecciones
    console.log("4. Creando definiciones de colecciones...");

    await orgRef.collection("_collections").add({
      name: "Consultas",
      slug: "consultas",
      description: "Mensajes y consultas recibidos a través del bot",
      displayField: "nombre",
      fields: [
        { key: "nombre", label: "Nombre", type: "text", required: true },
        { key: "comentario", label: "Comentario/Consulta", type: "text", required: true },
        { key: "phoneNumber", label: "Teléfono", type: "text", required: true }
      ],
      createdAt: ts(),
      updatedAt: ts()
    });

    await orgRef.collection("_collections").add({
      name: "Citas",
      slug: "citas",
      description: "Citas médicas agendadas desde el bot",
      displayField: "nombre",
      fields: [
        { key: "nombre", label: "Nombre", type: "text", required: true },
        { key: "phoneNumber", label: "Teléfono", type: "text", required: true },
        { key: "motivo", label: "Motivo de consulta", type: "text", required: false },
        { key: "fecha", label: "Fecha", type: "text", required: true },
        { key: "hora", label: "Hora", type: "text", required: true },
        { key: "_apptDuration", label: "Duración (min)", type: "number", required: false }
      ],
      createdAt: ts(),
      updatedAt: ts()
    });
    console.log("   consultas, citas.\n");

    // 6. Flujos
    console.log("5. Creando flujos de clínica...");

    const contactFlowRef = await orgRef.collection("flows").add({
      name: "Contáctanos",
      description: "Recibe consultas y mensajes de los pacientes",
      type: "registration",
      active: true,
      order: 1,
      saveToCollection: "consultas",
      menuLabel: "Contáctanos",
      menuDescription: "Envíanos tu consulta o mensaje",
      showInMenu: true,
      steps: [
        {
          id: "s1",
          type: "text_input",
          prompt: `¡Hola! 👋\n\nBienvenido a *${orgName}*.\n\nPara ayudarte mejor, escribe tu *nombre completo*:`,
          fieldKey: "nombre",
          fieldLabel: "Nombre",
          required: true,
          validation: { minLength: 3 },
          errorMessage: "Necesitamos al menos 3 caracteres. Escríbelo de nuevo.",
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
          prompt: "Perfecto, *{nombre}*.\n\nEscribe tu *consulta o mensaje* y te responderemos lo antes posible:",
          fieldKey: "comentario",
          fieldLabel: "Comentario",
          required: true,
          validation: { minLength: 5 },
          errorMessage: "Escribe al menos unas palabras para poder ayudarte.",
          optionsSource: "custom",
          customOptions: [],
          buttonText: "",
          sourceCollection: "",
          displayField: "",
          detailFields: []
        }
      ],
      completionMessage: `✅ *Mensaje recibido*\n\nGracias *{nombre}*, hemos registrado tu consulta.\n\nUn miembro de nuestro equipo te contactará pronto.\n\n_${orgName}_`,
      createdAt: ts(),
      updatedAt: ts()
    });

    const apptFlowRef = await orgRef.collection("flows").add({
      name: "Agendar Cita",
      description: "Reserva una cita médica",
      type: "appointment",
      active: true,
      order: 2,
      saveToCollection: "citas",
      menuLabel: "Agendar Cita",
      menuDescription: "Reserva tu cita médica",
      showInMenu: true,
      steps: [
        {
          id: "s1",
          type: "text_input",
          prompt: `📅 *Agendar tu cita*\n\nVamos a reservar un espacio para ti en *${orgName}*.\n\nEscribe tu *nombre completo*:`,
          fieldKey: "nombre",
          fieldLabel: "Nombre",
          required: true,
          validation: { minLength: 3 },
          errorMessage: "Necesitamos al menos 3 caracteres.",
          optionsSource: "custom",
          customOptions: [],
          buttonText: "",
          sourceCollection: "",
          displayField: "",
          detailFields: [],
          timeFieldKey: ""
        },
        {
          id: "s2",
          type: "select_buttons",
          prompt: "¿Cuál es el *motivo* de tu consulta?\n\nEsto nos ayuda a preparar tu atención:",
          fieldKey: "motivo",
          fieldLabel: "Motivo",
          required: true,
          validation: {},
          errorMessage: "",
          optionsSource: "custom",
          optionsTitleField: "",
          optionsDescField: "",
          customOptions: [
            { label: "Consulta general", value: "Consulta general", description: "Revisión o síntomas generales", duration: 20 },
            { label: "Control / Seguimiento", value: "Control/Seguimiento", description: "Seguimiento de tratamiento", duration: 15 },
            { label: "Otro motivo", value: "Otro", description: "Otra consulta", duration: 20 }
          ],
          buttonText: "Ver opciones",
          sourceCollection: "",
          displayField: "",
          detailFields: [],
          timeFieldKey: ""
        },
        {
          id: "s3",
          type: "appointment_slot",
          prompt: "Elige el *día* que mejor te convenga:\n\nSolo se muestran días con disponibilidad.",
          fieldKey: "fecha",
          fieldLabel: "Fecha",
          required: true,
          timeFieldKey: "hora",
          validation: {},
          errorMessage: "",
          optionsSource: "custom",
          optionsTitleField: "",
          optionsDescField: "",
          customOptions: [{ label: "Consulta", value: "consulta", description: "Consulta médica", duration: 30 }],
          buttonText: "Ver días",
          sourceCollection: "",
          displayField: "",
          detailFields: []
        }
      ],
      completionMessage: `✅ *Cita agendada*\n\n*Nombre:* {nombre}\n*Motivo:* {motivo}\n*Fecha:* {fecha}\n*Hora:* {hora}\n\nTe esperamos en *${orgName}*.\nSi necesitas cancelar o reagendar, escríbenos.`,
      createdAt: ts(),
      updatedAt: ts()
    });

    console.log("   Flujos: Contáctanos, Agendar Cita\n");

    // 7. Menú
    console.log("6. Configurando menú...");
    await orgRef.collection("config").doc("menu").set({
      greeting: `¡Hola{name}! 👋\n\nBienvenido a *${orgName}*.\n\n¿Cómo podemos ayudarte hoy?`,
      menuButtonText: "Ver opciones",
      fallbackMessage: "No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones disponibles.",
      exitMessage: `¡Hasta pronto!\n\nFue un gusto atenderte. Escribe *hola* cuando quieras volver.\n\n_${orgName}_`,
      items: [
        { id: "m1", type: "flow", flowId: contactFlowRef.id, label: "Contáctanos", description: "Envíanos tu consulta", order: 1, active: true },
        { id: "m2", type: "flow", flowId: apptFlowRef.id, label: "Agendar Cita", description: "Reserva tu cita médica", order: 2, active: true },
        { id: "m3", type: "builtin", action: "schedule", label: "Horarios", description: "Días y horarios de atención", order: 3, active: true },
        { id: "m4", type: "builtin", action: "contact", label: "Ubicación", description: "Cómo encontrarnos", order: 4, active: true },
        { id: "m5", type: "builtin", action: "general", label: "Sobre Nosotros", description: "Conoce nuestra clínica", order: 5, active: true }
      ],
      createdAt: ts()
    });

    // 8. Bot messages
    console.log("7. Mensajes del bot...");
    const botMessages = [
      { key: "greeting", label: "Saludo principal", category: "greeting", description: "Mensaje de bienvenida", content: `¡Hola{name}! 👋\n\nBienvenido a *${orgName}*.\n\n¿Cómo podemos ayudarte hoy?` },
      { key: "fallback", label: "Mensaje no reconocido", category: "fallback", description: "Cuando el bot no entiende", content: "No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones." },
      { key: "goodbye", label: "Despedida", category: "general", description: "Cuando el usuario se despide", content: "¡Hasta pronto!\n\nFue un gusto atenderte. Escribe *hola* cuando quieras volver." },
      { key: "session_expired", label: "Sesión expirada", category: "general", description: "Cierre por inactividad", content: "Tu sesión se cerró por inactividad.\n\nEscribe *hola* cuando quieras retomar." },
      { key: "cancel", label: "Cancelación", category: "general", description: "Cuando cancela un proceso", content: "Proceso cancelado. Escribe *hola* para volver al menú." },
      { key: "flow_cancel_hint", label: "Aviso de cancelación", category: "flow", description: "Al iniciar un flujo", content: "Puedes escribir *cancelar* en cualquier momento para detener este proceso.\n" },
      { key: "admin_farewell", label: "Despedida de admin", category: "admin", description: "Cuando admin devuelve control", content: "La conversación con nuestro equipo ha finalizado.\n\nEscribe *hola* para ver el menú." },
      { key: "no_registration", label: "Registro no disponible", category: "flow", description: "Sin flujo de registro", content: "El registro no está disponible en este momento.\n\nEscribe *hola* para ver otras opciones." }
    ];
    for (const msg of botMessages) {
      await orgRef.collection("botMessages").add({ ...msg, createdAt: ts() });
    }

    // 9. Info (placeholders - el usuario los completa en admin)
    console.log("8. Información base (placeholders)...");
    await orgRef.collection("info").doc("contact").set({
      ...CLINIC_DEFAULTS.contact,
      createdAt: ts()
    });
    await orgRef.collection("info").doc("schedule").set({
      ...CLINIC_DEFAULTS.schedule,
      createdAt: ts()
    });
    await orgRef.collection("info").doc("general").set({
      orgName,
      description,
      focus: CLINIC_DEFAULTS.general.focus,
      modality: CLINIC_DEFAULTS.general.modality,
      services: CLINIC_DEFAULTS.general.services,
      note: CLINIC_DEFAULTS.general.note,
      createdAt: ts()
    });

    // 10. WhatsApp config
    if (savedWAConfig && savedWAConfig.token) {
      await orgRef.collection("config").doc("whatsapp").set({ ...savedWAConfig, updatedAt: ts() });
    }

    // ==================== RESUMEN ====================

    console.log("\n========================================");
    console.log("  Seed completado");
    console.log("========================================\n");
    console.log(`  Org:         ${ORG_ID}`);
    console.log(`  Nombre:      ${orgName}`);
    console.log(`  Flujos:      Contáctanos | Agendar Cita`);
    console.log(`  Colecciones: consultas | citas`);
    console.log(`  Menú:        Contáctanos | Agendar | Horarios | Ubicación | Sobre Nosotros`);
    console.log("\n  Ajusta en el panel admin:");
    console.log("  - Mi Empresa: nombre, descripción, logo, WhatsApp personal");
    console.log("  - Info: contacto, horarios, Sobre Nosotros");
    console.log("  - Flujos: edita textos y pasos si lo necesitas");
    console.log("\n  Para correr el bot con esta org:");
    console.log(`  ORG_ID=${ORG_ID} npm start`);
    console.log("");

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

seedClinica();
