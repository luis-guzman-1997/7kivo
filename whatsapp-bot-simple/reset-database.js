/**
 * Reset Database Script - Multi-tenant Generic Version
 * 
 * Creates or resets an organization in Firestore with default configuration.
 * Usage: node reset-database.js
 * 
 * Set ORG_ID (or SCHOOL_ID for backwards compatibility) in .env
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
const ORG_NAME = process.env.ORG_NAME || "Mi Organización";

console.log(`\n========================================`);
console.log(`  Reset Database - Organization: ${ORG_ID}`);
console.log(`========================================\n`);

const orgRef = db.collection("organizations").doc(ORG_ID);

// ==================== HELPERS ====================

async function deleteCollection(collRef) {
  const snapshot = await collRef.get();
  if (snapshot.empty) return 0;
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  return snapshot.size;
}

async function deleteConversationsDeep() {
  const convsSnapshot = await orgRef.collection("conversations").get();
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
    // 1. Clear existing data
    console.log("1. Limpiando colecciones existentes...");

    const collections = [
      "contacts", "clients", "applicants", "students", "teacherRequests",
      "flows", "botMessages", "programs", "instruments", "courseTypes"
    ];

    for (const col of collections) {
      const count = await deleteCollection(orgRef.collection(col));
      if (count > 0) console.log(`   - ${col}: ${count} docs eliminados`);
    }

    // Config subcollection
    const configDocs = await orgRef.collection("config").get();
    const cb = db.batch();
    configDocs.docs.forEach(d => cb.delete(d.ref));
    await cb.commit();
    console.log(`   - config: ${configDocs.size} docs eliminados`);

    // Info subcollection
    const infoDocs = await orgRef.collection("info").get();
    const ib = db.batch();
    infoDocs.docs.forEach(d => ib.delete(d.ref));
    await ib.commit();
    console.log(`   - info: ${infoDocs.size} docs eliminados`);

    // Conversations (nested)
    const convCount = await deleteConversationsDeep();
    if (convCount > 0) console.log(`   - conversations: ${convCount} docs eliminados`);

    console.log("   Limpieza completada.\n");

    // 2. Create organization document
    console.log("2. Creando organización...");
    await orgRef.set({
      name: ORG_NAME,
      orgId: ORG_ID,
      industry: "general",
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`   Organización "${ORG_NAME}" (${ORG_ID}) creada.\n`);

    // 3. General config
    console.log("3. Creando configuración general...");
    await orgRef.collection("config").doc("general").set({
      orgName: ORG_NAME,
      description: "",
      industry: "general",
      welcomeMessage: `Bienvenido a ${ORG_NAME}`,
      inactivityTimeout: 180000,
      personalWhatsApp: "",
      botApiUrl: "http://localhost:3005",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 4. Menu config
    console.log("4. Creando configuración del menú...");
    await orgRef.collection("config").doc("menu").set({
      greeting: `¡Hola{name}!\n\nBienvenido a *${ORG_NAME}*.\n\nSelecciona una opción:`,
      menuButtonText: "Ver opciones",
      fallbackMessage: "No entendí tu mensaje. Por favor selecciona una opción del menú.",
      exitMessage: "¡Hasta luego! Escribe *hola* cuando necesites ayuda.",
      items: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 5. WhatsApp config (placeholder)
    console.log("5. Creando configuración de WhatsApp (placeholder)...");
    await orgRef.collection("config").doc("whatsapp").set({
      phoneNumberId: process.env.PHONE_NUMBER_WHATSAPP || "",
      token: process.env.TOKEN_META_WHATSAPP || "",
      version: process.env.VERSION_META_WHATSAPP || "v21.0",
      verifyToken: process.env.VERIFY_META_TOKEN || "",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 6. Bot messages
    console.log("6. Creando mensajes del bot...");
    const botMessages = [
      {
        key: "greeting",
        label: "Saludo principal",
        category: "greeting",
        description: "Mensaje de bienvenida al iniciar conversación",
        content: `¡Hola{name}!\n\nBienvenido a *${ORG_NAME}*.\n\nSelecciona una opción del menú.`
      },
      {
        key: "fallback",
        label: "Mensaje no reconocido",
        category: "fallback",
        description: "Cuando el bot no entiende el mensaje",
        content: "No entendí tu mensaje.\n\nEscribe *hola* para ver el menú de opciones."
      },
      {
        key: "goodbye",
        label: "Despedida",
        category: "general",
        description: "Mensaje de despedida",
        content: "¡Hasta luego! Escribe *hola* cuando necesites ayuda."
      },
      {
        key: "session_expired",
        label: "Sesión expirada",
        category: "general",
        description: "Cuando la sesión se cierra por inactividad",
        content: "Tu sesión se cerró por inactividad. ¡Hasta luego!\n\nEscribe *hola* cuando necesites ayuda."
      },
      {
        key: "cancel",
        label: "Cancelación",
        category: "general",
        description: "Cuando el usuario cancela un flujo",
        content: "Proceso cancelado. Escribe *hola* para volver al menú."
      }
    ];

    for (const msg of botMessages) {
      await orgRef.collection("botMessages").add({
        ...msg,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    console.log(`   ${botMessages.length} mensajes creados.\n`);

    // 7. Default flows (generic registration + inquiry)
    console.log("7. Creando flujos predeterminados...");
    
    // Registration flow
    await orgRef.collection("flows").add({
      name: "Registro de Contactos",
      description: "Formulario para registrar nuevos contactos interesados",
      type: "registration",
      active: true,
      order: 1,
      saveToCollection: "contacts",
      menuLabel: "Registrarse",
      menuDescription: "Registrar tus datos",
      showInMenu: true,
      steps: [
        {
          id: "s1",
          type: "text_input",
          field: "fullName",
          label: "Nombre Completo",
          prompt: "Por favor, escribe tu *nombre completo*:",
          required: true,
          order: 1
        },
        {
          id: "s2",
          type: "text_input",
          field: "email",
          label: "Email",
          prompt: "Escribe tu *correo electrónico*:",
          required: false,
          order: 2
        },
        {
          id: "s3",
          type: "text_input",
          field: "comment",
          label: "Comentario",
          prompt: "¿Algún comentario o pregunta? (escribe *no* para omitir):",
          required: false,
          order: 3
        }
      ],
      completionMessage: "*¡Registro completado!*\n\nNombre: {fullName}\nEmail: {email}\n\nGracias por tu interés. Nos pondremos en contacto contigo pronto.",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Inquiry flow
    await orgRef.collection("flows").add({
      name: "Consulta General",
      description: "Para recibir consultas de los usuarios",
      type: "inquiry",
      active: true,
      order: 2,
      saveToCollection: "inquiries",
      menuLabel: "Hacer una consulta",
      menuDescription: "Enviar una pregunta o comentario",
      showInMenu: true,
      steps: [
        {
          id: "s1",
          type: "text_input",
          field: "fullName",
          label: "Nombre",
          prompt: "¿Cuál es tu nombre?",
          required: true,
          order: 1
        },
        {
          id: "s2",
          type: "text_input",
          field: "message",
          label: "Mensaje",
          prompt: "Escribe tu consulta o mensaje:",
          required: true,
          order: 2
        }
      ],
      completionMessage: "*¡Consulta recibida!*\n\nGracias {fullName}, hemos recibido tu mensaje. Te responderemos a la brevedad.",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log("   2 flujos creados (Registro + Consulta).\n");

    // 8. Default info
    console.log("8. Creando información base...");
    await orgRef.collection("info").doc("contact").set({
      address: "",
      city: "",
      country: "",
      phone: "",
      email: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await orgRef.collection("info").doc("schedule").set({
      day: "",
      time: "",
      modality: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await orgRef.collection("info").doc("general").set({
      orgName: ORG_NAME,
      description: "",
      focus: [],
      modality: "",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log("   Info de contacto, horario y general creada.\n");

    // 9. Verify existing users (don't touch /users collection - that's managed by the web app)
    console.log("9. Verificando usuarios administradores...");
    const usersSnapshot = await db.collection("users").get();
    const orgAdmins = usersSnapshot.docs
      .filter(d => d.data().organizationId === ORG_ID)
      .map(d => ({ uid: d.id, ...d.data() }));

    if (orgAdmins.length > 0) {
      console.log(`   ${orgAdmins.length} admin(s) existentes encontrados:`);
      orgAdmins.forEach(a => console.log(`     - ${a.email} (${a.role})`));

      // Recreate org admins subcollection
      for (const adm of orgAdmins) {
        await orgRef.collection("admins").add({
          email: adm.email,
          name: adm.name || adm.email,
          role: adm.role || "admin",
          active: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      console.log(`   ${orgAdmins.length} admins re-creados en la organización.\n`);
    } else {
      console.log("   No se encontraron admins para esta organización.");
      console.log("   Crea uno desde la web con 'Crear nueva organización'.\n");
    }

    console.log("========================================");
    console.log("  Base de datos reseteada exitosamente");
    console.log("========================================\n");
    console.log("Próximos pasos:");
    console.log("  1. Si es primera vez, registra tu organización desde la web");
    console.log("  2. Configura las credenciales de WhatsApp en Configuración");
    console.log("  3. Personaliza los flujos y mensajes del bot");
    console.log("  4. Inicia el bot: npm start\n");

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

resetDatabase();
