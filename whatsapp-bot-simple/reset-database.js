/**
 * Reset Database Script - ICZ Sonsonate
 * 
 * Resets data for an existing organization:
 * - Dynamic collection definitions (_collections/)
 * - Pre-populated data (programas, instrumentos)
 * - Dynamic flows (browse programs, registration)
 * - Menu configuration
 * - Bot messages
 * - Info (contact, schedule, general)
 * 
 * PRESERVES: WhatsApp credentials, user mappings, org config doc
 * DOES NOT TOUCH: admin user (admin@canzion.com)
 * 
 * Usage: node reset-database.js
 */

require("dotenv").config();
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID || "kivo7-app";

if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId
  });
} else {
  admin.initializeApp({ projectId });
}

const db = admin.firestore();
const ORG_ID = process.env.ORG_ID || process.env.SCHOOL_ID || "demo";
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
    // 0. Preserve WhatsApp credentials
    console.log("0. Preservando credenciales de WhatsApp...");
    let savedWAConfig = null;
    try {
      const waDoc = await orgRef.collection("config").doc("whatsapp").get();
      if (waDoc.exists && waDoc.data()?.token) {
        savedWAConfig = waDoc.data();
        console.log(`   Token preservado (Phone: ${savedWAConfig.phoneNumberId || 'N/A'})\n`);
      } else {
        console.log("   Sin credenciales previas.\n");
      }
    } catch (e) {
      console.log("   No se pudieron leer credenciales.\n");
    }

    // 1. Clean old structures
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
      "inquiries", "programas", "instrumentos", "aspirantes", "consultas"
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

    // Clean conversations (includes chat messages + bot sessions)
    console.log("   Limpiando conversaciones y sesiones...");
    const convCount = await deleteConversationsDeep(orgRef);
    console.log(`   - conversations: ${convCount} docs (mensajes + sesiones)`);
    console.log("   Limpieza completada.\n");

    // 3. Organization document (update, not overwrite)
    console.log("3. Actualizando organización...");
    await orgRef.set({
      name: ORG_NAME, orgId: ORG_ID, industry: "educacion", active: true, createdAt: ts()
    }, { merge: true });

    // 4. Config: general
    console.log("4. Configuración general...");
    await orgRef.collection("config").doc("general").set({
      orgName: ORG_NAME, description: "Escuela de música cristiana con enfoque en adoración y formación musical integral.",
      industry: "educacion", welcomeMessage: `¡Bienvenido a *${ORG_NAME}*! 🎵`,
      inactivityTimeout: 180000, personalWhatsApp: "", botApiUrl: "http://localhost:3005",
      createdAt: ts()
    });

    // 5. Config: whatsapp
    console.log("5. Configuración WhatsApp...");
    if (savedWAConfig && savedWAConfig.token) {
      await orgRef.collection("config").doc("whatsapp").set({ ...savedWAConfig, updatedAt: ts() });
      console.log("   Credenciales RESTAURADAS.\n");
    } else {
      await orgRef.collection("config").doc("whatsapp").set({
        phoneNumberId: process.env.PHONE_NUMBER_WHATSAPP || "",
        token: process.env.TOKEN_META_WHATSAPP || "",
        version: process.env.VERSION_META_WHATSAPP || "v21.0",
        verifyToken: process.env.VERIFY_META_TOKEN || "",
        createdAt: ts()
      });
    }

    // ==================== COLLECTIONS ====================

    // 6. Collection definitions (_collections/)
    console.log("6. Creando definiciones de colecciones...");

    await orgRef.collection("_collections").add({
      name: "Programas", slug: "programas", description: "Cursos disponibles en ICZ Sonsonate",
      displayField: "nombre",
      fields: [
        { key: "nombre", label: "Nombre del Curso", type: "text", required: true },
        { key: "edad", label: "Rango de Edad", type: "text", required: true },
        { key: "duracion", label: "Duración", type: "text", required: false },
        { key: "descripcion", label: "Descripción", type: "text", required: false }
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
        { key: "nombre", label: "Nombre", type: "text", required: true },
        { key: "edad", label: "Edad", type: "text", required: true },
        { key: "curso", label: "Curso", type: "reference", refCollection: "programas", required: true },
        { key: "instrumento", label: "Instrumento", type: "reference", refCollection: "instrumentos", required: true }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    console.log("   3 colecciones: programas, instrumentos, aspirantes\n");

    // 7. Populate programas (based on https://sv.institutocanzion.com/sonsonate)
    console.log("7. Populando programas...");
    const programas = [
      {
        nombre: "Curso Ministerial Musical", edad: "Mayores de 16 años",
        duracion: "2 años (4 semestres)",
        descripcion: "Formación musical completa con enfoque en adoración y servicio ministerial.",
        active: true, order: 1
      },
      {
        nombre: "Teens", edad: "12 a 15 años",
        duracion: "2 años (4 semestres)",
        descripcion: "Programa de desarrollo musical para adolescentes.",
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

    await orgRef.collection("flows").add({
      name: "Ver Programas", description: "Navegar y ver detalles de cursos disponibles",
      type: "catalog", active: true, order: 1, saveToCollection: "",
      menuLabel: "Programas", menuDescription: "Ver cursos disponibles", showInMenu: true,
      steps: [
        {
          id: "s1", type: "browse_collection",
          prompt: "*Cursos Disponibles*\n\nSelecciona un curso para ver detalles:",
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

    await orgRef.collection("flows").add({
      name: "Inscríbete", description: "Formulario de inscripción para nuevos aspirantes",
      type: "registration", active: true, order: 2, saveToCollection: "aspirantes",
      menuLabel: "Inscríbete", menuDescription: "Registra tus datos", showInMenu: true,
      steps: [
        {
          id: "s1", type: "text_input",
          prompt: "¡Genial que quieras inscribirte! 🎵\n\nPor favor, escribe tu *nombre completo*:",
          fieldKey: "nombre", fieldLabel: "Nombre", required: true,
          validation: { minLength: 3 }, errorMessage: "El nombre debe tener al menos 3 caracteres.",
          optionsSource: "custom", customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: []
        },
        {
          id: "s2", type: "text_input",
          prompt: "¿Cuál es tu *edad*?",
          fieldKey: "edad", fieldLabel: "Edad", required: true,
          validation: {}, errorMessage: "",
          optionsSource: "custom", customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: []
        },
        {
          id: "s3", type: "select_list",
          prompt: "¿En qué *curso* estás interesado?",
          fieldKey: "curso", fieldLabel: "Curso", required: true,
          validation: {}, errorMessage: "", optionsSource: "programas",
          optionsTitleField: "nombre", optionsDescField: "edad",
          customOptions: [], buttonText: "Ver cursos",
          sourceCollection: "", displayField: "", detailFields: []
        },
        {
          id: "s4", type: "select_list",
          prompt: "¿Qué *instrumento* te gustaría aprender?",
          fieldKey: "instrumento", fieldLabel: "Instrumento", required: true,
          validation: {}, errorMessage: "", optionsSource: "instrumentos",
          optionsTitleField: "nombre", optionsDescField: "",
          customOptions: [], buttonText: "Ver instrumentos",
          sourceCollection: "", displayField: "", detailFields: []
        }
      ],
      completionMessage: "*¡Inscripción completada!* ✅\n\n*Nombre:* {nombre}\n*Edad:* {edad}\n*Curso:* {curso}\n*Instrumento:* {instrumento}\n\nGracias por tu interés en *" + ORG_NAME + "*.\nUn maestro te contactará pronto. 🎶",
      createdAt: ts(), updatedAt: ts()
    });

    console.log("   2 flujos: Ver Programas (browse), Inscríbete (registro)\n");

    // ==================== MENU ====================

    // 10. Menu config
    console.log("10. Configuración del menú...");
    const flowsSnap = await orgRef.collection("flows").get();
    const flowDocs = flowsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const browseFlow = flowDocs.find(f => f.name === "Ver Programas");
    const regFlow = flowDocs.find(f => f.name === "Inscríbete");

    await orgRef.collection("config").doc("menu").set({
      greeting: `¡Hola{name}! 🎵\n\nBienvenido a *${ORG_NAME}*.\n\n¿En qué podemos ayudarte?`,
      menuButtonText: "Ver opciones",
      fallbackMessage: "No entendí tu mensaje. Selecciona una opción del menú.",
      exitMessage: "¡Hasta luego! Escribe *hola* cuando necesites ayuda. 🎶",
      items: [
        { id: "m1", type: "flow", flowId: browseFlow?.id || "", label: "Programas", description: "Ver cursos disponibles", order: 1, active: true },
        { id: "m2", type: "flow", flowId: regFlow?.id || "", label: "Inscríbete", description: "Registra tus datos", order: 2, active: true },
        { id: "m3", type: "builtin", action: "schedule", label: "Horarios", description: "Horarios de atención", order: 3, active: true },
        { id: "m4", type: "builtin", action: "contact", label: "Ubicación", description: "Dirección del instituto", order: 4, active: true },
        { id: "m5", type: "builtin", action: "general", label: "Info General", description: "Sobre el instituto", order: 5, active: true }
      ],
      createdAt: ts()
    });

    // ==================== BOT MESSAGES ====================

    // 11. Bot messages
    console.log("11. Mensajes del bot...");
    const botMessages = [
      { key: "greeting", label: "Saludo principal", category: "greeting", description: "Mensaje de bienvenida", content: `¡Hola{name}! 🎵\n\nBienvenido a *${ORG_NAME}*.\n\nSelecciona una opción del menú.` },
      { key: "fallback", label: "Mensaje no reconocido", category: "fallback", description: "Cuando el bot no entiende", content: "No entendí tu mensaje.\n\nEscribe *hola* para ver el menú de opciones." },
      { key: "goodbye", label: "Despedida", category: "general", description: "Mensaje de despedida", content: "¡Hasta luego! Escribe *hola* cuando necesites ayuda. 🎶" },
      { key: "session_expired", label: "Sesión expirada", category: "general", description: "Sesión cerrada por inactividad", content: "Tu sesión se cerró por inactividad. ¡Hasta luego!\n\nEscribe *hola* cuando necesites ayuda." },
      { key: "cancel", label: "Cancelación", category: "general", description: "Cuando el usuario cancela", content: "Proceso cancelado. Escribe *hola* para volver al menú." }
    ];
    for (const msg of botMessages) {
      await orgRef.collection("botMessages").add({ ...msg, createdAt: ts() });
    }
    console.log(`   ${botMessages.length} mensajes.\n`);

    // ==================== INFO ====================

    // 12. Info
    console.log("12. Información base...");
    await orgRef.collection("info").doc("contact").set({
      address: "8va Av. Norte # 6-3, Colonia Aida, Sonsonate",
      city: "Sonsonate", country: "El Salvador",
      phone: "6930-7473", email: "sonsonate@institutocanzion.com",
      createdAt: ts()
    });
    await orgRef.collection("info").doc("schedule").set({
      days: [
        { name: "Lunes", active: true, shifts: [{ from: "14:00", to: "18:00" }] },
        { name: "Martes", active: true, shifts: [{ from: "14:00", to: "18:00" }] },
        { name: "Miércoles", active: true, shifts: [{ from: "14:00", to: "18:00" }] },
        { name: "Jueves", active: true, shifts: [{ from: "14:00", to: "18:00" }] },
        { name: "Viernes", active: true, shifts: [{ from: "14:00", to: "18:00" }] },
        { name: "Sábado", active: true, shifts: [{ from: "08:00", to: "12:00" }] },
        { name: "Domingo", active: false, shifts: [{ from: "08:00", to: "12:00" }] }
      ],
      createdAt: ts()
    });
    await orgRef.collection("info").doc("general").set({
      orgName: ORG_NAME,
      description: "Escuela de música cristiana con enfoque en adoración y formación musical integral.",
      focus: ["Música", "Adoración", "Formación artística"],
      modality: "Presencial",
      instrumentsNote: "Guitarra, Piano, Batería, Bajo, Canto",
      openToAll: true,
      createdAt: ts()
    });

    // ==================== ADMINS ====================

    // 13. Restore admins
    console.log("13. Restaurando administradores...");
    const adminsSnap = await orgRef.collection("admins").get();
    if (adminsSnap.empty) {
      const usersSnapshot = await db.collection("users").get();
      const orgAdmins = usersSnapshot.docs
        .filter(d => d.data().organizationId === ORG_ID)
        .map(d => ({ uid: d.id, ...d.data() }));

      if (orgAdmins.length > 0) {
        for (const adm of orgAdmins) {
          await orgRef.collection("admins").add({
            email: adm.email, name: adm.name || adm.email,
            role: adm.role || "admin", active: true, createdAt: ts()
          });
        }
        console.log(`   ${orgAdmins.length} admin(s):`);
        orgAdmins.forEach(a => console.log(`     - ${a.email}`));
      } else {
        console.log("   Sin admins encontrados en users/.");
      }
    } else {
      console.log(`   ${adminsSnap.size} admin(s) ya existentes (preservados).`);
    }

    // ==================== SUMMARY ====================

    console.log(`\n========================================`);
    console.log(`  Reset completado`);
    console.log(`========================================\n`);
    console.log(`  Org:           ${ORG_ID}`);
    console.log(`  Nombre:        ${ORG_NAME}`);
    console.log(`  WhatsApp:      ${savedWAConfig?.token ? 'Preservado' : 'Configurar en web'}`);
    console.log(`  Colecciones:   programas, instrumentos, aspirantes`);
    console.log(`  Programas:     Curso Ministerial Musical, Teens, Kids`);
    console.log(`  Instrumentos:  Guitarra, Batería, Bajo, Canto, Piano`);
    console.log(`  Flujos:        Ver Programas, Inscríbete`);
    console.log(`  Menú:          Programas | Inscríbete | Horarios | Ubicación | Info`);
    console.log(`\n  Siguiente: npm start\n`);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

resetDatabase();
