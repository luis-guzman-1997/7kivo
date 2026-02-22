const { db, admin } = require("./src/config/firebase");
require("dotenv").config();
const { getSchoolId } = require("./src/config/schoolConfig");

async function deleteCollection(collectionRef, batchSize = 100) {
  const query = collectionRef.limit(batchSize);
  const snapshot = await query.get();
  
  if (snapshot.empty) {
    return;
  }
  
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  
  // Recursivamente eliminar el resto
  return deleteCollection(collectionRef, batchSize);
}

async function createBase() {
  try {
    const schoolId = getSchoolId();
    console.log(`🔥 Inicializando base de datos de Firebase para la escuela: ${schoolId}\n`);
    console.log(`📦 Proyecto: ${process.env.FIREBASE_PROJECT_ID || "kivo7-app"}\n`);
    
    const schoolRef = db.collection("schools").doc(schoolId);
    
    // ==================== ELIMINAR DATOS EXISTENTES ====================
    console.log("🗑️  Eliminando datos existentes...");
    
    const collectionsToDelete = [
      "instruments",
      "courseTypes",
      "students",
      "config",
      "info",
      "programs"
    ];
    
    for (const collectionName of collectionsToDelete) {
      try {
        const collectionRef = schoolRef.collection(collectionName);
        await deleteCollection(collectionRef);
        console.log(`   ✅ Eliminada colección: ${collectionName}`);
      } catch (error) {
        // Si la colección no existe, continuar
        if (error.code !== 5) { // 5 = NOT_FOUND
          console.log(`   ⚠️  Error al eliminar ${collectionName}: ${error.message}`);
        }
      }
    }
    console.log();
    
    // ==================== CREAR/ACTUALIZAR ESCUELA ====================
    console.log("📝 Paso 1/7: Creando/actualizando documento de escuela...");
    const schoolDoc = await schoolRef.get();
    
    const schoolData = {
      id: schoolId,
      name: "Instituto CanZion Sonsonate",
      active: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (!schoolDoc.exists) {
      schoolData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      await schoolRef.set(schoolData);
      console.log(`✅ Escuela creada exitosamente: ${schoolId}`);
      console.log(`   Nombre: ${schoolData.name}`);
      console.log(`   ID: ${schoolId}\n`);
    } else {
      await schoolRef.update(schoolData);
      console.log(`✅ Escuela actualizada: ${schoolId}`);
      console.log(`   Nombre: ${schoolData.name}\n`);
    }

    // ==================== INSTRUMENTOS ====================
    console.log("📝 Paso 2/7: Creando colección de instrumentos...");
    const instruments = [
      { name: "Guitarra", description: "Guitarra acústica y eléctrica", active: true, order: 1 },
      { name: "Piano", description: "Piano y teclado", active: true, order: 2 },
      { name: "Batería", description: "Batería completa", active: true, order: 3 },
      { name: "Bajo", description: "Bajo eléctrico", active: true, order: 4 },
      { name: "Canto", description: "Canto y técnica vocal", active: true, order: 5 }
    ];

    for (const instrument of instruments) {
      await schoolRef.collection("instruments").add({
        ...instrument,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    console.log(`✅ ${instruments.length} instrumentos creados\n`);

    // ==================== TIPOS DE CURSO ====================
    console.log("📝 Paso 3/7: Creando colección de tipos de curso...");
    const courseTypes = [
      { name: "Kids", description: "Programa para niños de 6 a 10 años", active: true, order: 1 },
      { name: "Teens/Pre-Teens", description: "Programa para adolescentes de 9 a 15 años", active: true, order: 2 },
      { name: "Curso Ministerial", description: "Formación ministerial musical para 16+ años", active: true, order: 3 },
      { name: "Instrumento", description: "Curso especializado de instrumento", active: true, order: 4 }
    ];

    for (const courseType of courseTypes) {
      await schoolRef.collection("courseTypes").add({
        ...courseType,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    console.log(`✅ ${courseTypes.length} tipos de curso creados\n`);

    // ==================== CONFIGURACIÓN ====================
    console.log("📝 Paso 4/7: Creando configuración inicial...");
    const config = {
      schoolName: "Instituto CanZion Sonsonate",
      welcomeMessage: "Bienvenido al Instituto CanZion Sonsonate. Soy CanZionBot, tu asistente virtual.",
      registrationTimeout: 180000, // 3 minutos en milisegundos
      active: true
    };

    await schoolRef.collection("config").doc("general").set({
      ...config,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log("✅ Configuración general creada\n");

    // ==================== HORARIOS ====================
    console.log("📝 Paso 5/7: Creando información de horarios...");
    const schedule = {
      day: "Todos los sábados",
      time: "7:00 a.m. a 12:00 m.d.",
      modality: "Presencial",
      appliesTo: ["Kids", "Teens / Pre-Teens", "Curso Ministerial Musical"],
      active: true
    };

    await schoolRef.collection("info").doc("schedule").set({
      ...schedule,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log("✅ Información de horarios creada\n");

    // ==================== CONTACTO ====================
    console.log("📝 Paso 6/7: Creando información de contacto...");
    const contact = {
      address: "8ª Av. Norte #6-3, Colonia Aida",
      city: "Sonsonate",
      country: "El Salvador",
      phone: "+503 6930-7473",
      email: "sonsonate@institutocanzion.com",
      attentionHours: "Sábados de 7:00 a.m. a 12:00 m.d.",
      active: true
    };

    await schoolRef.collection("info").doc("contact").set({
      ...contact,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log("✅ Información de contacto creada\n");

    // ==================== INFORMACIÓN GENERAL ====================
    console.log("📝 Paso 7/7: Creando información general...");
    const generalInfo = {
      schoolName: "Instituto CanZion Sonsonate",
      description: "Escuela de música cristiana",
      focus: [
        "Formación musical",
        "Principios bíblicos",
        "Servicio ministerial"
      ],
      modality: "Presencial",
      instrumentsNote: "Todos los programas incluyen práctica de instrumento. Se define al momento de inscripción.",
      openToAll: true,
      active: true
    };

    await schoolRef.collection("info").doc("general").set({
      ...generalInfo,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log("✅ Información general creada\n");

    // ==================== PROGRAMAS ====================
    console.log("📝 Creando información de programas...");
    
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
        active: true,
        order: 1
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
        active: true,
        order: 2
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
        active: true,
        order: 3
      }
    ];

    for (const program of programs) {
      await schoolRef.collection("programs").doc(program.id).set({
        ...program,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    console.log(`✅ ${programs.length} programas creados\n`);

    // ==================== CREAR ÍNDICES ====================
    console.log("📝 Nota: Asegúrate de crear los siguientes índices en Firestore:\n");
    console.log(`Colección: schools/${schoolId}/instruments`);
    console.log("  - Campo: active (Ascending)");
    console.log("  - Campo: order (Ascending)");
    console.log(`\nColección: schools/${schoolId}/courseTypes`);
    console.log("  - Campo: active (Ascending)");
    console.log("  - Campo: order (Ascending)");
    console.log(`\nColección: schools/${schoolId}/students`);
    console.log("  - Campo: phoneNumber (Ascending)");
    console.log("  - Campo: createdAt (Descending)");

    console.log("\n✅ Base de datos inicializada correctamente!");
    console.log(`\n💡 Puedes agregar más instrumentos y tipos de curso desde la consola de Firebase para la escuela: ${schoolId}`);

  } catch (error) {
    console.error("\n❌ Error al crear la base de datos\n");
    
    // Manejar diferentes tipos de errores
    if (error.code === 7) {
      if (error.message.includes("has not been used") || error.message.includes("disabled")) {
        console.error("🔴 PROBLEMA: La API de Cloud Firestore no está habilitada");
        console.error("\n📋 SOLUCIÓN:");
        console.error("   1. Ve a: https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=kivo7-app");
        console.error("   2. Haz clic en 'HABILITAR' o 'ENABLE'");
        console.error("   3. Espera 1-2 minutos");
        console.error("   4. Vuelve a ejecutar: node create-base.js\n");
      } else if (error.message.includes("Missing or insufficient permissions")) {
        console.error("🔴 PROBLEMA: El Service Account no tiene permisos suficientes");
        console.error("\n📋 SOLUCIÓN PASO A PASO:\n");
        console.error("⚠️  IMPORTANTE: Primero debes crear Firestore desde la consola\n");
        console.error("PASO 1: Crear Firestore Database");
        console.error("   1. Ve a: https://console.firebase.google.com/project/kivo7-app/firestore");
        console.error("   2. Si ves 'Crear base de datos', haz clic");
        console.error("   3. Selecciona 'Modo de prueba' y una ubicación");
        console.error("   4. Haz clic en 'Habilitar'\n");
        console.error("PASO 2: Dar permisos al Service Account");
        console.error("   Opción A - Firebase Console (más fácil):");
        console.error("   1. Ve a: https://console.firebase.google.com/project/kivo7-app/settings/iam");
        console.error("   2. Busca o agrega: firebase-adminsdk-fbsvc@kivo7-app.iam.gserviceaccount.com");
        console.error("   3. Asigna rol 'Editor' o 'Owner'\n");
        console.error("   Opción B - Google Cloud Console:");
        console.error("   1. Ve a: https://console.cloud.google.com/iam-admin/iam?project=kivo7-app");
        console.error("   2. Busca: firebase-adminsdk-fbsvc@kivo7-app.iam.gserviceaccount.com");
        console.error("   3. Agrega roles: 'Cloud Datastore User' y 'Firebase Admin SDK Administrator Service Agent'\n");
        console.error("PASO 3: Espera 2-3 minutos y vuelve a ejecutar: node create-base.js\n");
        console.error("📖 Guía completa en: SOLUCION_PERMISOS.md\n");
      } else {
        console.error("🔴 Error de permisos:", error.message);
        console.error("\nDetalles:", error.details || "Sin detalles adicionales\n");
      }
    } else {
      console.error("🔴 Error:", error.message);
      if (error.stack) {
        console.error("\nStack trace:");
        console.error(error.stack);
      }
    }
    
    process.exit(1);
  } finally {
    // No hacer exit(0) aquí si hubo error
  }
}

// Ejecutar
createBase();

