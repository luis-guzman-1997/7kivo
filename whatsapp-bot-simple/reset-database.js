/**
 * RESET COMPLETO DE BASE DE DATOS
 * Limpia todas las colecciones y reinicia con datos frescos.
 * Ejecutar: node reset-database.js
 */

require("dotenv").config();
const admin = require("firebase-admin");

const serviceAccountPath = "./kivo7.json";
let serviceAccount;
try {
  serviceAccount = require(serviceAccountPath);
} catch (e) {
  console.error("No se encontró el archivo kivo7.json. Usando Application Default Credentials.");
  serviceAccount = null;
}

if (!admin.apps.length) {
  const config = { projectId: process.env.FIREBASE_PROJECT_ID || "kivo7-app" };
  if (serviceAccount) {
    config.credential = admin.credential.cert(serviceAccount);
  } else {
    config.credential = admin.credential.applicationDefault();
  }
  admin.initializeApp(config);
}

const db = admin.firestore();
const SCHOOL_ID = process.env.SCHOOL_ID || "sonsonate";

async function deleteCollection(collectionRef, batchSize = 100) {
  const snapshot = await collectionRef.limit(batchSize).get();
  if (snapshot.empty) return 0;

  let count = snapshot.size;
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();

  count += await deleteCollection(collectionRef, batchSize);
  return count;
}

async function deleteConversationsDeep(schoolRef) {
  const convsSnap = await schoolRef.collection("conversations").get();
  let total = 0;

  for (const convDoc of convsSnap.docs) {
    const msgsCount = await deleteCollection(convDoc.ref.collection("messages"));
    total += msgsCount;
    await convDoc.ref.delete();
    total++;
  }
  return total;
}

async function resetDatabase() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   RESET COMPLETO - Instituto CanZion Bot    ║");
  console.log("╚══════════════════════════════════════════════╝\n");
  console.log(`Escuela: ${SCHOOL_ID}`);
  console.log(`Proyecto: ${process.env.FIREBASE_PROJECT_ID || "kivo7-app"}\n`);

  const schoolRef = db.collection("schools").doc(SCHOOL_ID);

  // ============================================================
  // PASO 1: LIMPIAR TODO
  // ============================================================
  console.log("━━━ PASO 1: Limpiando base de datos ━━━\n");

  const simpleCollections = [
    "instruments",
    "courseTypes",
    "programs",
    "config",
    "info",
    "botMessages",
    "flows",
    "applicants",
    "students",
    "teacherRequests",
  ];

  for (const name of simpleCollections) {
    try {
      const count = await deleteCollection(schoolRef.collection(name));
      if (count > 0) console.log(`   Eliminada: ${name} (${count} docs)`);
      else console.log(`   Limpia:    ${name}`);
    } catch (err) {
      console.log(`   Saltada:   ${name} (${err.message})`);
    }
  }

  // Conversations (tiene subcollección messages)
  try {
    const count = await deleteConversationsDeep(schoolRef);
    if (count > 0) console.log(`   Eliminada: conversations (${count} docs + mensajes)`);
    else console.log(`   Limpia:    conversations`);
  } catch (err) {
    console.log(`   Saltada:   conversations (${err.message})`);
  }

  console.log("\n   Base de datos limpia.\n");

  // ============================================================
  // PASO 2: CREAR ESCUELA
  // ============================================================
  console.log("━━━ PASO 2: Creando escuela ━━━\n");

  await schoolRef.set({
    id: SCHOOL_ID,
    name: "Instituto CanZion Sonsonate",
    active: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log("   Escuela creada: Instituto CanZion Sonsonate\n");

  // ============================================================
  // PASO 3: CONFIGURACIÓN GENERAL
  // ============================================================
  console.log("━━━ PASO 3: Configuración general ━━━\n");

  await schoolRef.collection("config").doc("general").set({
    schoolName: "Instituto CanZion Sonsonate",
    welcomeMessage: "Bienvenido al Instituto CanZion Sonsonate.",
    registrationTimeout: 180000,
    inactivityTimeout: 180000,
    personalWhatsApp: "",
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log("   Config general creada\n");

  // ============================================================
  // PASO 4: INSTRUMENTOS
  // ============================================================
  console.log("━━━ PASO 4: Instrumentos ━━━\n");

  const instruments = [
    { name: "Guitarra", description: "Guitarra acústica y eléctrica", active: true, order: 1 },
    { name: "Piano", description: "Piano y teclado", active: true, order: 2 },
    { name: "Batería", description: "Batería completa", active: true, order: 3 },
    { name: "Bajo", description: "Bajo eléctrico", active: true, order: 4 },
    { name: "Canto", description: "Canto y técnica vocal", active: true, order: 5 }
  ];

  for (const item of instruments) {
    await schoolRef.collection("instruments").add({
      ...item,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  console.log(`   ${instruments.length} instrumentos creados\n`);

  // ============================================================
  // PASO 5: TIPOS DE CURSO
  // ============================================================
  console.log("━━━ PASO 5: Tipos de curso ━━━\n");

  const courseTypes = [
    { name: "Kids", description: "Programa para niños de 6 a 10 años", active: true, order: 1 },
    { name: "Teens/Pre-Teens", description: "Programa para adolescentes de 9 a 15 años", active: true, order: 2 },
    { name: "Curso Ministerial", description: "Formación ministerial musical para 16+ años", active: true, order: 3 },
    { name: "Instrumento", description: "Curso especializado de instrumento", active: true, order: 4 }
  ];

  for (const item of courseTypes) {
    await schoolRef.collection("courseTypes").add({
      ...item,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  console.log(`   ${courseTypes.length} tipos de curso creados\n`);

  // ============================================================
  // PASO 6: PROGRAMAS
  // ============================================================
  console.log("━━━ PASO 6: Programas ━━━\n");

  const programs = [
    {
      id: "kids",
      name: "Programa Kids",
      age: "6 a 10 años",
      ageNote: "Niños menores si ya saben leer y escribir",
      duration: "2 años (4 semestres)",
      includes: [
        "Iniciación musical infantil",
        "Aprendizaje a través del juego",
        "Práctica de instrumento",
        "Ensambles musicales",
        "Principios bíblicos"
      ],
      active: true, order: 1
    },
    {
      id: "teens",
      name: "Programa Teens / Pre-Teens",
      age: "Pre-Teens: 9 a 11 años, Teens: 12 a 15 años",
      duration: "2 años (4 semestres)",
      includes: [
        "Formación musical integral",
        "Interpretación de instrumento",
        "Ensambles musicales",
        "Principios bíblicos y adoración"
      ],
      note: "Programa por instrumento (no solo teoría)",
      active: true, order: 2
    },
    {
      id: "ministerial",
      name: "Curso Ministerial Musical",
      age: "16 años en adelante",
      duration: "2 años (4 semestres)",
      includes: [
        "Formación musical y ministerial",
        "Estudio profundo de instrumento",
        "Lenguaje musical",
        "Ensambles",
        "Preparación para liderar en música"
      ],
      focus: "Adoración, vida cristiana y servicio ministerial",
      active: true, order: 3
    }
  ];

  for (const prog of programs) {
    const { id, ...data } = prog;
    await schoolRef.collection("programs").doc(id).set({
      ...data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  console.log(`   ${programs.length} programas creados\n`);

  // ============================================================
  // PASO 7: INFO (horarios, contacto, general)
  // ============================================================
  console.log("━━━ PASO 7: Información del instituto ━━━\n");

  await schoolRef.collection("info").doc("schedule").set({
    day: "Todos los sábados",
    time: "7:00 a.m. a 12:00 m.d.",
    modality: "Presencial",
    appliesTo: ["Kids", "Teens / Pre-Teens", "Curso Ministerial Musical"],
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log("   Horarios creados");

  await schoolRef.collection("info").doc("contact").set({
    address: "8ª Av. Norte #6-3, Colonia Aida",
    city: "Sonsonate",
    country: "El Salvador",
    attentionHours: "Sábados de 7:00 a.m. a 12:00 m.d.",
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log("   Contacto/Ubicación creado");

  await schoolRef.collection("info").doc("general").set({
    schoolName: "Instituto CanZion Sonsonate",
    description: "Escuela de música cristiana",
    focus: ["Formación musical", "Principios bíblicos", "Servicio ministerial"],
    modality: "Presencial",
    instrumentsNote: "Todos los programas incluyen práctica de instrumento.",
    openToAll: true,
    active: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log("   Info general creada\n");

  // ============================================================
  // PASO 8: MENSAJES DEL BOT
  // ============================================================
  console.log("━━━ PASO 8: Mensajes del bot ━━━\n");

  const botMessages = [
    { key: "greeting", label: "Saludo (fallback)", category: "greeting",
      content: "¡Hola{name}!\n\nBienvenido al *Instituto CanZion Sonsonate*.\n\nSelecciona una opción:" },
    { key: "menu_button_text", label: "Botón de Menú (fallback)", category: "greeting",
      content: "Ver opciones" },
    { key: "fallback", label: "Mensaje por Defecto", category: "fallback",
      content: "No estoy seguro de qué necesitas. Selecciona una opción:" },
    { key: "option_not_recognized", label: "Opción No Reconocida", category: "fallback",
      content: "Opción no reconocida. Selecciona una opción del menú." },
    { key: "programs_menu", label: "Menú de Programas", category: "programs",
      content: "*Programas Disponibles*\n\nSelecciona un programa:" },
    { key: "flow_timeout", label: "Tiempo Expirado", category: "flows",
      content: "El tiempo del proceso expiró. Escribe *menu* para volver." },
    { key: "flow_cancelled", label: "Flujo Cancelado", category: "flows",
      content: "Proceso cancelado. ¡Hasta luego! 👋" },
    { key: "flow_cancel_hint", label: "Hint de Cancelación", category: "flows",
      content: "Puedes escribir *cancelar* o *salir* en cualquier momento para detener el proceso.\n" },
    { key: "no_registration", label: "Registro No Disponible", category: "flows",
      content: "El registro no está disponible en este momento." }
  ];

  for (const msg of botMessages) {
    await schoolRef.collection("botMessages").add({
      ...msg,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  console.log(`   ${botMessages.length} mensajes creados\n`);

  // ============================================================
  // PASO 9: FLUJOS DINÁMICOS
  // ============================================================
  console.log("━━━ PASO 9: Flujos del bot ━━━\n");

  const registrationFlow = {
    name: "Registro de Estudiantes",
    description: "Inscripción de nuevos aspirantes al instituto",
    menuLabel: "Registrarse",
    menuDescription: "Inscripción a programas",
    type: "registration",
    active: true,
    order: 1,
    steps: [
      {
        id: "step_name", type: "text_input",
        prompt: "¡Perfecto! Vamos a registrarte.\n\n¿Cuál es tu *nombre completo*?",
        fieldKey: "fullName", fieldLabel: "Nombre Completo",
        required: true, validation: { minLength: 3 },
        errorMessage: "Nombre inválido. Escribe tu nombre completo (mínimo 3 caracteres).",
        optionsSource: "", customOptions: [], buttonText: ""
      },
      {
        id: "step_age", type: "number_input",
        prompt: "¿Cuántos *años* tienes?",
        fieldKey: "age", fieldLabel: "Edad",
        required: true, validation: { min: 1, max: 100 },
        errorMessage: "Edad inválida. Escribe un número entre 1 y 100.",
        optionsSource: "", customOptions: [], buttonText: ""
      },
      {
        id: "step_course", type: "select_list",
        prompt: "¿Qué *tipo de curso* te interesa?",
        fieldKey: "courseType", fieldLabel: "Tipo de Curso",
        required: true, validation: {}, errorMessage: "",
        optionsSource: "courseTypes", customOptions: [], buttonText: "Ver cursos"
      },
      {
        id: "step_instrument", type: "select_list",
        prompt: "¿Qué *instrumento* te gustaría aprender?",
        fieldKey: "instrument", fieldLabel: "Instrumento",
        required: true, validation: {}, errorMessage: "",
        optionsSource: "instruments", customOptions: [], buttonText: "Ver instrumentos"
      }
    ],
    completionMessage: "*REGISTRO COMPLETADO* ✅\n\n*NOMBRE:*\n{fullName}\n\n*EDAD:*\n{age} AÑOS\n\n*CURSO:*\n{courseType}\n\n*INSTRUMENTO:*\n{instrument}\n\n*CONTACTO:*\n{phoneNumber}\n\nGracias por tu interés. Un maestro se pondrá en contacto contigo pronto.",
    saveToCollection: "applicants",
    notifyAdmin: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const regRef = await schoolRef.collection("flows").add(registrationFlow);
  console.log(`   Flujo "Registro de Estudiantes" creado (${regRef.id})`);

  const teacherFlow = {
    name: "Hablar con un Maestro",
    description: "Enviar consulta para que un maestro contacte al usuario",
    menuLabel: "Hablar con Maestro",
    menuDescription: "Envía tu consulta a un profesor",
    type: "inquiry",
    active: true,
    order: 2,
    steps: [
      {
        id: "step_name", type: "text_input",
        prompt: "¿Cuál es tu *nombre*?",
        fieldKey: "name", fieldLabel: "Nombre",
        required: true, validation: { minLength: 2 },
        errorMessage: "Escribe tu nombre, por favor.",
        optionsSource: "", customOptions: [], buttonText: ""
      },
      {
        id: "step_comment", type: "text_input",
        prompt: "Escribe tu *comentario o consulta* para el maestro:",
        fieldKey: "comment", fieldLabel: "Comentario",
        required: true, validation: { minLength: 5 },
        errorMessage: "Tu mensaje es muy corto. Escribe un poco más.",
        optionsSource: "", customOptions: [], buttonText: ""
      }
    ],
    completionMessage: "¡Gracias, *{name}*! 🙏\n\nHemos recibido tu mensaje:\n_\"{comment}\"_\n\nEn unos minutos un maestro se pondrá en contacto contigo al número {phoneNumber}.",
    saveToCollection: "teacherRequests",
    notifyAdmin: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const teacherRef = await schoolRef.collection("flows").add(teacherFlow);
  console.log(`   Flujo "Hablar con un Maestro" creado (${teacherRef.id})\n`);

  // ============================================================
  // PASO 10: MENÚ DEL BOT
  // ============================================================
  console.log("━━━ PASO 10: Menú del bot ━━━\n");

  await schoolRef.collection("config").doc("menu").set({
    greeting: "¡Hola{name}! 👋\n\nBienvenido al *Instituto CanZion Sonsonate* 🎵\n\nSelecciona una opción para comenzar:",
    menuButtonText: "Ver opciones",
    fallbackMessage: "No entendí tu mensaje. Selecciona una opción del menú:",
    items: [
      { id: "item_programs", type: "builtin", action: "programs", label: "Programas", description: "Ver programas disponibles", order: 1, active: true },
      { id: "item_schedule", type: "builtin", action: "schedule", label: "Horarios", description: "Ver horarios de clases", order: 2, active: true },
      { id: "item_contact", type: "builtin", action: "contact", label: "Ubicación", description: "Dirección del instituto", order: 3, active: true },
      { id: "item_register", type: "flow", flowId: regRef.id, label: "Registrarse", description: "Inscripción a programas", order: 4, active: true },
      { id: "item_teacher", type: "flow", flowId: teacherRef.id, label: "Hablar con Maestro", description: "Envía tu consulta", order: 5, active: true },
      { id: "item_general", type: "builtin", action: "general", label: "Información General", description: "Sobre el instituto", order: 6, active: true }
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  console.log("   Menú configurado\n");

  // ============================================================
  // PASO 11: VERIFICAR ADMIN
  // ============================================================
  console.log("━━━ PASO 11: Administrador ━━━\n");

  const adminsSnap = await db.collection("admins").get();
  if (adminsSnap.empty) {
    await db.collection("admins").add({
      name: "Administrador Principal",
      email: "admin@canzion.com",
      role: "superadmin",
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log("   Admin creado: admin@canzion.com");
    console.log("   (Crear este usuario en Firebase Authentication)\n");
  } else {
    console.log(`   ${adminsSnap.size} admin(s) existentes conservados\n`);
  }

  // ============================================================
  // RESUMEN
  // ============================================================
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║           RESET COMPLETADO                  ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log("║                                              ║");
  console.log("║  Colecciones limpiadas:                      ║");
  console.log("║    - conversations (+ mensajes)              ║");
  console.log("║    - applicants, students                    ║");
  console.log("║    - teacherRequests                         ║");
  console.log("║    - flows, botMessages, config              ║");
  console.log("║    - programs, instruments, courseTypes       ║");
  console.log("║    - info                                    ║");
  console.log("║                                              ║");
  console.log("║  Datos recreados:                            ║");
  console.log("║    - 5 instrumentos                          ║");
  console.log("║    - 4 tipos de curso                        ║");
  console.log("║    - 3 programas                             ║");
  console.log("║    - 9 mensajes del bot                      ║");
  console.log("║    - 2 flujos (Registro + Maestro)           ║");
  console.log("║    - Menú del bot configurado                ║");
  console.log("║    - Info: horarios, ubicación, general      ║");
  console.log("║                                              ║");
  console.log("║  Siguiente paso:                             ║");
  console.log("║    Reiniciar el bot: npm run start            ║");
  console.log("║                                              ║");
  console.log("╚══════════════════════════════════════════════╝\n");
}

resetDatabase()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("\nError fatal:", err.message);
    console.error(err.stack);
    process.exit(1);
  });
