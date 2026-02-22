/**
 * Reset Database Script - Dynamic Collections Architecture
 * 
 * Creates or resets an organization in Firestore with:
 * - Dynamic collection definitions (_collections/)
 * - Pre-populated data (programas, etc.)
 * - Dynamic flows (browse, registration, inquiry)
 * - Menu configuration
 * - Bot messages
 * - Info (contact, schedule, general)
 * 
 * PRESERVES: WhatsApp credentials and user mappings
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
const ORG_NAME = process.env.ORG_NAME || "Instituto CanZion Sonsonate";
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

    // 2. Clean current org data
    console.log("2. Limpiando datos de la organización...");
    const collectionsToClean = [
      "_collections", "contacts", "clients", "applicants", "students", "teacherRequests",
      "flows", "botMessages", "programs", "instruments", "courseTypes", "admins",
      "inquiries", "programas", "aspirantes", "consultas"
    ];
    for (const col of collectionsToClean) {
      const count = await deleteCollection(orgRef.collection(col));
      if (count > 0) console.log(`   - ${col}: ${count} docs`);
    }
    for (const docName of ["general", "menu", "whatsapp"]) {
      const d = await orgRef.collection("config").doc(docName).get();
      if (d.exists) await d.ref.delete();
    }
    for (const docName of ["contact", "schedule", "general"]) {
      const d = await orgRef.collection("info").doc(docName).get();
      if (d.exists) await d.ref.delete();
    }
    const convCount = await deleteConversationsDeep(orgRef);
    if (convCount > 0) console.log(`   - conversations: ${convCount} docs`);
    console.log("   Limpieza completada.\n");

    // 3. Organization document
    console.log("3. Creando organización...");
    await orgRef.set({
      name: ORG_NAME, orgId: ORG_ID, industry: "educacion", active: true, createdAt: ts()
    });

    // 4. Config: general
    console.log("4. Configuración general...");
    await orgRef.collection("config").doc("general").set({
      orgName: ORG_NAME, description: "Escuela de música y artes",
      industry: "educacion", welcomeMessage: `Bienvenido a ${ORG_NAME}`,
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

    // 6. Collection definitions (_collections/)
    console.log("6. Creando definiciones de colecciones...");

    const programasDefRef = await orgRef.collection("_collections").add({
      name: "Programas", slug: "programas", description: "Programas educativos musicales",
      displayField: "nombre",
      fields: [
        { key: "nombre", label: "Nombre", type: "text", required: true },
        { key: "edad", label: "Rango de Edad", type: "text", required: false },
        { key: "duracion", label: "Duración", type: "text", required: false },
        { key: "enfoque", label: "Enfoque", type: "text", required: false },
        { key: "notaEdad", label: "Nota de Edad", type: "text", required: false },
        { key: "incluye", label: "Incluye", type: "list", required: false },
        { key: "nota", label: "Nota adicional", type: "text", required: false }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    await orgRef.collection("_collections").add({
      name: "Aspirantes", slug: "aspirantes", description: "Personas interesadas en estudiar",
      displayField: "fullName",
      fields: [
        { key: "fullName", label: "Nombre Completo", type: "text", required: true },
        { key: "programa", label: "Programa", type: "reference", refCollection: "programas", required: false },
        { key: "email", label: "Email", type: "text", required: false },
        { key: "comentario", label: "Comentario", type: "text", required: false }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    await orgRef.collection("_collections").add({
      name: "Consultas", slug: "consultas", description: "Consultas y mensajes recibidos",
      displayField: "fullName",
      fields: [
        { key: "fullName", label: "Nombre", type: "text", required: true },
        { key: "message", label: "Mensaje", type: "text", required: true }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    console.log("   3 colecciones definidas: programas, aspirantes, consultas\n");

    // 7. Populate programas
    console.log("7. Populando programas...");
    const programas = [
      {
        nombre: "Programa Kids", edad: "6 a 10 años", duracion: "2 años (4 semestres)",
        enfoque: "Iniciación musical integral para niños",
        notaEdad: "Niños menores de 6 si saben leer y escribir",
        incluye: ["Iniciación musical", "Práctica de instrumento", "Ensambles musicales infantiles"],
        nota: "Programa por instrumento", active: true, order: 1
      },
      {
        nombre: "Programa Teens", edad: "11 a 15 años", duracion: "2 años (4 semestres)",
        enfoque: "Desarrollo musical para adolescentes",
        notaEdad: "",
        incluye: ["Teoría musical", "Instrumento principal", "Ensambles y bandas juveniles"],
        nota: "Programa por instrumento", active: true, order: 2
      },
      {
        nombre: "Programa Adultos", edad: "16 años en adelante", duracion: "2 años (4 semestres)",
        enfoque: "Formación musical completa para adultos",
        notaEdad: "",
        incluye: ["Teoría y armonía", "Instrumento principal", "Ensambles musicales", "Adoración y servicio"],
        nota: "Programa por instrumento", active: true, order: 3
      },
      {
        nombre: "Programa Avanzado", edad: "Graduados de programas base", duracion: "1 año (2 semestres)",
        enfoque: "Especialización y perfeccionamiento musical",
        notaEdad: "Requiere haber completado programa base",
        incluye: ["Técnica avanzada", "Composición y arreglos", "Dirección de ensambles", "Masterclasses"],
        nota: "", active: true, order: 4
      }
    ];
    for (const p of programas) {
      await orgRef.collection("programas").add({ ...p, createdAt: ts(), updatedAt: ts() });
    }
    console.log(`   ${programas.length} programas creados.\n`);

    // 8. Flows
    console.log("8. Creando flujos...");

    const browseFlowRef = await orgRef.collection("flows").add({
      name: "Ver Programas", description: "Navegar y ver detalles de programas disponibles",
      type: "catalog", active: true, order: 1, saveToCollection: "",
      menuLabel: "Programas", menuDescription: "Ver programas disponibles", showInMenu: true,
      steps: [
        {
          id: "s1", type: "browse_collection", prompt: "*Programas Disponibles*\n\nSelecciona un programa para ver detalles:",
          sourceCollection: "programas", displayField: "nombre",
          detailFields: ["nombre", "edad", "duracion", "enfoque", "notaEdad", "incluye", "nota"],
          fieldKey: "", fieldLabel: "", required: false, validation: {},
          errorMessage: "", optionsSource: "", customOptions: [],
          buttonText: "Ver programas"
        }
      ],
      completionMessage: "",
      createdAt: ts(), updatedAt: ts()
    });

    const regFlowRef = await orgRef.collection("flows").add({
      name: "Registro de Aspirantes", description: "Formulario de registro para nuevos aspirantes",
      type: "registration", active: true, order: 2, saveToCollection: "aspirantes",
      menuLabel: "Registrarse", menuDescription: "Registrar tus datos", showInMenu: true,
      steps: [
        {
          id: "s1", type: "text_input", prompt: "Por favor, escribe tu *nombre completo*:",
          fieldKey: "fullName", fieldLabel: "Nombre Completo", required: true,
          validation: { minLength: 3 }, errorMessage: "El nombre debe tener al menos 3 caracteres.",
          optionsSource: "custom", customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: []
        },
        {
          id: "s2", type: "select_list", prompt: "¿En qué programa estás interesado?",
          fieldKey: "programa", fieldLabel: "Programa", required: true,
          validation: {}, errorMessage: "", optionsSource: "programas",
          customOptions: [], buttonText: "Ver programas",
          sourceCollection: "", displayField: "", detailFields: []
        },
        {
          id: "s3", type: "text_input", prompt: "Escribe tu *correo electrónico* (o escribe *no* para omitir):",
          fieldKey: "email", fieldLabel: "Email", required: false,
          validation: {}, errorMessage: "", optionsSource: "custom",
          customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: []
        },
        {
          id: "s4", type: "text_input", prompt: "¿Algún comentario o pregunta? (escribe *no* para omitir):",
          fieldKey: "comentario", fieldLabel: "Comentario", required: false,
          validation: {}, errorMessage: "", optionsSource: "custom",
          customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: []
        }
      ],
      completionMessage: "*¡Registro completado!*\n\nNombre: {fullName}\nPrograma: {programa}\nEmail: {email}\n\nGracias por tu interés en *" + ORG_NAME + "*. Un maestro te contactará pronto.",
      createdAt: ts(), updatedAt: ts()
    });

    const consultaFlowRef = await orgRef.collection("flows").add({
      name: "Consulta General", description: "Para recibir consultas de los usuarios",
      type: "inquiry", active: true, order: 3, saveToCollection: "consultas",
      menuLabel: "Hacer una consulta", menuDescription: "Enviar pregunta o comentario", showInMenu: true,
      steps: [
        {
          id: "s1", type: "text_input", prompt: "¿Cuál es tu nombre?",
          fieldKey: "fullName", fieldLabel: "Nombre", required: true,
          validation: {}, errorMessage: "", optionsSource: "custom",
          customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: []
        },
        {
          id: "s2", type: "text_input", prompt: "Escribe tu consulta o mensaje:",
          fieldKey: "message", fieldLabel: "Mensaje", required: true,
          validation: {}, errorMessage: "", optionsSource: "custom",
          customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: []
        }
      ],
      completionMessage: "*¡Consulta recibida!*\n\nGracias {fullName}, hemos recibido tu mensaje. Te responderemos a la brevedad.",
      createdAt: ts(), updatedAt: ts()
    });

    console.log("   3 flujos: Ver Programas (browse), Registro (form), Consulta (form)\n");

    // 9. Menu config
    console.log("9. Configuración del menú...");
    // Need the flow IDs for menu items
    const flowsSnap = await orgRef.collection("flows").get();
    const flowDocs = flowsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const browseFlow = flowDocs.find(f => f.name === "Ver Programas");
    const regFlow = flowDocs.find(f => f.name === "Registro de Aspirantes");
    const consultaFlow = flowDocs.find(f => f.name === "Consulta General");

    await orgRef.collection("config").doc("menu").set({
      greeting: `¡Hola{name}!\n\nBienvenido a *${ORG_NAME}*.\n\n¿En qué podemos ayudarte?`,
      menuButtonText: "Ver opciones",
      fallbackMessage: "No entendí tu mensaje. Selecciona una opción del menú.",
      exitMessage: "¡Hasta luego! Escribe *hola* cuando necesites ayuda.",
      items: [
        { id: "m1", type: "flow", flowId: browseFlow?.id || "", label: "Programas", description: "Ver programas disponibles", order: 1, active: true },
        { id: "m2", type: "builtin", action: "schedule", label: "Horarios", description: "Días y horarios de clase", order: 2, active: true },
        { id: "m3", type: "builtin", action: "contact", label: "Ubicación", description: "Dirección del instituto", order: 3, active: true },
        { id: "m4", type: "builtin", action: "general", label: "Información General", description: "Sobre el instituto", order: 4, active: true },
        { id: "m5", type: "flow", flowId: regFlow?.id || "", label: "Registrarse", description: "Registrar datos como aspirante", order: 5, active: true },
        { id: "m6", type: "flow", flowId: consultaFlow?.id || "", label: "Hacer Consulta", description: "Enviar pregunta o mensaje", order: 6, active: true }
      ],
      createdAt: ts()
    });

    // 10. Bot messages
    console.log("10. Mensajes del bot...");
    const botMessages = [
      { key: "greeting", label: "Saludo principal", category: "greeting", description: "Mensaje de bienvenida", content: `¡Hola{name}!\n\nBienvenido a *${ORG_NAME}*.\n\nSelecciona una opción del menú.` },
      { key: "fallback", label: "Mensaje no reconocido", category: "fallback", description: "Cuando el bot no entiende", content: "No entendí tu mensaje.\n\nEscribe *hola* para ver el menú de opciones." },
      { key: "goodbye", label: "Despedida", category: "general", description: "Mensaje de despedida", content: "¡Hasta luego! Escribe *hola* cuando necesites ayuda." },
      { key: "session_expired", label: "Sesión expirada", category: "general", description: "Sesión cerrada por inactividad", content: "Tu sesión se cerró por inactividad. ¡Hasta luego!\n\nEscribe *hola* cuando necesites ayuda." },
      { key: "cancel", label: "Cancelación", category: "general", description: "Cuando el usuario cancela", content: "Proceso cancelado. Escribe *hola* para volver al menú." }
    ];
    for (const msg of botMessages) {
      await orgRef.collection("botMessages").add({ ...msg, createdAt: ts() });
    }
    console.log(`   ${botMessages.length} mensajes.\n`);

    // 11. Info
    console.log("11. Información base...");
    await orgRef.collection("info").doc("contact").set({
      address: "Colonia La Esperanza, Sonsonate", city: "Sonsonate", country: "El Salvador",
      phone: "", email: "", attentionHours: "Lunes a Viernes 2:00 PM - 6:00 PM",
      createdAt: ts()
    });
    await orgRef.collection("info").doc("schedule").set({
      day: "Sábados", time: "8:00 AM a 12:00 PM",
      appliesTo: ["Todos los programas"], modality: "Presencial",
      createdAt: ts()
    });
    await orgRef.collection("info").doc("general").set({
      orgName: ORG_NAME, description: "Escuela de música con enfoque en adoración y formación musical integral.",
      focus: ["Música", "Adoración", "Formación artística"], modality: "Presencial",
      instrumentsNote: "Guitarra, Piano, Batería, Bajo, Violín, Voz y más",
      openToAll: true, createdAt: ts()
    });

    // 12. Restore admins
    console.log("12. Restaurando administradores...");
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
      console.log("   Sin admins. Crea uno desde la web.");
    }

    console.log(`\n========================================`);
    console.log(`  Reset completado`);
    console.log(`========================================\n`);
    console.log(`  Org:          ${ORG_ID}`);
    console.log(`  WhatsApp:     ${savedWAConfig?.token ? 'Preservado' : 'Configurar en web'}`);
    console.log(`  Colecciones:  programas, aspirantes, consultas`);
    console.log(`  Flujos:       Ver Programas, Registro, Consulta`);
    console.log(`  Admins:       ${orgAdmins.length}`);
    console.log(`\n  Siguiente: npm start\n`);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

resetDatabase();
