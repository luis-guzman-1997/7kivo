/**
 * Script Seed — Instituto CanZion Sonsonate
 *
 * Limpia y reconfigura el contenido del bot desde cero.
 *
 * ✅ Toca (contenido del bot):
 *   - Flujos, menú, botMessages
 *   - Esquemas de colecciones (_collections)
 *   - Datos de colecciones: programas, instrumentos
 *   - Limpia datos recibidos: permisos, quejas-o-sugerencias, consulta-de-pago
 *   - info/contact, info/schedule, info/general
 *
 * 🚫 NO toca (configuración del servicio):
 *   - config/general  (botApiUrl, token WA, inactivityTimeout, etc.)
 *   - config/whatsapp (token, phoneNumberId, verifyToken)
 *   - Documento de organización (botEnabled, plan, active, etc.)
 *   - Admins / usuarios
 *
 * Menú (7 ítems):
 *   1. Conócenos            → info general (builtin)
 *   2. Nuestros Programas   → browse de programas (flow)
 *   3. Horarios de Atención → horarios (builtin)
 *   4. Permisos             → flujo 5 pasos (flow)
 *   5. Déjanos un Mensaje   → flujo 2 pasos (flow)
 *   6. Ubícanos             → contacto (builtin)
 *   7. Mis Pagos            → "próximamente" (message)
 *
 * Uso:
 *   cd 7kivo-bot
 *   node scripts/seed-canzion-sonsonate.js
 */

require("dotenv").config();
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID || "kivo7-app";
const ORG_ID    = "instituto-canzion-sonsonate";
const ORG_NAME  = "Instituto CanZion Sonsonate";

// ==================== DATOS REALES ====================

const PROGRAMAS = [
  {
    nombre:      "Curso Ministerial Musical",
    edad:        "Mayores de 16 años",
    duracion:    "2 años (4 semestres)",
    descripcion:
      "Programa de formación musical con enfoque en liderazgo y servicio ministerial. " +
      "Los estudiantes desarrollan habilidades en su instrumento, ensamble musical " +
      "y lenguaje musical, aplicando todo en el contexto de la alabanza y adoración.",
    active: true,
    order:  1
  },
  {
    nombre:      "CanZion Instrumento",
    edad:        "12 a 15 años",
    duracion:    "2 años (4 semestres)",
    descripcion:
      "Programa diseñado para potenciar competencias musicales, actitudinales y cognitivas " +
      "a través de la práctica musical en conjunto. Los jóvenes aprenden a interpretar su " +
      "instrumento y participan en ensambles, con énfasis en principios bíblicos.",
    active: true,
    order:  2
  },
  {
    nombre:      "Kids",
    edad:        "6 a 10 años",
    duracion:    "2 años (4 semestres)",
    descripcion:
      "Espacio de iniciación musical basado en la exploración, orientación de instrumento, " +
      "juego y enseñanza de principios bíblicos. Los niños aprenden a tocar su instrumento " +
      "y participan en ensambles junto a otros niños.",
    active: true,
    order:  3
  }
];

const INSTRUMENTOS = ["Guitarra", "Batería", "Bajo", "Canto", "Piano"];

// ==================== FIREBASE INIT ====================

function initFirebase() {
  const credsVal = (
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    ""
  ).trim();

  if (credsVal && credsVal.startsWith("{")) {
    try {
      const sa = JSON.parse(credsVal);
      if (sa.type === "service_account" && sa.private_key) {
        admin.initializeApp({ credential: admin.credential.cert(sa), projectId });
        return;
      }
    } catch (e) {
      console.error("Error parseando credenciales:", e.message);
      throw e;
    }
  }
  if (credsVal && !credsVal.startsWith("{")) {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
  } else {
    admin.initializeApp({ projectId });
  }
}

initFirebase();

const db     = admin.firestore();
const ts     = admin.firestore.FieldValue.serverTimestamp;
const orgRef = db.collection("organizations").doc(ORG_ID);

// ==================== HELPERS ====================

async function deleteCollection(collRef) {
  const snapshot = await collRef.get();
  if (snapshot.empty) return 0;
  let deleted = 0;
  for (let i = 0; i < snapshot.docs.length; i += 400) {
    const batch = db.batch();
    snapshot.docs.slice(i, i + 400).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += Math.min(400, snapshot.docs.length - i);
  }
  return deleted;
}

// ==================== MAIN ====================

async function seedCanzion() {
  console.log("\n========================================");
  console.log("  Instituto CanZion Sonsonate — Seed");
  console.log(`  Org ID: ${ORG_ID}`);
  console.log("========================================\n");

  try {
    // ── 1. Limpiar contenido del bot ──────────────────────────────────────
    console.log("1. Limpiando contenido del bot...");

    // Flujos
    const flowsN = await deleteCollection(orgRef.collection("flows"));
    if (flowsN > 0) console.log(`   - flows: ${flowsN} docs`);

    // BotMessages
    const msgsN = await deleteCollection(orgRef.collection("botMessages"));
    if (msgsN > 0) console.log(`   - botMessages: ${msgsN} docs`);

    // Esquemas de colecciones
    const colDefsN = await deleteCollection(orgRef.collection("_collections"));
    if (colDefsN > 0) console.log(`   - _collections: ${colDefsN} docs`);

    // Menú
    const menuDoc = await orgRef.collection("config").doc("menu").get();
    if (menuDoc.exists) { await menuDoc.ref.delete(); console.log("   - config/menu: eliminado"); }

    // Info
    for (const d of ["contact", "schedule", "general"]) {
      const doc = await orgRef.collection("info").doc(d).get();
      if (doc.exists) { await doc.ref.delete(); }
    }
    console.log("   - info/contact, info/schedule, info/general: eliminados");

    // Datos recibidos (limpiar sin eliminar, se re-definen las colecciones)
    const dataCols = ["programas", "instrumentos", "permisos", "quejas-o-sugerencias", "consulta-de-pago"];
    for (const col of dataCols) {
      const n = await deleteCollection(orgRef.collection(col));
      if (n > 0) console.log(`   - ${col}: ${n} registros eliminados`);
    }
    console.log("   Limpieza completada.\n");

    // ── 2. Esquemas de colecciones ────────────────────────────────────────
    console.log("2. Registrando esquemas de colecciones...");

    await orgRef.collection("_collections").add({
      name: "Programas", slug: "programas",
      description: "Cursos disponibles en ICZ Sonsonate",
      displayField: "nombre",
      fields: [
        { key: "nombre",      label: "Nombre del Programa", type: "text",   required: true  },
        { key: "edad",        label: "Rango de Edad",        type: "text",   required: true  },
        { key: "duracion",    label: "Duración",             type: "text",   required: false },
        { key: "descripcion", label: "Descripción",          type: "text",   required: false }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    await orgRef.collection("_collections").add({
      name: "Instrumentos", slug: "instrumentos",
      description: "Instrumentos disponibles en el instituto",
      displayField: "nombre",
      fields: [
        { key: "nombre", label: "Instrumento", type: "text", required: true }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    await orgRef.collection("_collections").add({
      name: "Permisos", slug: "permisos",
      description: "Solicitudes de permiso y falta enviadas desde el bot",
      displayField: "nombre",
      fields: [
        { key: "nombre",      label: "Nombre alumno",    type: "text", required: true  },
        { key: "programa",    label: "Programa",          type: "text", required: true  },
        { key: "instrumento", label: "Instrumento",       type: "text", required: true  },
        { key: "tipo",        label: "Tipo de solicitud", type: "text", required: true  },
        { key: "motivo",      label: "Motivo",            type: "text", required: true  },
        { key: "notas",       label: "Notas",             type: "text", required: false },
        { key: "phoneNumber", label: "WhatsApp",          type: "text", required: false, protected: true }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    await orgRef.collection("_collections").add({
      name: "Mensajes", slug: "quejas-o-sugerencias",
      description: "Mensajes y comentarios recibidos desde el bot",
      displayField: "nombre",
      fields: [
        { key: "nombre",      label: "Nombre",   type: "text", required: true  },
        { key: "descripcion", label: "Mensaje",  type: "text", required: true  },
        { key: "phoneNumber", label: "WhatsApp", type: "text", required: false, protected: true }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    await orgRef.collection("_collections").add({
      name: "Consulta de Pago", slug: "consulta-de-pago",
      description: "Registros de pagos por alumno",
      displayField: "nombre",
      fields: [
        { key: "codigo_alumno",      label: "Código de Alumno",       type: "text",   required: true  },
        { key: "nombre",             label: "Nombre",                  type: "text",   required: false },
        { key: "proxima_fecha_pago", label: "Próxima Fecha de Pago",   type: "date",   required: false },
        { key: "monto_pagar",        label: "Monto a Pagar",           type: "number", required: false },
        { key: "formas_pago",        label: "Formas de Pago",          type: "text",   required: false },
        { key: "cuotas_pendientes",  label: "Cuotas Pendientes",       type: "number", required: false }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    console.log("   5 esquemas: programas, instrumentos, permisos, mensajes, consulta-de-pago.\n");

    // ── 3. Datos: programas ───────────────────────────────────────────────
    console.log(`3. Sembrando ${PROGRAMAS.length} programas...`);
    for (const prog of PROGRAMAS) {
      await orgRef.collection("programas").add({ ...prog, createdAt: ts(), updatedAt: ts() });
    }
    console.log("   OK\n");

    // ── 4. Datos: instrumentos ────────────────────────────────────────────
    console.log(`4. Sembrando ${INSTRUMENTOS.length} instrumentos...`);
    for (const nombre of INSTRUMENTOS) {
      await orgRef.collection("instrumentos").add({ nombre, active: true, createdAt: ts(), updatedAt: ts() });
    }
    console.log("   OK\n");

    // ── 5. Flujo: Nuestros Programas ──────────────────────────────────────
    console.log("5. Flujo 'Nuestros Programas'...");
    const programasFlowRef = await orgRef.collection("flows").add({
      name:             "Nuestros Programas",
      description:      "Conoce los programas de estudio del instituto",
      type:             "information",
      active:           true,
      order:            1,
      saveToCollection: "",
      notifyAdmin:      false,
      menuLabel:        "Nuestros Programas",
      menuDescription:  "Conoce nuestra oferta académica",
      showInMenu:       true,
      steps: [
        {
          id:                "s1",
          type:              "browse_collection",
          prompt:            "🎓 *Nuestros Programas*\n\nEstos son los programas disponibles en ICZ Sonsonate.\n\nSelecciona uno para ver los detalles:",
          sourceCollection:  "programas",
          displayField:      "nombre",
          optionsTitleField: "nombre",
          optionsDescField:  "edad",
          detailFields:      ["nombre", "edad", "duracion", "descripcion"],
          buttonText:        "Ver programas",
          fieldKey:          "",
          fieldLabel:        "",
          required:          false,
          validation:        {},
          errorMessage:      "",
          optionsSource:     "",
          customOptions:     [],
          timeFieldKey:      ""
        }
      ],
      completionMessage:
        "¿Te gustaría saber algo más?\n\n" +
        "Escribe *hola* para volver al menú principal. 🎵",
      createdAt: ts(), updatedAt: ts()
    });
    console.log(`   ✓ id: ${programasFlowRef.id}\n`);

    // ── 6. Flujo: Permisos ────────────────────────────────────────────────
    console.log("6. Flujo 'Permisos'...");

    const sb = {
      required: true, validation: {}, errorMessage: "",
      optionsSource: "custom", optionsTitleField: "", optionsDescField: "",
      customOptions: [], buttonText: "Ver opciones",
      sourceCollection: "", displayField: "", detailFields: [], timeFieldKey: ""
    };

    const permisosFlowRef = await orgRef.collection("flows").add({
      name:             "Permisos",
      description:      "Solicitud de permiso o justificación de falta",
      type:             "registration",
      active:           true,
      order:            2,
      saveToCollection: "permisos",
      notifyAdmin:      true,
      menuLabel:        "Permisos",
      menuDescription:  "Solicita un permiso o justifica una falta",
      showInMenu:       true,
      steps: [
        {
          ...sb,
          id:           "s1",
          type:         "text_input",
          prompt:
            `📋 *Solicitud de Permiso / Falta*\n\n_${ORG_NAME}_\n\n` +
            "_Puedes escribir *cancelar* en cualquier momento para salir._\n\n" +
            "¿Cuál es tu *nombre completo*?\n\n" +
            "_Escríbelo tal como aparece en tu ficha de registro._",
          fieldKey:     "nombre",
          fieldLabel:   "Nombre",
          required:     true,
          validation:   { minLength: 3 },
          errorMessage: "Por favor escribe tu nombre completo tal como aparece en tu ficha (mínimo 3 caracteres)."
        },
        {
          ...sb,
          id:                "s2",
          type:              "select_list",
          prompt:            "¿A qué *programa* perteneces?",
          fieldKey:          "programa",
          fieldLabel:        "Programa",
          required:          true,
          optionsSource:     "programas",
          optionsTitleField: "nombre",
          optionsDescField:  "edad",
          buttonText:        "Ver programas"
        },
        {
          ...sb,
          id:                "s3",
          type:              "select_list",
          prompt:            "¿Qué *instrumento* estudias?",
          fieldKey:          "instrumento",
          fieldLabel:        "Instrumento",
          required:          true,
          optionsSource:     "instrumentos",
          optionsTitleField: "nombre",
          optionsDescField:  "",
          buttonText:        "Ver instrumentos"
        },
        {
          ...sb,
          id:            "s4",
          type:          "select_buttons",
          prompt:        "¿Qué tipo de solicitud es?",
          fieldKey:      "tipo",
          fieldLabel:    "Tipo de solicitud",
          required:      true,
          optionsSource: "custom",
          customOptions: [
            { label: "Permiso anticipado", value: "Permiso anticipado" },
            { label: "Falta justificada",  value: "Falta justificada"  },
            { label: "Tardanza",           value: "Tardanza"           }
          ]
        },
        {
          ...sb,
          id:           "s5",
          type:         "text_input",
          prompt:
            "Por favor describe el *motivo* de tu solicitud:\n\n" +
            "_Indica la fecha, la razón y cualquier detalle relevante._",
          fieldKey:     "motivo",
          fieldLabel:   "Motivo",
          required:     true,
          validation:   { minLength: 5 },
          errorMessage: "Por favor describe el motivo (mínimo 5 caracteres)."
        }
      ],
      completionMessage:
        "✅ *Solicitud recibida*\n\n" +
        "*Nombre:*      {nombre}\n" +
        "*Programa:*    {programa}\n" +
        "*Instrumento:* {instrumento}\n" +
        "*Tipo:*        {tipo}\n" +
        "*Motivo:*      {motivo}\n\n" +
        `Tu solicitud ha sido enviada al equipo administrativo de *${ORG_NAME}*.\n` +
        "Nos pondremos en contacto si necesitamos más información. 🎵",
      createdAt: ts(), updatedAt: ts()
    });
    console.log(`   ✓ id: ${permisosFlowRef.id}\n`);

    // ── 7. Flujo: Déjanos un Mensaje ─────────────────────────────────────
    console.log("7. Flujo 'Déjanos un Mensaje'...");
    const quejasFlowRef = await orgRef.collection("flows").add({
      name:             "Déjanos un Mensaje",
      description:      "Recibe mensajes y comentarios del alumno",
      type:             "registration",
      active:           true,
      order:            3,
      saveToCollection: "quejas-o-sugerencias",
      notifyAdmin:      true,
      menuLabel:        "Déjanos un Mensaje",
      menuDescription:  "Envíanos tu mensaje o comentario",
      showInMenu:       true,
      steps: [
        {
          ...sb,
          id:           "step_q1",
          type:         "text_input",
          prompt:
            "✉️ *Déjanos un Mensaje*\n\n_Instituto CanZion Sonsonate_\n\n" +
            "_Puedes escribir *cancelar* en cualquier momento para salir._\n\n" +
            "¿Cuál es tu *nombre completo*?",
          fieldKey:     "nombre",
          fieldLabel:   "Nombre",
          required:     true,
          validation:   { minLength: 3 },
          errorMessage: "Por favor ingresa un nombre válido (mínimo 3 caracteres)."
        },
        {
          ...sb,
          id:           "step_q2",
          type:         "text_input",
          prompt:       "Cuéntanos lo que necesitas 🙏\n\n_Escribe tu mensaje, consulta o comentario:_",
          fieldKey:     "descripcion",
          fieldLabel:   "Mensaje",
          required:     true,
          validation:   { minLength: 10 },
          errorMessage: "Por favor escribe tu mensaje (mínimo 10 caracteres)."
        }
      ],
      completionMessage:
        "✅ *Mensaje recibido*\n\n" +
        "Gracias, *{nombre}* 🎵\n\n" +
        "Hemos recibido tu mensaje y será revisado por nuestro equipo. " +
        "De ser necesario, un maestro se pondrá en contacto contigo.\n\n" +
        `_${ORG_NAME}_`,
      createdAt: ts(), updatedAt: ts()
    });
    console.log(`   ✓ id: ${quejasFlowRef.id}\n`);

    // ── 8. Menú ───────────────────────────────────────────────────────────
    console.log("8. Configurando menú (7 ítems)...");
    await orgRef.collection("config").doc("menu").set({
      greeting:
        `¡Hola{name}! 👋🎵\n\n` +
        `Bienvenido a *${ORG_NAME}*.\n\n` +
        `¿Cómo podemos ayudarte hoy?`,
      menuButtonText:  "Ver opciones",
      fallbackMessage: "🤔 No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones disponibles.",
      exitMessage:     `🎶 ¡Hasta pronto!\n\nEscribe *hola* cuando necesites ayuda.\n\n_${ORG_NAME}_`,
      items: [
        {
          id: "m1", type: "builtin", action: "general",
          label: "Conócenos", description: "Qué es el Instituto CanZion",
          order: 1, active: true
        },
        {
          id: "m2", type: "flow", flowId: programasFlowRef.id,
          label: "Nuestros Programas", description: "Conoce nuestra oferta académica",
          order: 2, active: true
        },
        {
          id: "m3", type: "builtin", action: "schedule",
          label: "Horarios de Atención", description: "Días y horas de clases",
          order: 3, active: true
        },
        {
          id: "m4", type: "flow", flowId: permisosFlowRef.id,
          label: "Permisos", description: "Solicita un permiso o justifica una falta",
          order: 4, active: true
        },
        {
          id: "m5", type: "flow", flowId: quejasFlowRef.id,
          label: "Déjanos un Mensaje", description: "Envíanos tu mensaje o comentario",
          order: 5, active: true
        },
        {
          id: "m6", type: "builtin", action: "contact",
          label: "Ubícanos", description: "Dónde encontrarnos",
          order: 6, active: true
        },
        {
          id: "m7", type: "message",
          label: "Mis Pagos", description: "Consulta tu información de pagos",
          messageContent:
            "💳 *Mis Pagos*\n\n" +
            "¡Muy pronto podrás consultar tu estado de cuenta directamente aquí! 🎉\n\n" +
            "Estamos trabajando en esta función y te avisaremos cuando esté disponible. 📢\n\n" +
            "_Instituto CanZion Sonsonate_",
          order: 7, active: true
        }
      ],
      createdAt: ts()
    });
    console.log("   Conócenos | Nuestros Programas | Horarios | Permisos | Déjanos un Mensaje | Ubícanos | Mis Pagos\n");

    // ── 9. Bot messages ───────────────────────────────────────────────────
    console.log("9. Mensajes del bot...");
    const botMessages = [
      {
        key: "greeting",        label: "Saludo principal",       category: "greeting",
        description: "Mensaje de bienvenida",
        content: `¡Hola{name}! 👋🎵\n\nBienvenido a *${ORG_NAME}*.\n\n¿Cómo podemos ayudarte hoy?`
      },
      {
        key: "fallback",        label: "Mensaje no reconocido",  category: "fallback",
        description: "Cuando el bot no entiende",
        content: "🤔 No logré entender tu mensaje.\n\nEscribe *hola* para ver el menú de opciones."
      },
      {
        key: "goodbye",         label: "Despedida",              category: "general",
        description: "Cuando el usuario se despide",
        content: "🎶 ¡Hasta pronto!\n\n_Instituto CanZion Sonsonate_"
      },
      {
        key: "session_expired", label: "Sesión expirada",        category: "general",
        description: "Cierre por inactividad",
        content: "Tu sesión se cerró por inactividad. ⏱️\n\nEscribe *hola* para volver al menú cuando quieras."
      },
      {
        key: "cancel",          label: "Cancelación",            category: "general",
        description: "Cuando cancela un proceso",
        content: "Entendido, proceso cancelado. ✋\n\nEscribe *hola* para volver al menú principal."
      },
      {
        key: "flow_cancel_hint", label: "Aviso de cancelación",  category: "flow",
        description: "Se muestra al iniciar un flujo",
        content: "_Puedes escribir *cancelar* en cualquier momento para salir._\n"
      },
      {
        key: "flow_cancelled",  label: "Flujo cancelado",        category: "flow",
        description: "Cuando cancela dentro de un flujo",
        content: "Solicitud cancelada. ✋\n\nEscribe *hola* para volver al menú principal."
      },
      {
        key: "admin_farewell",  label: "Despedida de admin",     category: "admin",
        description: "Cuando admin devuelve el control",
        content: "La conversación con nuestro equipo ha finalizado.\n\nEscribe *hola* para ver el menú."
      },
      {
        key: "no_registration", label: "Registro no disponible", category: "flow",
        description: "Sin flujo activo",
        content: "Este servicio no está disponible en este momento.\n\nEscribe *hola* para ver otras opciones."
      }
    ];
    for (const msg of botMessages) {
      await orgRef.collection("botMessages").add({ ...msg, createdAt: ts() });
    }
    console.log(`   ${botMessages.length} mensajes creados.\n`);

    // ── 10. info/contact ──────────────────────────────────────────────────
    console.log("10. Información del instituto...");
    await orgRef.collection("info").doc("contact").set({
      address:    "8va Av. Norte # 6-3, Colonia Aida",
      city:       "Sonsonate",
      country:    "El Salvador",
      phone:      "6930-7473",
      email:      "sonsonate@institutocanzion.com",
      maps:       "",
      showFields: { address: true, city: true, phone: true, email: true, country: true },
      createdAt:  ts()
    });

    // ── 11. info/schedule ─────────────────────────────────────────────────
    await orgRef.collection("info").doc("schedule").set({
      days: [
        { name: "Lunes",     active: false, shifts: [] },
        { name: "Martes",    active: false, shifts: [] },
        { name: "Miércoles", active: false, shifts: [] },
        { name: "Jueves",    active: false, shifts: [] },
        { name: "Viernes",   active: false, shifts: [] },
        { name: "Sábado",    active: true,  shifts: [{ from: "08:00", to: "12:00" }] },
        { name: "Domingo",   active: false, shifts: [] }
      ],
      slotDuration:       30,
      blockedDates:       [],
      offersAppointments: false,
      businessType:       "services",
      services:           [],
      createdAt:          ts()
    });

    // ── 12. info/general ──────────────────────────────────────────────────
    await orgRef.collection("info").doc("general").set({
      name:  ORG_NAME,
      description:
        `*${ORG_NAME}* es una escuela de música cristiana dedicada a la formación ` +
        `integral de músicos al servicio de Dios y la iglesia.\n\n` +
        `Ofrecemos programas para todas las edades: desde niños con *Kids*, ` +
        `jóvenes con *Teens*, hasta adultos con el *Curso Ministerial Musical*.\n\n` +
        `📍 8va Av. Norte # 6-3, Colonia Aida, Sonsonate, El Salvador`,
      focus: [
        "Formación musical cristiana",
        "Guitarra, Batería, Bajo, Canto, Piano",
        "Ensamble y Lenguaje Musical",
        "Desarrollo de carácter y principios bíblicos"
      ],
      modality: "Presencial",
      note:     "Abierto a toda persona que desee aprender música con propósito.",
      createdAt: ts()
    });
    console.log("   contact, schedule (Sábados 08:00–12:00), general.\n");

    // ── RESUMEN ────────────────────────────────────────────────────────────
    console.log("========================================");
    console.log("  Script completado ✓");
    console.log("========================================\n");
    console.log(`  Org ID: ${ORG_ID}`);
    console.log();
    console.log("  Menú (7 ítems):");
    console.log(`    1. Conócenos           → info general`);
    console.log(`    2. Nuestros Programas  → browse (${PROGRAMAS.length} programas)`);
    console.log(`    3. Horarios de Atención→ Sábados 08:00–12:00`);
    console.log(`    4. Permisos            → flujo 5 pasos → permisos`);
    console.log(`    5. Déjanos un Mensaje   → flujo 2 pasos → quejas-o-sugerencias`);
    console.log(`    6. Ubícanos            → 8va Av. Norte # 6-3, Col. Aida`);
    console.log(`    7. Mis Pagos           → mensaje "próximamente"`);
    console.log();
    console.log(`  Programas (${PROGRAMAS.length}):`);
    PROGRAMAS.forEach(p => console.log(`    - ${p.nombre} (${p.edad})`));
    console.log();
    console.log(`  Instrumentos: ${INSTRUMENTOS.join(", ")}`);
    console.log();
    console.log("  Colecciones (solo definiciones, sin datos):");
    console.log("    - permisos, mensajes (slug: quejas-o-sugerencias), consulta-de-pago");
    console.log();
    console.log(`  BotMessages: ${botMessages.length} (incluye flow_cancel_hint)`);
    console.log();
    console.log("  🚫 NO modificado: config/general, config/whatsapp, admins");
    console.log();

  } catch (error) {
    console.error("\nError:", error);
  } finally {
    process.exit(0);
  }
}

seedCanzion();
