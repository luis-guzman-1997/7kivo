/**
 * Script para crear flujos dinámicos y configuración del menú en Firestore.
 * Ejecutar: node create-flows.js
 *
 * Esto crea:
 * 1. Flujo de registro de estudiantes (equivalente al flujo hardcoded anterior)
 * 2. Flujo de "Hablar con un Maestro"
 * 3. Configuración del menú principal del bot
 */

require("dotenv").config();
const admin = require("firebase-admin");

const serviceAccount = require("./kivo7.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || "kivo7-app",
  });
}

const db = admin.firestore();
const SCHOOL_ID = process.env.SCHOOL_ID || "sonsonate";

async function createFlows() {
  console.log("=== Creando flujos dinámicos ===\n");
  const schoolRef = db.collection("schools").doc(SCHOOL_ID);

  // Eliminar flujos existentes para evitar duplicados
  const existingFlows = await schoolRef.collection("flows").get();
  if (!existingFlows.empty) {
    const batch = db.batch();
    existingFlows.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`Eliminados ${existingFlows.size} flujos existentes\n`);
  }

  // ==================== FLOW 1: Registration ====================
  const registrationFlow = {
    name: "Registro de Estudiantes",
    description: "Flujo para inscripción de nuevos estudiantes al instituto",
    menuLabel: "Registrarse",
    menuDescription: "Inscripción a programas",
    type: "registration",
    active: true,
    order: 1,
    steps: [
      {
        id: "step_name",
        type: "text_input",
        prompt: "¡Perfecto! Vamos a registrarte.\n\n¿Cuál es tu *nombre completo*?",
        fieldKey: "fullName",
        fieldLabel: "Nombre Completo",
        required: true,
        validation: { minLength: 3 },
        errorMessage: "Nombre inválido. Escribe tu nombre completo (mínimo 3 caracteres).",
        optionsSource: "",
        customOptions: [],
        buttonText: ""
      },
      {
        id: "step_age",
        type: "number_input",
        prompt: "¿Cuántos *años* tienes?",
        fieldKey: "age",
        fieldLabel: "Edad",
        required: true,
        validation: { min: 1, max: 100 },
        errorMessage: "Edad inválida. Escribe un número entre 1 y 100.",
        optionsSource: "",
        customOptions: [],
        buttonText: ""
      },
      {
        id: "step_course",
        type: "select_list",
        prompt: "¿Qué *tipo de curso* te interesa?",
        fieldKey: "courseType",
        fieldLabel: "Tipo de Curso",
        required: true,
        validation: {},
        errorMessage: "",
        optionsSource: "courseTypes",
        customOptions: [],
        buttonText: "Ver cursos"
      },
      {
        id: "step_instrument",
        type: "select_list",
        prompt: "¿Qué *instrumento* te gustaría aprender?",
        fieldKey: "instrument",
        fieldLabel: "Instrumento",
        required: true,
        validation: {},
        errorMessage: "",
        optionsSource: "instruments",
        customOptions: [],
        buttonText: "Ver instrumentos"
      }
    ],
    completionMessage: "*REGISTRO COMPLETADO* ✅\n\n*NOMBRE:*\n{fullName}\n\n*EDAD:*\n{age} AÑOS\n\n*CURSO:*\n{courseType}\n\n*INSTRUMENTO:*\n{instrument}\n\n*CONTACTO:*\n{phoneNumber}\n\nGracias por tu interés. Un maestro se pondrá en contacto contigo pronto.",
    saveToCollection: "applicants",
    notifyAdmin: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const regRef = await schoolRef.collection("flows").add(registrationFlow);
  console.log(`✅ Flujo "Registro de Estudiantes" creado: ${regRef.id}`);

  // ==================== FLOW 2: Talk to Teacher ====================
  const teacherFlow = {
    name: "Hablar con un Maestro",
    description: "Permite al usuario enviar un comentario o consulta para que un maestro lo contacte",
    menuLabel: "Hablar con Maestro",
    menuDescription: "Envía tu consulta a un profesor",
    type: "inquiry",
    active: true,
    order: 2,
    steps: [
      {
        id: "step_name",
        type: "text_input",
        prompt: "¿Cuál es tu *nombre*?",
        fieldKey: "name",
        fieldLabel: "Nombre",
        required: true,
        validation: { minLength: 2 },
        errorMessage: "Escribe tu nombre, por favor.",
        optionsSource: "",
        customOptions: [],
        buttonText: ""
      },
      {
        id: "step_comment",
        type: "text_input",
        prompt: "Escribe tu *comentario o consulta* para el maestro:",
        fieldKey: "comment",
        fieldLabel: "Comentario",
        required: true,
        validation: { minLength: 5 },
        errorMessage: "Tu mensaje es muy corto. Escribe un poco más.",
        optionsSource: "",
        customOptions: [],
        buttonText: ""
      }
    ],
    completionMessage: "¡Gracias, *{name}*! 🙏\n\nHemos recibido tu mensaje:\n_\"{comment}\"_\n\nEn unos minutos un maestro se pondrá en contacto contigo al número {phoneNumber}.",
    saveToCollection: "teacherRequests",
    notifyAdmin: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const teacherRef = await schoolRef.collection("flows").add(teacherFlow);
  console.log(`✅ Flujo "Hablar con un Maestro" creado: ${teacherRef.id}`);

  // ==================== MENU CONFIG ====================
  console.log("\n=== Creando configuración del menú ===\n");

  // El .set() sobreescribe el documento completo, no duplica

  const menuConfig = {
    greeting: "¡Hola{name}! 👋\n\nBienvenido al *Instituto CanZion Sonsonate* 🎵\n\nSelecciona una opción para comenzar:",
    menuButtonText: "Ver opciones",
    fallbackMessage: "No entendí tu mensaje. Selecciona una opción del menú:",
    items: [
      {
        id: "item_programs",
        type: "builtin",
        action: "programs",
        label: "Programas",
        description: "Ver programas disponibles",
        order: 1,
        active: true
      },
      {
        id: "item_schedule",
        type: "builtin",
        action: "schedule",
        label: "Horarios",
        description: "Ver horarios de clases",
        order: 2,
        active: true
      },
      {
        id: "item_contact",
        type: "builtin",
        action: "contact",
        label: "Contacto",
        description: "Ubicación y teléfono",
        order: 3,
        active: true
      },
      {
        id: "item_register",
        type: "flow",
        flowId: regRef.id,
        label: "Registrarse",
        description: "Inscripción a programas",
        order: 4,
        active: true
      },
      {
        id: "item_teacher",
        type: "flow",
        flowId: teacherRef.id,
        label: "Hablar con Maestro",
        description: "Envía tu consulta",
        order: 5,
        active: true
      },
      {
        id: "item_general",
        type: "builtin",
        action: "general",
        label: "Información General",
        description: "Sobre el instituto",
        order: 6,
        active: true
      }
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  await schoolRef.collection("config").doc("menu").set(menuConfig);
  console.log("✅ Configuración del menú creada");

  console.log("\n=== ¡Listo! ===");
  console.log("\nFlujos creados:");
  console.log(`  - Registro de Estudiantes (ID: ${regRef.id})`);
  console.log(`  - Hablar con un Maestro (ID: ${teacherRef.id})`);
  console.log("\nPuedes gestionar estos flujos desde el panel admin en:");
  console.log("  /admin/flujos");
  console.log("\nEl menú del bot ahora es completamente dinámico.");
  console.log("Edita el saludo, opciones y flujos desde el constructor de flujos.\n");
}

createFlows()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Error:", err);
    process.exit(1);
  });
