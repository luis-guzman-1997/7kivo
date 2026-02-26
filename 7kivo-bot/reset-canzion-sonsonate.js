/**
 * Reset Database Script - ICZ Sonsonate
 *
 * Resets data for an existing organization:
 * - Dynamic collection definitions (_collections/)
 * - Pre-populated data (programas, instrumentos)
 * - Dynamic flows (browse programs, registration, appointments)
 * - Menu configuration
 * - Bot messages
 * - Info (contact, schedule, general)
 *
 * PRESERVES: WhatsApp credentials, botApiUrl, user mappings, org config doc
 * DOES NOT TOUCH: admin user (admin@canzion.com)
 *
 * Usage: node reset-canzion-sonsonate.js
 */

require("dotenv").config();
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID || "kivo7-app";

function initFirebase() {
  const credsVal = (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  if (credsVal && credsVal.startsWith("{")) {
    try {
      const serviceAccount = JSON.parse(credsVal);
      if (serviceAccount.type === "service_account" && serviceAccount.private_key) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId
        });
        return;
      }
    } catch (e) {
      console.error("Error al parsear credenciales JSON:", e.message);
      throw e;
    }
  }
  if (credsVal && !credsVal.startsWith("{")) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId
    });
  } else {
    admin.initializeApp({ projectId });
  }
}

initFirebase();

const db = admin.firestore();
const ORG_ID = "instituto-canzion-sonsonate";
const ORG_NAME = "Instituto CanZion Sonsonate";
const ts = admin.firestore.FieldValue.serverTimestamp;

console.log(`\n========================================`);
console.log(`  Reset Database - ${ORG_ID}`);
console.log(`========================================\n`);

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

async function deleteConversationsDeep(parentRef) {
  const convsSnapshot = await parentRef.collection("conversations").get();
  let count = 0;
  for (const convDoc of convsSnapshot.docs) {
    const msgsSnapshot = await convDoc.ref.collection("messages").get();
    const batch = db.batch();
    msgsSnapshot.docs.forEach(msgDoc => batch.delete(msgDoc.ref));
    batch.delete(convDoc.ref);
    await batch.commit();
    count += msgsSnapshot.size + 1;
  }
  return count;
}

// ==================== MAIN ====================

async function resetDatabase() {
  try {
    // 0. Preserve WhatsApp credentials AND botApiUrl
    console.log("0. Preservando credenciales y configuración del bot...");
    let savedWAConfig = null;
    let savedBotApiUrl = "";
    try {
      const waDoc = await orgRef.collection("config").doc("whatsapp").get();
      if (waDoc.exists && waDoc.data()?.token) {
        savedWAConfig = waDoc.data();
        console.log(`   WA Token preservado (Phone: ${savedWAConfig.phoneNumberId || "N/A"})`);
      } else {
        console.log("   Sin credenciales WA previas.");
      }
      const generalDoc = await orgRef.collection("config").doc("general").get();
      if (generalDoc.exists && generalDoc.data()?.botApiUrl) {
        savedBotApiUrl = generalDoc.data().botApiUrl;
        console.log(`   botApiUrl preservado: ${savedBotApiUrl}`);
      } else {
        console.log("   Sin botApiUrl previo.");
      }
      console.log();
    } catch (e) {
      console.log("   No se pudo leer configuración previa.\n");
    }

    // 1. Clean old structures (schools/ legacy)
    console.log("1. Limpiando estructura anterior...");
    const oldSchoolRef = db.collection("schools").doc(ORG_ID);
    if ((await oldSchoolRef.get()).exists) {
      for (const col of ["applicants", "students", "teacherRequests", "flows", "botMessages", "programs", "instruments", "courseTypes", "config", "info"]) {
        await deleteCollection(oldSchoolRef.collection(col));
      }
      await deleteConversationsDeep(oldSchoolRef);
      await oldSchoolRef.delete();
      console.log("   Estructura schools/ eliminada.");
    }
    const globalAdmins = await db.collection("admins").get();
    if (!globalAdmins.empty) {
      const batch = db.batch();
      globalAdmins.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    // 2. Clean current org data (preserving whatsapp config)
    console.log("2. Limpiando datos de la organización...");
    const collectionsToClean = [
      "_collections", "contacts", "clients", "applicants", "students", "teacherRequests",
      "flows", "botMessages", "programs", "instruments", "courseTypes", "admins",
      "inquiries", "programas", "instrumentos", "aspirantes", "consultas", "citas"
    ];
    for (const col of collectionsToClean) {
      const count = await deleteCollection(orgRef.collection(col));
      if (count > 0) console.log(`   - ${col}: ${count} docs`);
    }
    for (const docName of ["general", "menu"]) {
      const d = await orgRef.collection("config").doc(docName).get();
      if (d.exists) await d.ref.delete();
    }
    for (const docName of ["contact", "schedule", "general"]) {
      const d = await orgRef.collection("info").doc(docName).get();
      if (d.exists) await d.ref.delete();
    }

    // Clean conversations
    console.log("   Limpiando conversaciones y sesiones...");
    const convCount = await deleteConversationsDeep(orgRef);
    console.log(`   - conversations: ${convCount} docs (mensajes + sesiones)`);
    console.log("   Limpieza completada.\n");

    // 3. Organization document (update, not overwrite)
    console.log("3. Actualizando organización...");
    await orgRef.set({
      name: ORG_NAME, orgId: ORG_ID, industry: "education", active: true, createdAt: ts()
    }, { merge: true });

    // 4. Config: general
    console.log("4. Configuración general...");
    await orgRef.collection("config").doc("general").set({
      orgName:            ORG_NAME,
      description:        "Escuela de música cristiana con enfoque en adoración y formación musical integral.",
      industry:           "education",
      welcomeMessage:     `¡Bienvenido a *${ORG_NAME}*! 🎵`,
      inactivityTimeout:  180000,
      personalWhatsApp:   "",
      botApiUrl:          savedBotApiUrl || "",
      createdAt:          ts()
    });

    // 5. Config: whatsapp
    console.log("5. Configuración WhatsApp...");
    if (savedWAConfig && savedWAConfig.token) {
      await orgRef.collection("config").doc("whatsapp").set({ ...savedWAConfig, updatedAt: ts() });
      console.log("   Credenciales RESTAURADAS.\n");
    } else {
      await orgRef.collection("config").doc("whatsapp").set({
        phoneNumberId: process.env.PHONE_NUMBER_WHATSAPP || "",
        token:         process.env.TOKEN_META_WHATSAPP || "",
        version:       process.env.VERSION_META_WHATSAPP || "v21.0",
        verifyToken:   process.env.VERIFY_META_TOKEN || "",
        createdAt:     ts()
      });
      console.log("   Credenciales desde .env (o vacías).\n");
    }

    // ==================== COLLECTIONS ====================

    // 6. Collection definitions (_collections/)
    console.log("6. Creando definiciones de colecciones...");

    await orgRef.collection("_collections").add({
      name: "Programas", slug: "programas", description: "Cursos disponibles en ICZ Sonsonate",
      displayField: "nombre",
      fields: [
        { key: "nombre",      label: "Nombre del Curso",  type: "text",   required: true  },
        { key: "edad",        label: "Rango de Edad",     type: "text",   required: true  },
        { key: "duracion",    label: "Duración",          type: "text",   required: false },
        { key: "descripcion", label: "Descripción",       type: "text",   required: false }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    await orgRef.collection("_collections").add({
      name: "Instrumentos", slug: "instrumentos", description: "Instrumentos disponibles",
      displayField: "nombre",
      fields: [
        { key: "nombre", label: "Instrumento", type: "text", required: true }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    await orgRef.collection("_collections").add({
      name: "Aspirantes", slug: "aspirantes", description: "Personas interesadas en inscribirse",
      displayField: "nombre",
      fields: [
        { key: "nombre",       label: "Nombre",       type: "text",      required: true  },
        { key: "edad",         label: "Edad",         type: "text",      required: true  },
        { key: "curso",        label: "Curso",        type: "reference", refCollection: "programas",    refDisplayField: "nombre", refValueField: "nombre", required: true },
        { key: "instrumento",  label: "Instrumento",  type: "reference", refCollection: "instrumentos", refDisplayField: "nombre", refValueField: "nombre", required: true },
        { key: "phoneNumber",  label: "WhatsApp",     type: "text",      required: false, protected: true }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    console.log("   3 bases de datos: programas, instrumentos, aspirantes\n");

    // 7. Populate programas
    console.log("7. Populando programas...");
    const programas = [
      {
        nombre: "Curso Ministerial Musical", edad: "Mayores de 16 años",
        duracion: "2 años (4 semestres)",
        descripcion: "Formación musical completa con enfoque en adoración y servicio ministerial.",
        active: true, order: 1
      },
      {
        nombre: "Canzion Instrumento", edad: "12 a 15 años",
        duracion: "2 años (4 semestres)",
        descripcion: "Programa de formación en instrumento para jóvenes.",
        active: true, order: 2
      },
      {
        nombre: "Kids", edad: "6 a 10 años",
        duracion: "2 años (4 semestres)",
        descripcion: "Iniciación musical integral para niños.",
        active: true, order: 3
      }
    ];
    for (const p of programas) {
      await orgRef.collection("programas").add({ ...p, createdAt: ts(), updatedAt: ts() });
    }
    console.log(`   ${programas.length} programas creados.\n`);

    // 8. Populate instrumentos
    console.log("8. Populando instrumentos...");
    const instrumentos = ["Guitarra", "Batería", "Bajo", "Canto", "Piano"];
    for (const nombre of instrumentos) {
      await orgRef.collection("instrumentos").add({ nombre, active: true, createdAt: ts(), updatedAt: ts() });
    }
    console.log(`   ${instrumentos.length} instrumentos creados.\n`);

    // ==================== FLOWS ====================

    // 9. Flows
    console.log("9. Creando flujos...");

    // --- Flow 1: Ver Programas ---
    await orgRef.collection("flows").add({
      name: "Ver Programas", description: "Explora los cursos musicales disponibles",
      type: "catalog", active: true, order: 1, saveToCollection: "", notifyAdmin: false,
      menuLabel: "Nuestros Cursos", menuDescription: "Conoce nuestra oferta académica",
      steps: [
        {
          id: "s1", type: "browse_collection",
          prompt: "🎓 *Oferta Académica*\n\nEstos son los cursos que tenemos para ti.\nSelecciona uno para conocer todos los detalles:",
          sourceCollection: "programas", displayField: "nombre",
          detailFields: ["nombre", "edad", "duracion", "descripcion"],
          fieldKey: "", fieldLabel: "", required: false, validation: {},
          errorMessage: "", optionsSource: "", customOptions: [],
          buttonText: "Ver cursos"
        }
      ],
      completionMessage: "",
      createdAt: ts(), updatedAt: ts()
    });

    // --- Flow 2: Inscríbete ---
    await orgRef.collection("flows").add({
      name: "Inscríbete", description: "Pre-inscripción para nuevos aspirantes",
      type: "registration", active: true, order: 2, saveToCollection: "aspirantes", notifyAdmin: true,
      menuLabel: "Inscríbete", menuDescription: "Inicia tu proceso de inscripción",
      steps: [
        {
          id: "s1", type: "text_input",
          prompt: "🎵 *¡Excelente decisión!*\n\nComencemos con tu pre-inscripción.\n\nEscribe tu *nombre completo*:",
          fieldKey: "nombre", fieldLabel: "Nombre", required: true,
          validation: { minLength: 3 }, errorMessage: "Necesitamos al menos 3 caracteres. Escríbelo de nuevo por favor.",
          optionsSource: "custom", optionsTitleField: "", optionsDescField: "",
          customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: [], timeFieldKey: ""
        },
        {
          id: "s2", type: "text_input",
          prompt: "Perfecto ✨\n\n¿Cuántos *años* tienes?",
          fieldKey: "edad", fieldLabel: "Edad", required: true,
          validation: {}, errorMessage: "",
          optionsSource: "custom", optionsTitleField: "", optionsDescField: "",
          customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: [], timeFieldKey: ""
        },
        {
          id: "s3", type: "select_list",
          prompt: "🎯 ¿Qué *programa* te interesa?\n\nElige el curso que más se adapte a ti:",
          fieldKey: "curso", fieldLabel: "Curso", required: true,
          validation: {}, errorMessage: "", optionsSource: "programas",
          optionsTitleField: "nombre", optionsDescField: "edad",
          customOptions: [], buttonText: "Ver programas",
          sourceCollection: "", displayField: "", detailFields: [], timeFieldKey: ""
        },
        {
          id: "s4", type: "select_list",
          prompt: "🎸 ¿Qué *instrumento* te gustaría aprender?\n\nElige tu favorito:",
          fieldKey: "instrumento", fieldLabel: "Instrumento", required: true,
          validation: {}, errorMessage: "", optionsSource: "instrumentos",
          optionsTitleField: "nombre", optionsDescField: "",
          customOptions: [], buttonText: "Ver instrumentos",
          sourceCollection: "", displayField: "", detailFields: [], timeFieldKey: ""
        }
      ],
      completionMessage: "✅ *Pre-inscripción recibida*\n\nHemos registrado tu información correctamente.\n\n*Nombre:* {nombre}\n*Edad:* {edad}\n*Curso:* {curso}\n*Instrumento:* {instrumento}\n*WhatsApp:* {phoneNumber}\n\nUn miembro de nuestro equipo se pondrá en contacto contigo pronto para confirmar tu inscripción.\n\nGracias por tu interés en *" + ORG_NAME + "*.",
      createdAt: ts(), updatedAt: ts()
    });

    console.log("   2 flujos: Ver Programas, Inscríbete\n");

    // ==================== MENU ====================

    // 10. Menu config
    console.log("10. Configuración del menú...");
    const flowsSnap = await orgRef.collection("flows").get();
    const flowDocs = flowsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const browseFlow = flowDocs.find(f => f.name === "Ver Programas");
    const regFlow    = flowDocs.find(f => f.name === "Inscríbete");

    await orgRef.collection("config").doc("menu").set({
      greeting: `¡Hola{name}! 👋🎵\n\nBienvenido a *${ORG_NAME}*\nTu escuela de música en Sonsonate.\n\n¿Cómo podemos ayudarte hoy?`,
      menuButtonText: "Ver opciones",
      fallbackMessage: "🤔 No logré entender tu mensaje.\n\nEscribe *hola* para ver todas las opciones disponibles.",
      exitMessage: `🎶 ¡Hasta pronto!\n\nFue un gusto atenderte. Escribe *hola* cuando quieras volver.\n\n_${ORG_NAME} — Formando adoradores_ 🎵`,
      items: [
        { id: "m1", type: "flow",    flowId: browseFlow?.id || "", label: "Nuestros Cursos", description: "Conoce nuestra oferta académica", order: 1, active: true },
        { id: "m2", type: "flow",    flowId: regFlow?.id    || "", label: "Inscríbete",      description: "Inicia tu pre-inscripción",       order: 2, active: true },
        { id: "m3", type: "builtin", action: "schedule",           label: "Horarios",        description: "Días y horarios de atención",     order: 3, active: true },
        { id: "m4", type: "builtin", action: "contact",            label: "Ubicación",       description: "Cómo llegar al instituto",        order: 4, active: true },
        { id: "m5", type: "builtin", action: "general",            label: "Sobre Nosotros",  description: "Conoce nuestra misión",           order: 5, active: true }
      ],
      createdAt: ts()
    });
    console.log("   Menú configurado.\n");

    // ==================== BOT MESSAGES ====================

    // 11. Bot messages
    console.log("11. Mensajes del bot...");
    const botMessages = [
      {
        key: "greeting",        label: "Saludo principal",        category: "greeting",
        description: "Mensaje de bienvenida",
        content: `¡Hola{name}! 👋\n\nBienvenido a *${ORG_NAME}*\nTu escuela de música en Sonsonate.\n\n¿Cómo podemos ayudarte hoy?`
      },
      {
        key: "fallback",        label: "Mensaje no reconocido",   category: "fallback",
        description: "Cuando el bot no entiende",
        content: "No logré entender tu mensaje.\n\nEscribe *hola* para ver las opciones."
      },
      {
        key: "goodbye",         label: "Despedida",               category: "general",
        description: "Cuando el usuario se despide",
        content: "¡Hasta pronto! 🎶\n\nFue un gusto atenderte. Escribe *hola* cuando quieras volver."
      },
      {
        key: "session_expired", label: "Sesión expirada",         category: "general",
        description: "Cierre por inactividad",
        content: "Tu sesión se cerró por inactividad.\n\nEscribe *hola* cuando quieras retomar."
      },
      {
        key: "cancel",          label: "Cancelación",             category: "general",
        description: "Cuando cancela un proceso",
        content: "Proceso cancelado. Escribe *hola* para volver al menú."
      },
      {
        key: "flow_cancel_hint", label: "Aviso de cancelación",   category: "flow",
        description: "Al iniciar un flujo",
        content: "Puedes escribir *cancelar* en cualquier momento para detener este proceso.\n"
      },
      {
        key: "admin_farewell",  label: "Despedida de admin",      category: "admin",
        description: "Cuando admin devuelve control",
        content: "La conversación con nuestro equipo ha finalizado.\n\nEscribe *hola* para ver el menú."
      },
      {
        key: "no_registration", label: "Registro no disponible",  category: "flow",
        description: "Sin flujo de registro",
        content: "El registro no está disponible en este momento.\n\nEscribe *hola* para ver otras opciones."
      }
    ];
    for (const msg of botMessages) {
      await orgRef.collection("botMessages").add({ ...msg, createdAt: ts() });
    }
    console.log(`   ${botMessages.length} mensajes.\n`);

    // ==================== INFO ====================

    // 12. Info
    console.log("12. Información base...");

    // contact — 'name' key used by infoDone check: contact?.phone || contact?.address
    await orgRef.collection("info").doc("contact").set({
      address:    "8va Av. Norte # 6-3, Colonia Aida, Sonsonate",
      city:       "Sonsonate",
      country:    "El Salvador",
      phone:      "6930-7473",
      email:      "sonsonate@institutocanzion.com",
      showFields: { address: true, city: true, phone: true, email: true, country: true },
      createdAt:  ts()
    });

    // schedule — solo Sábado 08:00–12:00, sin citas por bot
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
      services:           [],
      createdAt: ts()
    });

    // general — 'name' key requerido por infoDone: general?.name && general?.description
    await orgRef.collection("info").doc("general").set({
      name:        ORG_NAME,
      description: "Escuela de música cristiana con enfoque en adoración y formación musical integral. Formamos músicos con excelencia técnica y pasión por el servicio.",
      focus:       ["Formación musical", "Adoración", "Desarrollo artístico integral"],
      modality:    "Presencial",
      instrumentsNote: "Guitarra, Piano, Batería, Bajo y Canto",
      openToAll:   true,
      createdAt:   ts()
    });
    console.log("   contact, schedule, general.\n");

    // ==================== ADMINS ====================

    // 13. Restore admins with roles
    console.log("13. Restaurando administradores...");
    const adminsSnap = await orgRef.collection("admins").get();
    if (adminsSnap.empty) {
      const usersSnapshot = await db.collection("users").get();
      const orgAdmins = usersSnapshot.docs
        .filter(d => d.data().organizationId === ORG_ID)
        .map(d => ({ uid: d.id, ...d.data() }));

      if (orgAdmins.length > 0) {
        const hasOwner = orgAdmins.some(a => a.role === "owner");
        for (let i = 0; i < orgAdmins.length; i++) {
          const adm = orgAdmins[i];
          const role = adm.role || (!hasOwner && i === 0 ? "owner" : "editor");

          await orgRef.collection("admins").add({
            uid: adm.uid, email: adm.email, name: adm.name || adm.email,
            role, active: true, createdAt: ts()
          });

          if (role !== adm.role) {
            await db.collection("users").doc(adm.uid).update({ role });
          }
        }
        console.log(`   ${orgAdmins.length} usuario(s):`);
        orgAdmins.forEach(a => console.log(`     - ${a.email} (${a.role || "owner"})`));
      } else {
        console.log("   Sin usuarios encontrados en users/.");
      }
    } else {
      console.log(`   ${adminsSnap.size} usuario(s) ya existentes (preservados).`);
    }

    // ==================== PLATFORM CONFIG (Super Admin) ====================

    console.log("\n14. Configuración de plataforma (Super Admin)...");

    const platformPlansRef = db.collection("platformConfig").doc("plans");
    await platformPlansRef.set({
      plans: [
        {
          name: "Starter", price: 9.99, active: true,
          features: [
            "Bot WhatsApp con menú interactivo",
            "1 flujo conversacional",
            "1 base de datos",
            "Bandeja de entrada",
            "Chat WhatsApp (solo lectura)"
          ]
        },
        {
          name: "Business", price: 19.99, active: true,
          features: [
            "Bot WhatsApp con menú interactivo",
            "Hasta 3 flujos conversacionales",
            "Hasta 3 bases de datos",
            "Bandeja de entrada con calendario",
            "Sistema de citas y agenda",
            "Chat en vivo con clientes",
            "3 usuarios administradores"
          ]
        },
        {
          name: "Premium", price: 39.99, active: true,
          features: [
            "Todo lo de Business",
            "Hasta 5 flujos conversacionales",
            "Hasta 10 bases de datos",
            "Roles y permisos (Propietario, Gerente, Operador, Agente)",
            "Logo y marca personalizada",
            "Horarios de atención configurables",
            "5 usuarios administradores"
          ]
        },
        {
          name: "Enterprise", price: 100, active: true,
          features: [
            "Todo lo de Premium",
            "Hasta 20 flujos conversacionales",
            "Bases de datos ilimitadas",
            "Contactos ilimitados",
            "Usuarios administradores ilimitados",
            "Configuración avanzada del bot"
          ]
        }
      ],
      updatedAt: ts()
    }, { merge: true });
    console.log("   4 planes configurados (Starter, Business, Premium, Enterprise).");

    await orgRef.update({
      botEnabled:  true,
      plan:        "Enterprise",
      monthlyRate: 0
    });
    console.log(`   Org ${ORG_ID}: plan Enterprise ($0), bot habilitado.\n`);

    // ==================== SUMMARY ====================

    console.log(`\n========================================`);
    console.log(`  Reset completado`);
    console.log(`========================================\n`);
    console.log(`  Org:            ${ORG_ID}`);
    console.log(`  Nombre:         ${ORG_NAME}`);
    console.log(`  botApiUrl:      ${savedBotApiUrl || "(vacío — configurar en superadmin)"}`);
    console.log(`  WhatsApp:       ${savedWAConfig?.token ? "Preservado" : "(vacío — configurar en superadmin)"}`);
    console.log(`  Bases de datos: programas, instrumentos, aspirantes (phoneNumber protegido)`);
    console.log(`  Programas:      Curso Ministerial Musical, Canzion Instrumento, Kids`);
    console.log(`  Instrumentos:   Guitarra, Batería, Bajo, Canto, Piano`);
    console.log(`  Flujos:         Ver Programas (browse), Inscríbete (registro)`);
    console.log(`  Citas:          NO — esta organización no agenda citas por bot`);
    console.log(`  Menú:           Programas | Inscríbete | Horarios | Ubicación | Sobre Nosotros`);
    console.log(`  Plan:           Enterprise ($0 — cortesía)`);
    console.log(`  Super Admin:    admin@7kivo.com`);
    console.log(`\n  Siguiente: npm start\n`);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

resetDatabase();
