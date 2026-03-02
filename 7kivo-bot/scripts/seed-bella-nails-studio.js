/**
 * Script Seed — Bella Nails Studio
 *
 * Organización: instituto-canzion-sonsonate (reconfigura como salón de uñas)
 * Rubro: Salón de uñas / belleza
 *
 * Crea desde cero:
 *  - Org document
 *  - config/general  (sin tocar whatsapp)
 *  - info/contact, schedule, general
 *  - colección: citas
 *  - flujo: Agendar Cita (appointment, 30 min/slot)
 *  - menú: Agendar Cita | Nuestros Servicios | Promociones del mes
 *          | Horarios | Ubicación | Sobre Nosotros
 *  - botMessages estándar
 *
 * Horario: Lun–Vie 08:00–12:00 / 13:00–17:00  |  Sáb 08:00–12:00
 * Duración slot: 30 min   →  Slots/día L–V: 16 · Sáb: 8
 *
 * Uso:
 *   cd 7kivo-bot
 *   node scripts/seed-bella-nails-studio.js
 */

require("dotenv").config();
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID || "kivo7-app";
const ORG_ID    = "instituto-canzion-sonsonate";
const ORG_NAME  = "Bella Nails Studio";

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

async function seedNailStudio() {
  console.log("\n========================================");
  console.log(`  Bella Nails Studio`);
  console.log(`  Org ID: ${ORG_ID}`);
  console.log("========================================\n");

  try {
    // ── 1. Preservar WhatsApp si ya existe para esta org ───────────────────
    console.log("1. Verificando configuración WA existente...");
    let savedWAConfig = null;
    let savedBotApiUrl = "";
    try {
      const waDoc = await orgRef.collection("config").doc("whatsapp").get();
      if (waDoc.exists && waDoc.data()?.token) {
        savedWAConfig  = waDoc.data();
        console.log(`   Token WA preservado (Phone: ${savedWAConfig.phoneNumberId || "N/A"})`);
      }
      const genDoc = await orgRef.collection("config").doc("general").get();
      if (genDoc.exists && genDoc.data()?.botApiUrl) {
        savedBotApiUrl = genDoc.data().botApiUrl;
        console.log(`   botApiUrl preservado: ${savedBotApiUrl}`);
      }
    } catch (_) {}
    if (!savedWAConfig) console.log("   Sin credenciales previas — se dejan vacías.\n");
    else console.log();

    // ── 2. Limpiar colecciones dinámicas (sin tocar whatsapp) ───────────────
    console.log("2. Limpiando datos previos...");
    const toClear = [
      "_collections", "flows", "botMessages",
      "citas", "consultas", "contacts", "clients",
      // colecciones del rubro anterior (escuela de música)
      "programas", "instrumentos", "aspirantes"
    ];
    for (const col of toClear) {
      const n = await deleteCollection(orgRef.collection(col));
      if (n > 0) console.log(`   - ${col}: ${n} docs`);
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
      industry:      "beauty",
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
      description:       "Salón especializado en manicura, pedicura y diseño de uñas. Belleza y cuidado personal a tu alcance.",
      industry:          "beauty",
      welcomeMessage:    `¡Bienvenida a *${ORG_NAME}*! 💅`,
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

    // ── 6. Colección: citas ────────────────────────────────────────────────
    console.log("6. Colección de datos...");
    await orgRef.collection("_collections").add({
      name:         "Citas",
      slug:         "citas",
      description:  "Citas agendadas desde el bot",
      displayField: "nombre",
      fields: [
        { key: "nombre",      label: "Nombre del cliente", type: "text",   required: true           },
        { key: "servicio",    label: "Servicio",            type: "text",   required: true           },
        { key: "fecha",       label: "Fecha",               type: "text",   required: true           },
        { key: "hora",        label: "Hora",                type: "text",   required: true           },
        { key: "phoneNumber", label: "WhatsApp",            type: "text",   required: false, protected: true }
      ],
      createdAt: ts(),
      updatedAt: ts()
    });
    console.log("   Colección 'citas' creada.\n");

    // ── 7. Flujo: Agendar Cita ─────────────────────────────────────────────
    console.log("7. Creando flujos...");

    const apptFlowRef = await orgRef.collection("flows").add({
      name:             "Agendar Cita",
      description:      "Reserva tu cita de manicura o pedicura",
      type:             "appointment",
      active:           true,
      order:            1,
      saveToCollection: "citas",
      notifyAdmin:      true,
      menuLabel:        "Agendar Cita",
      menuDescription:  "Reserva tu espacio",
      showInMenu:       true,
      steps: [
        {
          // Paso 1 — Nombre
          id:            "s1",
          type:          "text_input",
          prompt:        `💅 *¡Hola! Agenda tu cita en ${ORG_NAME}*\n\nPara reservar tu espacio necesitamos algunos datos.\n\nEscribe tu *nombre completo*:`,
          fieldKey:      "nombre",
          fieldLabel:    "Nombre",
          required:      true,
          validation:    { minLength: 3 },
          errorMessage:  "Escribe al menos 3 caracteres, por favor.",
          optionsSource: "custom",
          customOptions: [],
          buttonText:    "",
          sourceCollection: "",
          displayField:  "",
          detailFields:  [],
          timeFieldKey:  ""
        },
        {
          // Paso 2 — Servicio
          id:            "s2",
          type:          "select_buttons",
          prompt:        "¿Qué servicio deseas? 💅\n\nElige una opción:",
          fieldKey:      "servicio",
          fieldLabel:    "Servicio",
          required:      true,
          validation:    {},
          errorMessage:  "",
          optionsSource: "custom",
          optionsTitleField: "",
          optionsDescField:  "",
          customOptions: [
            { label: "Manicure clásica",        value: "Manicure clásica",        description: "Limado, cutícula y esmalte regular",    duration: 30 },
            { label: "Manicure semipermanente",  value: "Manicure semipermanente",  description: "Esmalte gel de larga duración",          duration: 30 },
            { label: "Pedicure clásico",         value: "Pedicure clásico",         description: "Limpieza, exfoliación y esmalte",        duration: 30 },
            { label: "Uñas acrílicas",           value: "Uñas acrílicas",           description: "Extensión completa con acrílico",        duration: 60 }
          ],
          buttonText:    "Ver servicios",
          sourceCollection: "",
          displayField:  "",
          detailFields:  [],
          timeFieldKey:  ""
        },
        {
          // Paso 3 — Fecha y hora (calendar)
          id:            "s3",
          type:          "appointment_slot",
          prompt:        "Elige el *día* de tu preferencia:\n\nSolo aparecen días con disponibilidad. 📅",
          fieldKey:      "fecha",
          fieldLabel:    "Fecha",
          required:      true,
          timeFieldKey:  "hora",
          validation:    {},
          errorMessage:  "",
          optionsSource: "custom",
          optionsTitleField: "",
          optionsDescField:  "",
          customOptions: [
            { label: "Cita", value: "cita", description: "Servicio de uñas", duration: 30 }
          ],
          buttonText:    "Ver días",
          sourceCollection: "",
          displayField:  "",
          detailFields:  []
        }
      ],
      completionMessage:
        `✅ *¡Cita confirmada!* 💅\n\n` +
        `*Nombre:*   {nombre}\n` +
        `*Servicio:* {servicio}\n` +
        `*Fecha:*    {fecha}\n` +
        `*Hora:*     {hora}\n\n` +
        `Te esperamos en *${ORG_NAME}*.\n` +
        `Recuerda llegar puntual ⏰\n` +
        `Si necesitas cancelar, avísanos con anticipación.\n\n` +
        `_¡Hasta pronto! ✨_`,
      createdAt: ts(),
      updatedAt: ts()
    });

    console.log(`   ✓ Agendar Cita (id: ${apptFlowRef.id})\n`);

    // ── 8. Menú ────────────────────────────────────────────────────────────
    console.log("8. Configurando menú...");

    // Texto de promociones del mes (Marzo 2026)
    const promosTexto =
      `🌸 *Promociones de Marzo 2026*\n\n` +
      `💅 *2×1 en manicure clásica* — todos los martes\n` +
      `✨ *20% de descuento* en uñas acrílicas para clientes nuevas\n` +
      `🎁 *Paquete Spa*: manicure + pedicure clásico por solo *$15*\n` +
      `🌺 *Diseño gratis* en cualquier servicio los viernes\n\n` +
      `_Vigente durante marzo 2026. Consulta disponibilidad._\n\n` +
      `Escribe *hola* para ver el menú principal.`;

    // Texto de servicios con precios
    const serviciosTexto =
      `💅 *Nuestros Servicios*\n\n` +
      `🌸 *Manicure clásica* — $5\n` +
      `   Limado, cutícula y esmalte regular\n\n` +
      `✨ *Manicure semipermanente* — $10\n` +
      `   Esmalte gel de larga duración\n\n` +
      `🦶 *Pedicure clásico* — $8\n` +
      `   Limpieza, exfoliación y esmalte\n\n` +
      `💎 *Uñas acrílicas* — $20\n` +
      `   Extensión completa con acrílico y diseño\n\n` +
      `🎨 *Retoque / mantenimiento* — $12\n` +
      `   Relleno y ajuste cada 3 semanas\n\n` +
      `_Pregunta por paquetes especiales y combos._`;

    await orgRef.collection("config").doc("menu").set({
      greeting:        `¡Hola{name}! 👋💅\n\nBienvenida a *${ORG_NAME}*\nTu salón de belleza de confianza.\n\n¿Cómo te podemos ayudar hoy?`,
      menuButtonText:  "Ver opciones",
      fallbackMessage: "🤔 No entendí tu mensaje.\n\nEscribe *hola* para ver todas las opciones.",
      exitMessage:     `✨ ¡Hasta pronto!\n\nFue un gusto atenderte. Escribe *hola* cuando quieras volver.\n\n_${ORG_NAME} — Tu belleza, nuestra pasión_ 💅`,
      items: [
        {
          id: "m1", type: "flow",    flowId: apptFlowRef.id,
          label: "Agendar Cita",        description: "Reserva tu espacio",
          order: 1, active: true
        },
        {
          id: "m2", type: "message",
          label: "Nuestros Servicios",  description: "Precios y servicios disponibles",
          messageContent: serviciosTexto,
          order: 2, active: true
        },
        {
          id: "m3", type: "message",
          label: "Promociones del mes", description: "Ofertas especiales de Marzo",
          messageContent: promosTexto,
          order: 3, active: true
        },
        {
          id: "m4", type: "builtin", action: "schedule",
          label: "Horarios",            description: "Días y horas de atención",
          order: 4, active: true
        },
        {
          id: "m5", type: "builtin", action: "contact",
          label: "Ubicación",           description: "Dónde encontrarnos",
          order: 5, active: true
        },
        {
          id: "m6", type: "builtin", action: "general",
          label: "Sobre Nosotros",      description: "Conoce el salón",
          order: 6, active: true
        }
      ],
      createdAt: ts()
    });
    console.log("   6 ítems: Agendar Cita | Servicios | Promociones | Horarios | Ubicación | Sobre Nosotros\n");

    // ── 9. Bot messages ────────────────────────────────────────────────────
    console.log("9. Mensajes del bot...");
    const botMessages = [
      {
        key: "greeting",        label: "Saludo principal",      category: "greeting",
        description: "Mensaje de bienvenida",
        content: `¡Hola{name}! 👋💅\n\nBienvenida a *${ORG_NAME}*\nTu salón de belleza de confianza.\n\n¿Cómo te podemos ayudar hoy?`
      },
      {
        key: "fallback",        label: "Mensaje no reconocido", category: "fallback",
        description: "Cuando el bot no entiende",
        content: "🤔 No entendí tu mensaje.\n\nEscribe *hola* para ver las opciones disponibles."
      },
      {
        key: "goodbye",         label: "Despedida",             category: "general",
        description: "Cuando el usuario se despide",
        content: "✨ ¡Hasta pronto!\n\nFue un gusto atenderte. Escribe *hola* cuando quieras volver."
      },
      {
        key: "session_expired", label: "Sesión expirada",       category: "general",
        description: "Cierre por inactividad",
        content: "Tu sesión se cerró por inactividad.\n\nEscribe *hola* cuando quieras retomar. 💅"
      },
      {
        key: "cancel",          label: "Cancelación",           category: "general",
        description: "Cuando cancela un proceso",
        content: "Proceso cancelado. Escribe *hola* para volver al menú."
      },
      {
        key: "flow_cancel_hint", label: "Aviso de cancelación", category: "flow",
        description: "Al iniciar un flujo",
        content: "Puedes escribir *cancelar* en cualquier momento para detener este proceso.\n"
      },
      {
        key: "admin_farewell",  label: "Despedida de admin",    category: "admin",
        description: "Cuando admin devuelve control",
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
    console.log(`   ${botMessages.length} mensajes.\n`);

    // ── 10. info/contact ───────────────────────────────────────────────────
    console.log("10. Información del negocio...");
    await orgRef.collection("info").doc("contact").set({
      address:    "3a Calle Poniente #14, Colonia Santa Lucía",
      city:       "Sonsonate",
      country:    "El Salvador",
      phone:      "7834-5621",
      email:      "bellanails.sonsonate@gmail.com",
      maps:       "https://maps.google.com",
      showFields: { address: true, city: true, phone: true, email: true, country: true },
      createdAt:  ts()
    });

    // ── 11. info/schedule ──────────────────────────────────────────────────
    await orgRef.collection("info").doc("schedule").set({
      days: [
        { name: "Lunes",     active: true,  shifts: [{ from: "08:00", to: "12:00" }, { from: "13:00", to: "17:00" }] },
        { name: "Martes",    active: true,  shifts: [{ from: "08:00", to: "12:00" }, { from: "13:00", to: "17:00" }] },
        { name: "Miércoles", active: true,  shifts: [{ from: "08:00", to: "12:00" }, { from: "13:00", to: "17:00" }] },
        { name: "Jueves",    active: true,  shifts: [{ from: "08:00", to: "12:00" }, { from: "13:00", to: "17:00" }] },
        { name: "Viernes",   active: true,  shifts: [{ from: "08:00", to: "12:00" }, { from: "13:00", to: "17:00" }] },
        { name: "Sábado",    active: true,  shifts: [{ from: "08:00", to: "12:00" }] },
        { name: "Domingo",   active: false, shifts: [] }
      ],
      slotDuration:       30,
      blockedDates:       [],
      offersAppointments: true,
      services: [
        { id: "srv1", name: "Manicure clásica",        description: "Limado, cutícula y esmalte regular",     duration: 30, active: true },
        { id: "srv2", name: "Manicure semipermanente",  description: "Esmalte gel de larga duración",          duration: 30, active: true },
        { id: "srv3", name: "Pedicure clásico",         description: "Limpieza, exfoliación y esmalte",        duration: 30, active: true },
        { id: "srv4", name: "Uñas acrílicas",           description: "Extensión completa con acrílico",        duration: 60, active: true },
        { id: "srv5", name: "Retoque / mantenimiento",  description: "Relleno y ajuste de uñas acrílicas",     duration: 30, active: true }
      ],
      createdAt: ts()
    });

    // ── 12. info/general ───────────────────────────────────────────────────
    await orgRef.collection("info").doc("general").set({
      name:        ORG_NAME,
      description: "Salón especializado en manicura, pedicura y diseño de uñas. Contamos con un equipo profesional enfocado en brindarte la mejor experiencia de belleza y relajación.",
      focus:       ["Manicura y pedicura", "Uñas acrílicas y gel", "Diseños personalizados", "Atención personalizada"],
      modality:    "Presencial",
      team:        "Equipo femenino certificado",
      note:        "Usamos productos de alta calidad. Tu seguridad e higiene son nuestra prioridad.",
      openToAll:   true,
      createdAt:   ts()
    });
    console.log("   contact, schedule (Lun–Vie doble turno + Sáb), general.\n");

    // ── RESUMEN ────────────────────────────────────────────────────────────
    console.log("========================================");
    console.log("  Script completado");
    console.log("========================================\n");
    console.log(`  Org ID:     ${ORG_ID}`);
    console.log(`  Nombre:     ${ORG_NAME}`);
    console.log(`  Industria:  beauty`);
    console.log(`  Horario:    Lun–Vie  08:00–12:00 / 13:00–17:00  (16 slots/día)`);
    console.log(`              Sábado   08:00–12:00                  (8 slots/día)`);
    console.log(`  Slot:       30 min`);
    console.log(`  Servicios:`);
    console.log(`    • Manicure clásica         $5   (30 min)`);
    console.log(`    • Manicure semipermanente  $10  (30 min)`);
    console.log(`    • Pedicure clásico         $8   (30 min)`);
    console.log(`    • Uñas acrílicas           $20  (60 min = 2 slots)`);
    console.log(`    • Retoque / mantenimiento  $12  (30 min)`);
    console.log(`  Flujo:      Agendar Cita (appointment)`);
    console.log(`  Menú:`);
    console.log(`    1. Agendar Cita`);
    console.log(`    2. Nuestros Servicios  (precios)`);
    console.log(`    3. Promociones del mes (Marzo 2026)`);
    console.log(`    4. Horarios`);
    console.log(`    5. Ubicación`);
    console.log(`    6. Sobre Nosotros`);
    console.log(`  Colección:  citas`);
    console.log(`  WA:         ${savedWAConfig?.token ? "Preservado" : "Vacío (configurar en superadmin)"}`);
    console.log(`\n  Siguiente: configura WA en superadmin → activa el bot\n`);

  } catch (error) {
    console.error("\nError:", error);
  } finally {
    process.exit(0);
  }
}

seedNailStudio();
