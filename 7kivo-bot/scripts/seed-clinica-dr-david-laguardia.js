/**
 * Script exclusivo: Clínica Médica Laguardia - Dr. David Laguardia
 *
 * Organización: dr-david-laguardia
 *
 * Flujos:
 * - Mensaje al Doctor (deja un mensaje/consulta al Dr. Laguardia)
 * - Agendar Cita (citas médicas con selección de fecha/hora)
 *
 * Menú builtins:
 * - Horarios, Ubicación, Sobre Nosotros, Ver mis citas, Cancelar cita
 *
 * NO toca:
 * - Usuarios existentes (owners/admins)
 * - Config WhatsApp (token, phoneNumberId)
 * - Foto de la clínica (profileImage en config/general)
 * - botApiUrl
 *
 * Uso:
 *   cd 7kivo-bot
 *   ORG_ID=dr-david-laguardia node scripts/seed-clinica-dr-david-laguardia.js
 */

require("dotenv").config();
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID || "kivo7-app";
const ORG_ID = process.env.ORG_ID || "dr-david-laguardia";

// ==================== CONFIGURACIÓN ====================
const CLINIC = {
  orgName: "Clínica Dr. David Laguardia",
  doctorName: "Dr. David Laguardia",
  description: "Atención médica de calidad. Tu salud es nuestra prioridad.",
  industry: "medical",

  contact: {
    address: "Centro Comercial El Sauce 2° Nivel Local 2B Sonzacate",
    city: "Sonsonate",
    country: "El Salvador",
    phone: "+503 2487-2688",
    email: "laguardiaclinica@gmail.com",
    showFields: { address: true, city: true, country: true, phone: true, email: true }
  },

  schedule: {
    days: [
      { name: "Lunes",     active: true,  shifts: [{ from: "08:00", to: "12:00" }, { from: "13:30", to: "17:00" }] },
      { name: "Martes",    active: true,  shifts: [{ from: "08:00", to: "12:00" }, { from: "13:30", to: "17:00" }] },
      { name: "Miércoles", active: true,  shifts: [{ from: "08:00", to: "12:00" }, { from: "13:30", to: "17:00" }] },
      { name: "Jueves",    active: true,  shifts: [{ from: "08:00", to: "12:00" }, { from: "13:30", to: "17:00" }] },
      { name: "Viernes",   active: true,  shifts: [{ from: "08:00", to: "12:00" }, { from: "13:30", to: "17:00" }] },
      { name: "Sábado",    active: true,  shifts: [{ from: "14:00", to: "17:30" }] },
      { name: "Domingo",   active: false, shifts: [{ from: "08:00", to: "17:00" }] }
    ],
    slotDuration: 30,
    blockedDates: [],
    offersAppointments: true,
    businessType: "services",
    services: [
      {
        name: "Consulta general",
        duration: 20,
        capacity: 1
      },
      {
        title: "Ultra Abdominal",
        name: "Ultra Abdominal",
        subtitle: "Evaluación de hígado, vesícula, páncreas y órganos abdominales",
        description: "Este estudio permite evaluar órganos como hígado, vesícula, páncreas, riñones y bazo. Es un procedimiento seguro y sin dolor que ayuda a detectar inflamaciones, cálculos u otras alteraciones.\nSe recomienda asistir con 6 a 8 horas de ayuno para obtener mejores resultados.",
        duration: 30,
        capacity: 1
      },
      {
        title: "Ultra Renal",
        name: "Ultra Renal",
        subtitle: "Estudio para evaluar riñones y sistema urinario",
        description: "Este estudio permite evaluar el estado de los riñones, la vejiga y los uréteres, ayudando a detectar cálculos, quistes, infecciones u otras alteraciones en el sistema urinario. Es un procedimiento rápido, seguro y sin dolor.\nDebe de asistir con la vejiga llena para mejorar la visualización.",
        duration: 30,
        capacity: 1
      },
      {
        title: "Ultra Embarazo",
        name: "Ultra Embarazo",
        subtitle: "Control y seguimiento del desarrollo del bebé",
        description: "Permite evaluar el desarrollo del bebé, escuchar el latido fetal y verificar el estado general del embarazo.",
        duration: 30,
        capacity: 1
      },
      {
        title: "Ultra Próstata",
        name: "Ultra Próstata",
        subtitle: "Evaluación del tamaño y estado de la próstata",
        description: "Este estudio permite evaluar la vejiga y la próstata, ayudando a detectar posibles alteraciones como inflamación, agrandamiento prostático u otras irregularidades en la glándula. Es un procedimiento rápido, seguro y no invasivo.",
        duration: 30,
        capacity: 1
      }
    ]
  },

  general: {
    focus: ["Consulta general", "Medicina preventiva", "Seguimiento de pacientes"],
    modality: "Presencial",
    services: "Consulta médica general, ultrasonido abdominal, renal, de embarazo y prostático.",
    note: "Priorizamos un trato cercano y atención personalizada para cada paciente."
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

async function seedClinica() {
  console.log("\n========================================");
  console.log(`  Clínica Médica Laguardia`);
  console.log(`  Org ID: ${ORG_ID}`);
  console.log("========================================\n");

  try {
    // 1. Leer config/general existente (preservar orgName, description, industry, botApiUrl, profileImage, welcomeMessage, etc.)
    console.log("1. Leyendo configuración actual del negocio...");
    let existingConfig = {};
    const configDoc = await orgRef.collection("config").doc("general").get();
    if (configDoc.exists) {
      existingConfig = configDoc.data();
      console.log(`   orgName:   ${existingConfig.orgName || "(vacío)"}`);
      console.log(`   botApiUrl: ${existingConfig.botApiUrl ? "✓" : "(vacío)"}`);
      console.log(`   foto:      ${existingConfig.profileImage ? "✓ preservada" : "(sin foto)"}`);
    } else {
      console.log("   Sin config previa — se creará con valores por defecto.");
    }

    const orgName = existingConfig.orgName || CLINIC.orgName;
    const description = existingConfig.description || CLINIC.description;
    const industry = existingConfig.industry || CLINIC.industry;

    // Crear config/general solo si no existe (para no sobrescribir botApiUrl, profileImage, etc.)
    if (!configDoc.exists) {
      await orgRef.collection("config").doc("general").set({
        orgName,
        description,
        industry,
        personalWhatsApp: "",
        welcomeMessage: `Bienvenido a ${orgName}`,
        inactivityTimeout: 180000,
        botApiUrl: "",
        createdAt: ts()
      });
      console.log("   Config general creada.\n");
    } else {
      // Merge mínimo: solo actualizar industry si vacío
      const updates = {};
      if (!existingConfig.industry) updates.industry = CLINIC.industry;
      if (Object.keys(updates).length > 0) {
        await orgRef.collection("config").doc("general").update(updates);
      }
      console.log("   Config general preservada.\n");
    }

    // 2. Preservar WhatsApp config
    let savedWAConfig = null;
    const waDoc = await orgRef.collection("config").doc("whatsapp").get();
    if (waDoc.exists && waDoc.data()?.token) {
      savedWAConfig = waDoc.data();
      console.log("2. Credenciales WhatsApp preservadas. ✓\n");
    } else {
      console.log("2. Sin credenciales WhatsApp guardadas.\n");
    }

    // 3. Limpiar flujos, menú, botMessages, colecciones de datos
    console.log("3. Limpiando datos previos (flujos, menú, mensajes, colecciones)...");
    const collectionsToClean = ["flows", "botMessages", "_collections", "mensajes", "citas", "consultas"];
    for (const col of collectionsToClean) {
      const count = await deleteCollection(orgRef.collection(col));
      if (count > 0) console.log(`   - ${col}: ${count} docs eliminados`);
    }
    // Limpiar docs de config (menu) e info
    for (const docName of ["menu"]) {
      const d = await orgRef.collection("config").doc(docName).get();
      if (d.exists) await d.ref.delete();
    }
    for (const docName of ["contact", "schedule", "general"]) {
      const d = await orgRef.collection("info").doc(docName).get();
      if (d.exists) await d.ref.delete();
    }
    console.log("   Limpieza completada.\n");

    // 4. Actualizar org raíz (merge — no sobreescribe campos extras)
    await orgRef.set({
      name: orgName,
      industry,
      active: true,
      plan: "Business",
      botEnabled: true,
      setupComplete: true,
      updatedAt: ts()
    }, { merge: true });

    // 5. Definiciones de colecciones
    console.log("4. Creando definiciones de colecciones...");

    await orgRef.collection("_collections").add({
      name: "Mensajes al Doctor",
      slug: "mensajes",
      description: "Mensajes y consultas enviados al Dr. Laguardia a través del bot",
      displayField: "nombre",
      fields: [
        { key: "nombre",    label: "Nombre",             type: "text", required: true },
        { key: "mensaje",   label: "Mensaje al Doctor",  type: "text", required: true },
        { key: "phoneNumber", label: "Teléfono",         type: "text", required: true }
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
        { key: "nombre",      label: "Nombre",            type: "text",   required: true },
        { key: "phoneNumber", label: "Teléfono",          type: "text",   required: true },
        { key: "motivo",      label: "Motivo de consulta",type: "text",   required: false },
        { key: "fecha",         label: "Fecha",            type: "text",   required: true },
        { key: "hora",          label: "Hora",             type: "text",   required: true },
        { key: "_apptDuration", label: "Duración (min)",  type: "number", required: false },
        { key: "_apptService",  label: "Servicio",         type: "text",   required: false }
      ],
      createdAt: ts(),
      updatedAt: ts()
    });

    console.log("   mensajes, citas\n");

    // 6. Flujos
    console.log("5. Creando flujos...");

    // Flujo: Mensaje al Doctor
    const msgFlowRef = await orgRef.collection("flows").add({
      name: "Mensaje al Doctor",
      description: "Deja un mensaje o consulta al Dr. Laguardia",
      type: "registration",
      active: true,
      order: 1,
      saveToCollection: "mensajes",
      menuLabel: "Mensaje al Doctor",
      menuDescription: "Deja una consulta al Dr. Laguardia",
      showInMenu: true,
      steps: [
        {
          id: "s1",
          type: "text_input",
          prompt: `👋 Hola{name}, bienvenido a *${orgName}*.\n\nVoy a ayudarte a dejar un mensaje para el *Dr. Laguardia*.\n\nPor favor escribe tu *nombre completo*:`,
          fieldKey: "nombre",
          fieldLabel: "Nombre",
          required: true,
          validation: { minLength: 3 },
          errorMessage: "Escribe al menos 3 caracteres para continuar.",
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
          prompt: "Perfecto, *{nombre}*.\n\nEscribe tu *mensaje o consulta* para el Dr. Laguardia:\n\n_(Puedes describir tus síntomas, dudas o cualquier consulta que tengas)_",
          fieldKey: "mensaje",
          fieldLabel: "Mensaje",
          required: true,
          validation: { minLength: 5 },
          errorMessage: "Por favor escribe al menos unas palabras para que el doctor pueda ayudarte.",
          optionsSource: "custom",
          customOptions: [],
          buttonText: "",
          sourceCollection: "",
          displayField: "",
          detailFields: []
        }
      ],
      completionMessage: `✅ *Mensaje enviado al Dr. Laguardia*\n\nGracias, *{nombre}*. Tu mensaje ha sido recibido.\n\nEl doctor te contactará a la brevedad posible.\n\n_${orgName}_`,
      createdAt: ts(),
      updatedAt: ts()
    });

    // Flujo: Agendar Cita
    const apptFlowRef = await orgRef.collection("flows").add({
      name: "Agendar Cita",
      description: "Reserva una cita médica con el Dr. Laguardia",
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
          prompt: `📅 *Agendar cita con el Dr. Laguardia*\n\nVamos a reservar un espacio para ti.\n\nEscribe tu *nombre completo*:`,
          fieldKey: "nombre",
          fieldLabel: "Nombre",
          required: true,
          validation: { minLength: 3 },
          errorMessage: "Escribe al menos 3 caracteres para continuar.",
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
          prompt: "¿Qué servicio necesitas?\n\nSelecciona una opción:",
          fieldKey: "motivo",
          fieldLabel: "Servicio",
          required: true,
          validation: {},
          errorMessage: "",
          optionsSource: "custom",
          customOptions: [
            { label: "Consulta general",  value: "Consulta general",  description: "Revisión médica o síntomas generales",                  duration: 20 },
            { label: "Ultra Abdominal",   value: "Ultra Abdominal",   description: "Hígado, vesícula, páncreas, riñones y bazo",             duration: 30 },
            { label: "Ultra Renal",       value: "Ultra Renal",       description: "Riñones, vejiga y sistema urinario",                    duration: 30 },
            { label: "Ultra Embarazo",    value: "Ultra Embarazo",    description: "Control y seguimiento del desarrollo del bebé",         duration: 30 },
            { label: "Ultra Próstata",    value: "Ultra Próstata",    description: "Vejiga y próstata",                                     duration: 30 }
          ],
          buttonText: "Ver servicios",
          sourceCollection: "",
          displayField: "",
          detailFields: [],
          timeFieldKey: ""
        },
        {
          id: "s3",
          type: "appointment_slot",
          prompt: "Selecciona el *día* disponible para tu cita:\n\n_(Solo se muestran días con horarios disponibles)_",
          fieldKey: "fecha",
          fieldLabel: "Fecha",
          required: true,
          timeFieldKey: "hora",
          validation: {},
          errorMessage: "",
          optionsSource: "custom",
          customOptions: [{ label: "Consulta", value: "consulta", description: "Consulta médica", duration: 30 }],
          buttonText: "Ver días",
          sourceCollection: "",
          displayField: "",
          detailFields: []
        }
      ],
      completionMessage: `✅ *Cita confirmada*\n\n👤 *Paciente:* {nombre}\n🩺 *Motivo:* {motivo}\n📅 *Fecha:* {fecha}\n🕐 *Hora:* {hora}\n\nTe esperamos en *${orgName}*.\n\nSi necesitas cancelar tu cita, escribe *hola* y selecciona "Cancelar mi cita".`,
      createdAt: ts(),
      updatedAt: ts()
    });

    console.log("   Flujos: Mensaje al Doctor, Agendar Cita\n");

    // 7. Menú
    console.log("6. Configurando menú...");
    await orgRef.collection("config").doc("menu").set({
      greeting: `¡Hola{name}! 👋\n\nBienvenido a *${orgName}*.\n\n¿En qué te podemos ayudar hoy?`,
      menuButtonText: "Ver opciones",
      fallbackMessage: "No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones disponibles.",
      exitMessage: `¡Hasta pronto! 👋\n\nFue un gusto atenderte. Escribe *hola* cuando necesites ayuda.\n\n_${orgName}_`,
      items: [
        { id: "m1", type: "flow",    flowId: apptFlowRef.id, label: "Agendar Cita",   description: "Reserva tu cita médica",              order: 1, active: true },
        { id: "m2", type: "builtin", action: "my_appointments",   label: "Ver mis citas",   description: "Consulta tus citas programadas",      order: 2, active: true },
        { id: "m3", type: "builtin", action: "cancel_appointment", label: "Cancelar mi cita", description: "Cancela una cita existente",         order: 3, active: true },
        { id: "m4", type: "flow",    flowId: msgFlowRef.id,   label: "Mensaje al Doctor", description: "Deja una consulta al Dr. Laguardia",  order: 4, active: true },
        { id: "m5", type: "builtin", action: "schedule",      label: "Horarios",         description: "Días y horarios de atención",         order: 5, active: true },
        { id: "m6", type: "builtin", action: "contact",       label: "Ubicación",        description: "Dónde encontrarnos",                  order: 6, active: true },
        { id: "m7", type: "builtin", action: "general",       label: "Sobre Nosotros",   description: "Conoce la clínica",                   order: 7, active: true }
      ],
      createdAt: ts()
    });

    // 8. Bot messages
    console.log("7. Configurando mensajes del bot...");
    const botMessages = [
      { key: "greeting",          label: "Saludo principal",        category: "greeting", description: "Mensaje de bienvenida",              content: `¡Hola{name}! 👋\n\nBienvenido a *${orgName}*.\n\n¿En qué te podemos ayudar hoy?` },
      { key: "fallback",          label: "Mensaje no reconocido",   category: "fallback", description: "Cuando el bot no entiende",          content: "No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones disponibles." },
      { key: "goodbye",           label: "Despedida",               category: "general",  description: "Cuando el usuario se despide",       content: "¡Hasta pronto! 👋\n\nFue un gusto atenderte. Escribe *hola* cuando quieras volver." },
      { key: "session_expired",   label: "Sesión expirada",         category: "general",  description: "Cierre por inactividad",             content: "Tu sesión se cerró por inactividad.\n\nEscribe *hola* para volver al menú." },
      { key: "cancel",            label: "Cancelación",             category: "general",  description: "Cuando cancela un proceso",          content: "Proceso cancelado. Escribe *hola* para volver al menú." },
      { key: "flow_cancel_hint",  label: "Aviso de cancelación",    category: "flow",     description: "Al iniciar un flujo",                content: "Puedes escribir *cancelar* en cualquier momento para detener este proceso.\n" },
      { key: "admin_farewell",    label: "Despedida de admin",      category: "admin",    description: "Cuando admin devuelve el control",   content: "La conversación con nuestro equipo ha finalizado.\n\nEscribe *hola* para ver el menú." },
      { key: "no_registration",   label: "Registro no disponible",  category: "flow",     description: "Sin flujo de registro activo",       content: "El registro no está disponible en este momento.\n\nEscribe *hola* para ver otras opciones." }
    ];
    for (const msg of botMessages) {
      await orgRef.collection("botMessages").add({ ...msg, createdAt: ts() });
    }

    // 9. Info (contact, schedule, general)
    console.log("8. Guardando info de contacto, horarios y sobre nosotros...");
    await orgRef.collection("info").doc("contact").set({
      ...CLINIC.contact,
      createdAt: ts()
    });
    await orgRef.collection("info").doc("schedule").set({
      ...CLINIC.schedule,
      createdAt: ts()
    });
    await orgRef.collection("info").doc("general").set({
      name: orgName,
      description,
      focus: CLINIC.general.focus,
      modality: CLINIC.general.modality,
      services: CLINIC.general.services,
      note: CLINIC.general.note,
      createdAt: ts()
    });

    // 10. Restaurar WhatsApp config (no se tocó, pero por si acaso)
    if (savedWAConfig && savedWAConfig.token) {
      await orgRef.collection("config").doc("whatsapp").set({ ...savedWAConfig, updatedAt: ts() });
      console.log("   WhatsApp config restaurada. ✓");
    }

    // ==================== RESUMEN ====================

    console.log("\n========================================");
    console.log("  ✅ Seed completado");
    console.log("========================================\n");
    console.log(`  Org:         ${ORG_ID}`);
    console.log(`  Nombre:      ${orgName}`);
    console.log(`  Flujos:      Agendar Cita | Mensaje al Doctor`);
    console.log(`  Colecciones: citas | mensajes`);
    console.log(`  Menú:        Agendar Cita | Ver mis citas | Cancelar mi cita`);
    console.log(`               Mensaje al Doctor | Horarios | Ubicación | Sobre Nosotros`);
    console.log(`  Usuarios:    NO modificados`);
    console.log(`  WhatsApp:    NO modificado`);
    console.log(`  Foto:        NO modificada`);
    console.log("\n  Recuerda completar en el panel admin:");
    console.log("  - Info > Contacto: dirección y teléfono");
    console.log("  - Info > Horarios: ajusta los días y horarios reales");
    console.log("  - Mi Empresa: descripción y logo si no están");
    console.log("");

  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    process.exit(0);
  }
}

seedClinica();
