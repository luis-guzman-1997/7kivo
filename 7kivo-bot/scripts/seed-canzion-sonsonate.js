/**
 * Script Seed — Instituto CanZion Sonsonate
 *
 * Configura el bot desde cero para el Instituto CanZion Sonsonate.
 * Preserva credenciales de WhatsApp y botApiUrl si ya existen.
 *
 * Menú del bot:
 *   1. Conócenos          → info general del instituto
 *   2. Nuestros Programas → browse de programas (Ministerial, Instrumento, Kids)
 *   3. Horarios           → sábados 8:00 AM – 12:00 MD
 *   4. Permisos           → flujo: nombre, programa, instrumento, tipo, motivo
 *   5. Ubícanos           → dirección y contacto
 *
 * Flujo "Permisos":
 *   Paso 1 — Nombre completo
 *   Paso 2 — Programa (Ministerial / Canzion Instrumento / Kids)
 *   Paso 3 — Instrumento (Guitarra, Batería, Bajo, Canto, Piano)
 *   Paso 4 — Tipo: Permiso anticipado / Falta justificada / Tardanza
 *   Paso 5 — Motivo (texto libre)
 *   → Guarda en colección "permisos"
 *
 * Flujo "Nuestros Programas":
 *   Paso 1 — browse_collection sobre "programas"
 *   → Solo lectura, no guarda datos
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

// ==================== DATOS ====================

const PROGRAMAS = [
  {
    nombre:      "Curso Ministerial Musical",
    edad:        "Mayores de 16 años",
    duracion:    "2 años (4 semestres)",
    descripcion: "Formación musical completa con enfoque en adoración y servicio ministerial.",
    active:      true,
    order:       1
  },
  {
    nombre:      "Canzion Instrumento",
    edad:        "12 a 15 años",
    duracion:    "2 años (4 semestres)",
    descripcion: "Programa de formación en instrumento para jóvenes.",
    active:      true,
    order:       2
  },
  {
    nombre:      "Kids",
    edad:        "6 a 10 años",
    duracion:    "2 años (4 semestres)",
    descripcion: "Iniciación musical integral para niños.",
    active:      true,
    order:       3
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
    // ── 1. Preservar credenciales WA ───────────────────────────────────────
    console.log("1. Verificando configuración WA existente...");
    let savedWAConfig  = null;
    let savedBotApiUrl = "";
    try {
      const waDoc = await orgRef.collection("config").doc("whatsapp").get();
      if (waDoc.exists && waDoc.data()?.token) {
        savedWAConfig = waDoc.data();
        console.log(`   Token WA preservado (Phone: ${savedWAConfig.phoneNumberId || "N/A"})`);
      }
      const genDoc = await orgRef.collection("config").doc("general").get();
      if (genDoc.exists && genDoc.data()?.botApiUrl) {
        savedBotApiUrl = genDoc.data().botApiUrl;
        console.log(`   botApiUrl preservado: ${savedBotApiUrl}`);
      }
    } catch (_) {}
    if (!savedWAConfig) console.log("   Sin credenciales previas — se dejan vacías.");
    console.log();

    // ── 2. Limpiar datos previos ───────────────────────────────────────────
    console.log("2. Limpiando datos previos...");
    const toClear = [
      "_collections", "flows", "botMessages",
      "citas", "permisos", "consultas", "contacts",
      "programas", "instrumentos", "aspirantes"
    ];
    for (const col of toClear) {
      const n = await deleteCollection(orgRef.collection(col));
      if (n > 0) console.log(`   - ${col}: ${n} docs eliminados`);
    }
    for (const doc of ["general", "menu"]) {
      const d = await orgRef.collection("config").doc(doc).get();
      if (d.exists) await d.ref.delete();
    }
    for (const doc of ["contact", "schedule", "general"]) {
      const d = await orgRef.collection("info").doc(doc).get();
      if (d.exists) await d.ref.delete();
    }
    console.log("   Limpieza completada.\n");

    // ── 3. Documento de organización ───────────────────────────────────────
    console.log("3. Creando organización...");
    await orgRef.set({
      name:          ORG_NAME,
      orgId:         ORG_ID,
      industry:      "academy",
      active:        true,
      plan:          "Business",
      botEnabled:    true,
      setupComplete: true,
      createdAt:     ts()
    }, { merge: true });
    console.log("   OK\n");

    // ── 4. config/general ──────────────────────────────────────────────────
    console.log("4. Configuración general...");
    await orgRef.collection("config").doc("general").set({
      orgName:           ORG_NAME,
      description:       "Instituto de música cristiana enfocado en la formación integral de músicos.",
      industry:          "academy",
      welcomeMessage:    `¡Bienvenido a *${ORG_NAME}*! 🎵`,
      inactivityTimeout: 180000,
      personalWhatsApp:  "",
      botApiUrl:         savedBotApiUrl || "",
      createdAt:         ts()
    });
    console.log("   OK\n");

    // ── 5. config/whatsapp ─────────────────────────────────────────────────
    console.log("5. Configuración WhatsApp...");
    if (savedWAConfig?.token) {
      await orgRef.collection("config").doc("whatsapp").set({ ...savedWAConfig, updatedAt: ts() });
      console.log("   Credenciales RESTAURADAS.\n");
    } else {
      await orgRef.collection("config").doc("whatsapp").set({
        phoneNumberId: process.env.PHONE_NUMBER_WHATSAPP || "",
        token:         process.env.TOKEN_META_WHATSAPP   || "",
        version:       process.env.VERSION_META_WHATSAPP || "v21.0",
        verifyToken:   process.env.VERIFY_META_TOKEN     || "",
        createdAt:     ts()
      });
      console.log("   Vacías (configurar en superadmin).\n");
    }

    // ── 6. Esquemas de colecciones (_collections) ─────────────────────────
    console.log("6. Registrando esquemas de colecciones...");

    await orgRef.collection("_collections").add({
      name:         "Programas",
      slug:         "programas",
      description:  "Cursos disponibles en ICZ Sonsonate",
      displayField: "nombre",
      fields: [
        { key: "nombre",      label: "Nombre del Curso",  type: "text", required: true  },
        { key: "edad",        label: "Rango de Edad",     type: "text", required: true  },
        { key: "duracion",    label: "Duración",          type: "text", required: false },
        { key: "descripcion", label: "Descripción",       type: "text", required: false }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    await orgRef.collection("_collections").add({
      name:         "Instrumentos",
      slug:         "instrumentos",
      description:  "Instrumentos disponibles en el instituto",
      displayField: "nombre",
      fields: [
        { key: "nombre", label: "Instrumento", type: "text", required: true }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    await orgRef.collection("_collections").add({
      name:         "Permisos",
      slug:         "permisos",
      description:  "Solicitudes de permiso y falta enviadas desde el bot",
      displayField: "nombre",
      fields: [
        { key: "nombre",      label: "Nombre alumno",  type: "text", required: true  },
        { key: "programa",    label: "Programa",        type: "text", required: true  },
        { key: "instrumento", label: "Instrumento",     type: "text", required: true  },
        { key: "tipo",        label: "Tipo",            type: "text", required: true  },
        { key: "motivo",      label: "Motivo",          type: "text", required: true  },
        { key: "phoneNumber", label: "WhatsApp",        type: "text", required: false, protected: true }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    console.log("   Esquemas: programas, instrumentos, permisos creados.\n");

    // ── 7. Sembrar programas ───────────────────────────────────────────────
    console.log(`7. Sembrando ${PROGRAMAS.length} programas...`);
    for (const prog of PROGRAMAS) {
      await orgRef.collection("programas").add({
        ...prog,
        createdAt: ts(),
        updatedAt: ts()
      });
    }
    console.log(`   OK\n`);

    // ── 8. Sembrar instrumentos ────────────────────────────────────────────
    console.log(`8. Sembrando ${INSTRUMENTOS.length} instrumentos...`);
    for (const nombre of INSTRUMENTOS) {
      await orgRef.collection("instrumentos").add({
        nombre,
        active:    true,
        createdAt: ts(),
        updatedAt: ts()
      });
    }
    console.log(`   OK\n`);

    // ── 9. Flujo: Nuestros Programas (browse_collection) ──────────────────
    console.log("9. Creando flujo 'Nuestros Programas'...");

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
          prompt:            "🎓 *Nuestros Programas*\n\nEstos son los cursos disponibles.\nSelecciona uno para ver todos los detalles:",
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
        `¿Te gustaría saber algo más?\n\n` +
        `Escribe *hola* para volver al menú principal. 🎵`,
      createdAt: ts(),
      updatedAt: ts()
    });

    console.log(`   ✓ Flujo "Nuestros Programas" creado (id: ${programasFlowRef.id})\n`);

    // ── 10. Flujo: Solicitud de Permiso ────────────────────────────────────
    console.log("10. Creando flujo 'Permisos'...");

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
          prompt:       `📋 *Solicitud de Permiso / Falta*\n\n_${ORG_NAME}_\n\nVamos a registrar tu solicitud. Por favor completa los siguientes datos.\n\n¿Cuál es tu *nombre completo*?`,
          fieldKey:     "nombre",
          fieldLabel:   "Nombre",
          required:     true,
          validation:   { minLength: 3 },
          errorMessage: "Por favor escribe tu nombre completo (mínimo 3 caracteres)."
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
          prompt:       "Por favor describe el *motivo* de tu solicitud:\n\n_Indica la fecha, la razón y cualquier detalle relevante._",
          fieldKey:     "motivo",
          fieldLabel:   "Motivo",
          required:     true,
          validation:   { minLength: 5 },
          errorMessage: "Por favor describe el motivo (mínimo 5 caracteres)."
        }
      ],
      completionMessage:
        `✅ *Solicitud recibida*\n\n` +
        `*Nombre:*      {nombre}\n` +
        `*Programa:*    {programa}\n` +
        `*Instrumento:* {instrumento}\n` +
        `*Tipo:*        {tipo}\n` +
        `*Motivo:*      {motivo}\n\n` +
        `Tu solicitud ha sido enviada al equipo administrativo de *${ORG_NAME}*.\n` +
        `Nos pondremos en contacto si necesitamos más información. 🎵`,
      createdAt: ts(),
      updatedAt: ts()
    });

    console.log(`   ✓ Flujo "Permisos" creado (id: ${permisosFlowRef.id})\n`);

    // ── 11. Menú ───────────────────────────────────────────────────────────
    console.log("11. Configurando menú...");

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
          id:          "m1",
          type:        "builtin",
          action:      "general",
          label:       "Conócenos",
          description: "Qué es el Instituto CanZion",
          order:       1,
          active:      true
        },
        {
          id:          "m2",
          type:        "flow",
          flowId:      programasFlowRef.id,
          label:       "Nuestros Programas",
          description: "Conoce nuestra oferta académica",
          order:       2,
          active:      true
        },
        {
          id:          "m3",
          type:        "builtin",
          action:      "schedule",
          label:       "Horarios",
          description: "Días y horas de atención",
          order:       3,
          active:      true
        },
        {
          id:          "m4",
          type:        "flow",
          flowId:      permisosFlowRef.id,
          label:       "Permisos",
          description: "Solicita un permiso o falta",
          order:       4,
          active:      true
        },
        {
          id:          "m5",
          type:        "builtin",
          action:      "contact",
          label:       "Ubícanos",
          description: "Dónde encontrarnos",
          order:       5,
          active:      true
        }
      ],
      createdAt: ts()
    });

    console.log("   5 ítems: Conócenos | Nuestros Programas | Horarios | Permisos | Ubícanos\n");

    // ── 12. Bot messages ───────────────────────────────────────────────────
    console.log("12. Mensajes del bot...");
    const botMessages = [
      {
        key: "greeting",        label: "Saludo principal",       category: "greeting",
        description: "Mensaje de bienvenida",
        content: `¡Hola{name}! 👋🎵\n\nBienvenido a *${ORG_NAME}*.\n\n¿Cómo podemos ayudarte hoy?`
      },
      {
        key: "fallback",        label: "Mensaje no reconocido",  category: "fallback",
        description: "Cuando el bot no entiende",
        content: "🤔 No entendí tu mensaje.\n\nEscribe *hola* para ver las opciones disponibles."
      },
      {
        key: "goodbye",         label: "Despedida",              category: "general",
        description: "Cuando el usuario se despide",
        content: "🎶 ¡Hasta pronto!\n\nEscribe *hola* cuando necesites ayuda."
      },
      {
        key: "session_expired", label: "Sesión expirada",        category: "general",
        description: "Cierre por inactividad",
        content: "Tu sesión se cerró por inactividad.\n\nEscribe *hola* para volver al menú. 🎵"
      },
      {
        key: "cancel",          label: "Cancelación",            category: "general",
        description: "Cuando cancela un proceso",
        content: "Proceso cancelado. Escribe *hola* para volver al menú."
      },
      {
        key: "flow_cancelled",  label: "Flujo cancelado",        category: "flow",
        description: "Cuando cancela dentro de un flujo",
        content: "Solicitud cancelada. 👋\n\nEscribe *hola* si deseas volver al menú."
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

    // ── 13. info/contact ───────────────────────────────────────────────────
    console.log("13. Información del instituto...");
    await orgRef.collection("info").doc("contact").set({
      address:    "Final Av. El Triunfo, Colonia San Roque",
      city:       "Sonsonate",
      country:    "El Salvador",
      phone:      "+503 2451-XXXX",
      email:      "info@canzion.edu.sv",
      maps:       "",
      showFields: { address: true, city: true, phone: true, email: true, country: true },
      createdAt:  ts()
    });

    // ── 14. info/schedule ──────────────────────────────────────────────────
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

    // ── 15. info/general ───────────────────────────────────────────────────
    await orgRef.collection("info").doc("general").set({
      name:        ORG_NAME,
      description:
        `*${ORG_NAME}* es una escuela de música cristiana dedicada a la formación ` +
        `integral de músicos al servicio de Dios y la iglesia.\n\n` +
        `Ofrecemos programas de instrumentos, canto, teoría musical y producción, ` +
        `con un enfoque en la excelencia y el carácter cristiano.\n\n` +
        `📍 Sonsonate, El Salvador`,
      focus:    ["Formación musical cristiana", "Guitarra, Batería, Bajo, Canto, Piano", "Producción Musical", "Desarrollo de carácter"],
      modality: "Presencial",
      note:     "Abierto a toda persona que desee aprender música con propósito.",
      createdAt: ts()
    });

    console.log("   contact, schedule (Sábado 08:00–12:00), general.\n");

    // ── RESUMEN ────────────────────────────────────────────────────────────
    console.log("========================================");
    console.log("  Script completado ✓");
    console.log("========================================\n");
    console.log(`  Org ID:    ${ORG_ID}`);
    console.log(`  Nombre:    ${ORG_NAME}`);
    console.log(`  Industria: academy`);
    console.log();
    console.log(`  Menú (5 ítems):`);
    console.log(`    1. Conócenos          → info general`);
    console.log(`    2. Nuestros Programas → browse (${PROGRAMAS.length} programas)`);
    console.log(`    3. Horarios           → días y horas`);
    console.log(`    4. Permisos           → flujo (5 pasos)`);
    console.log(`    5. Ubícanos           → dirección y contacto`);
    console.log();
    console.log(`  Programas (${PROGRAMAS.length}):`);
    PROGRAMAS.forEach(p => console.log(`    - ${p.nombre} (${p.edad})`));
    console.log();
    console.log(`  Instrumentos (${INSTRUMENTOS.length}): ${INSTRUMENTOS.join(", ")}`);
    console.log();
    console.log(`  Flujo "Permisos" (5 pasos):`);
    console.log(`    Paso 1 — Nombre completo`);
    console.log(`    Paso 2 — Programa (lista dinámica desde "programas")`);
    console.log(`    Paso 3 — Instrumento (lista dinámica desde "instrumentos")`);
    console.log(`    Paso 4 — Tipo: Permiso anticipado / Falta justificada / Tardanza`);
    console.log(`    Paso 5 — Motivo (texto libre)`);
    console.log(`    → Colección: permisos`);
    console.log();
    console.log(`  Horarios:`);
    console.log(`    Sábado   08:00–12:00`);
    console.log();
    console.log(`  ⚠️  Actualiza en el admin:`);
    console.log(`    - info/contact → dirección y teléfono reales`);
    console.log(`    - info/general → descripción final del instituto`);
    console.log(`  WA: ${savedWAConfig?.token ? "✓ Preservado" : "Vacío (configurar en superadmin)"}`);
    console.log();

  } catch (error) {
    console.error("\nError:", error);
  } finally {
    process.exit(0);
  }
}

seedCanzion();
