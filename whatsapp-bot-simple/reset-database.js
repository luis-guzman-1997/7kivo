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

    await orgRef.collection("_collections").add({
      name: "Citas", slug: "citas", description: "Citas agendadas desde el bot",
      displayField: "nombre",
      fields: [
        { key: "nombre", label: "Nombre", type: "text", required: true },
        { key: "edad", label: "Edad", type: "text", required: false },
        { key: "motivo", label: "Motivo", type: "text", required: false },
        { key: "phoneNumber", label: "Teléfono", type: "text", required: true },
        { key: "fecha", label: "Fecha", type: "text", required: true },
        { key: "hora", label: "Hora", type: "text", required: true },
        { key: "_apptDuration", label: "Duración (min)", type: "number", required: false }
      ],
      createdAt: ts(), updatedAt: ts()
    });

    console.log("   4 colecciones: programas, instrumentos, aspirantes, citas\n");

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

    // --- Flow 1: Ver Programas ---
    await orgRef.collection("flows").add({
      name: "Ver Programas", description: "Explora los cursos musicales disponibles",
      type: "catalog", active: true, order: 1, saveToCollection: "",
      menuLabel: "Nuestros Cursos", menuDescription: "Conoce nuestra oferta académica", showInMenu: true,
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
      type: "registration", active: true, order: 2, saveToCollection: "aspirantes",
      menuLabel: "Inscríbete", menuDescription: "Inicia tu proceso de inscripción", showInMenu: true,
      steps: [
        {
          id: "s1", type: "text_input",
          prompt: "🎵 *¡Excelente decisión!*\n\nComencemos con tu pre-inscripción.\n\nEscribe tu *nombre completo*:",
          fieldKey: "nombre", fieldLabel: "Nombre", required: true,
          validation: { minLength: 3 }, errorMessage: "Necesitamos al menos 3 caracteres. Escríbelo de nuevo por favor.",
          optionsSource: "custom", customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: []
        },
        {
          id: "s2", type: "text_input",
          prompt: "Perfecto ✨\n\n¿Cuántos *años* tienes?",
          fieldKey: "edad", fieldLabel: "Edad", required: true,
          validation: {}, errorMessage: "",
          optionsSource: "custom", customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: []
        },
        {
          id: "s3", type: "select_list",
          prompt: "🎯 ¿Qué *programa* te interesa?\n\nElige el curso que más se adapte a ti:",
          fieldKey: "curso", fieldLabel: "Curso", required: true,
          validation: {}, errorMessage: "", optionsSource: "programas",
          optionsTitleField: "nombre", optionsDescField: "edad",
          customOptions: [], buttonText: "Ver programas",
          sourceCollection: "", displayField: "", detailFields: []
        },
        {
          id: "s4", type: "select_list",
          prompt: "🎸 ¿Qué *instrumento* te gustaría aprender?\n\nElige tu favorito:",
          fieldKey: "instrumento", fieldLabel: "Instrumento", required: true,
          validation: {}, errorMessage: "", optionsSource: "instrumentos",
          optionsTitleField: "nombre", optionsDescField: "",
          customOptions: [], buttonText: "Ver instrumentos",
          sourceCollection: "", displayField: "", detailFields: []
        }
      ],
      completionMessage: "🎉 *¡Pre-inscripción completada!*\n\n📋 *Resumen:*\n─────────────\n👤 *Nombre:* {nombre}\n🎂 *Edad:* {edad}\n🎓 *Curso:* {curso}\n🎵 *Instrumento:* {instrumento}\n─────────────\n\nUn miembro de nuestro equipo te contactará pronto para confirmar tu inscripción.\n\n¡Bienvenido a la familia *" + ORG_NAME + "*! 🎶",
      createdAt: ts(), updatedAt: ts()
    });

    // --- Flow 3: Agendar Cita ---
    await orgRef.collection("flows").add({
      name: "Agendar Cita", description: "Reserva una cita presencial",
      type: "appointment", active: true, order: 3, saveToCollection: "citas",
      menuLabel: "Agendar Cita", menuDescription: "Reserva un espacio con nosotros", showInMenu: true,
      steps: [
        {
          id: "s1", type: "text_input",
          prompt: "📅 *Reserva tu Cita*\n\nVamos a agendar un espacio para ti.\n\nPrimero, escribe tu *nombre completo*:",
          fieldKey: "nombre", fieldLabel: "Nombre", required: true,
          validation: { minLength: 3 }, errorMessage: "Necesitamos al menos 3 caracteres. Inténtalo de nuevo.",
          optionsSource: "custom", customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: [], timeFieldKey: ""
        },
        {
          id: "s2", type: "text_input",
          prompt: "¿Cuántos *años* tienes?",
          fieldKey: "edad", fieldLabel: "Edad", required: true,
          validation: {}, errorMessage: "",
          optionsSource: "custom", customOptions: [], buttonText: "",
          sourceCollection: "", displayField: "", detailFields: [], timeFieldKey: ""
        },
        {
          id: "s3", type: "select_list",
          prompt: "📌 ¿Cuál es el *motivo* de tu visita?\n\nEsto nos ayuda a prepararnos para atenderte mejor:",
          fieldKey: "motivo", fieldLabel: "Motivo", required: true,
          validation: {}, errorMessage: "", optionsSource: "custom",
          optionsTitleField: "", optionsDescField: "",
          customOptions: [
            { label: "Conocer los cursos", value: "info_cursos", description: "Quiero información sobre los programas", duration: 20 },
            { label: "Formalizar inscripción", value: "inscripcion", description: "Ya me decidí y quiero inscribirme", duration: 30 },
            { label: "Prueba de nivel", value: "prueba_nivel", description: "Evaluación de conocimiento musical", duration: 45 },
            { label: "Otro motivo", value: "otro", description: "Consulta o trámite general", duration: 15 }
          ],
          buttonText: "Ver motivos",
          sourceCollection: "", displayField: "", detailFields: [], timeFieldKey: ""
        },
        {
          id: "s4", type: "appointment_slot",
          prompt: "📆 Ahora elige el *día* que mejor te convenga:\n\nSolo se muestran días con disponibilidad.",
          fieldKey: "fecha", fieldLabel: "Fecha", required: true,
          timeFieldKey: "hora",
          validation: {}, errorMessage: "", optionsSource: "custom",
          optionsTitleField: "", optionsDescField: "",
          customOptions: [], buttonText: "Ver días",
          sourceCollection: "", displayField: "", detailFields: []
        }
      ],
      completionMessage: "✅ *¡Cita confirmada!*\n\n📋 *Tu reserva:*\n─────────────\n👤 *Nombre:* {nombre}\n🎂 *Edad:* {edad}\n📌 *Motivo:* {motivo}\n📆 *Fecha:* {fecha}\n🕐 *Hora:* {hora}\n─────────────\n\nTe esperamos en *" + ORG_NAME + "*.\n📍 8va Av. Norte # 6-3, Col. Aida, Sonsonate\n\n¿Necesitas cancelar o reagendar? Escríbenos y te ayudamos. 🤝",
      createdAt: ts(), updatedAt: ts()
    });

    console.log("   3 flujos: Ver Programas, Inscríbete, Agendar Cita\n");

    // ==================== MENU ====================

    // 10. Menu config
    console.log("10. Configuración del menú...");
    const flowsSnap = await orgRef.collection("flows").get();
    const flowDocs = flowsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const browseFlow = flowDocs.find(f => f.name === "Ver Programas");
    const regFlow = flowDocs.find(f => f.name === "Inscríbete");
    const apptFlow = flowDocs.find(f => f.name === "Agendar Cita");

    await orgRef.collection("config").doc("menu").set({
      greeting: `¡Hola{name}! 👋🎵\n\nBienvenido a *${ORG_NAME}*\nTu escuela de música en Sonsonate.\n\n¿Cómo podemos ayudarte hoy?`,
      menuButtonText: "Ver opciones",
      fallbackMessage: "🤔 No logré entender tu mensaje.\n\nEscribe *hola* para ver todas las opciones disponibles.",
      exitMessage: "🎶 ¡Hasta pronto!\n\nFue un gusto atenderte. Escribe *hola* cuando quieras volver.\n\n_${ORG_NAME} — Formando adoradores_ 🎵",
      items: [
        { id: "m1", type: "flow", flowId: browseFlow?.id || "", label: "Nuestros Cursos", description: "Conoce nuestra oferta académica", order: 1, active: true },
        { id: "m2", type: "flow", flowId: regFlow?.id || "", label: "Inscríbete", description: "Inicia tu pre-inscripción", order: 2, active: true },
        { id: "m3", type: "flow", flowId: apptFlow?.id || "", label: "Agendar Cita", description: "Reserva un espacio con nosotros", order: 3, active: true },
        { id: "m4", type: "builtin", action: "schedule", label: "Horarios", description: "Días y horarios de atención", order: 4, active: true },
        { id: "m5", type: "builtin", action: "contact", label: "Ubicación", description: "Cómo llegar al instituto", order: 5, active: true },
        { id: "m6", type: "builtin", action: "general", label: "Sobre Nosotros", description: "Conoce nuestra misión", order: 6, active: true }
      ],
      createdAt: ts()
    });

    // ==================== INFO ====================

    // 11. Info
    console.log("11. Información base...");
    await orgRef.collection("info").doc("contact").set({
      address: "8va Av. Norte # 6-3, Colonia Aida, Sonsonate",
      city: "Sonsonate", country: "El Salvador",
      phone: "6930-7473", email: "sonsonate@institutocanzion.com",
      createdAt: ts()
    });
    await orgRef.collection("info").doc("schedule").set({
      days: [
        { name: "Lunes", active: false, shifts: [] },
        { name: "Martes", active: false, shifts: [] },
        { name: "Miércoles", active: false, shifts: [] },
        { name: "Jueves", active: false, shifts: [] },
        { name: "Viernes", active: false, shifts: [] },
        { name: "Sábado", active: true, shifts: [{ from: "08:00", to: "12:00" }] },
        { name: "Domingo", active: false, shifts: [] }
      ],
      slotDuration: 30,
      blockedDates: [],
      createdAt: ts()
    });
    await orgRef.collection("info").doc("general").set({
      orgName: ORG_NAME,
      description: "Escuela de música cristiana con enfoque en adoración y formación musical integral. Formamos músicos con excelencia técnica y pasión por el servicio.",
      focus: ["Formación musical", "Adoración", "Desarrollo artístico integral"],
      modality: "Presencial",
      instrumentsNote: "Guitarra, Piano, Batería, Bajo y Canto",
      openToAll: true,
      createdAt: ts()
    });

    // ==================== ADMINS ====================

    // 12. Restore admins
    console.log("12. Restaurando administradores...");
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
    console.log(`  Colecciones:   programas, instrumentos, aspirantes, citas`);
    console.log(`  Programas:     Curso Ministerial Musical, Teens, Kids`);
    console.log(`  Instrumentos:  Guitarra, Batería, Bajo, Canto, Piano`);
    console.log(`  Flujos:        Ver Programas, Inscríbete, Agendar Cita`);
    console.log(`  Citas:         Flujo dinámico, duración por tipo (15-45 min)`);
    console.log(`  Menú:          Programas | Inscríbete | Cita | Horarios | Ubicación | Info`);
    console.log(`\n  Siguiente: npm start\n`);

  } catch (error) {
    console.error("Error:", error);
  } finally {
    process.exit(0);
  }
}

resetDatabase();
