const { db, admin } = require("./src/config/firebase");
require("dotenv").config();

async function verifyFirebase() {
  console.log("🔍 Verificando configuración de Firebase...\n");
  
  try {
    // Verificar proyecto
    console.log("1️⃣ Verificando proyecto...");
    const projectId = process.env.FIREBASE_PROJECT_ID || "kivo7-app";
    console.log(`   ✅ Proyecto: ${projectId}\n`);
    
    // Verificar credenciales
    console.log("2️⃣ Verificando credenciales...");
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.log(`   ✅ GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.log(`   ✅ FIREBASE_SERVICE_ACCOUNT: Configurado`);
    } else {
      console.log(`   ⚠️  No se encontraron credenciales explícitas`);
    }
    console.log();
    
    // Intentar leer una colección de prueba
    console.log("3️⃣ Verificando acceso a Firestore...");
    try {
      const testRef = db.collection("_test").doc("connection");
      await testRef.set({
        test: true,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log("   ✅ Escritura exitosa - Firestore está accesible\n");
      
      // Limpiar el documento de prueba
      await testRef.delete();
      console.log("   ✅ Documento de prueba eliminado\n");
      
      // Verificar que podemos leer
      console.log("4️⃣ Verificando lectura...");
      const schoolsRef = db.collection("schools");
      const snapshot = await schoolsRef.limit(1).get();
      console.log(`   ✅ Lectura exitosa - Se encontraron ${snapshot.size} documentos en 'schools'\n`);
      
      console.log("✅ TODAS LAS VERIFICACIONES PASARON\n");
      console.log("🎉 Firebase está configurado correctamente!");
      console.log("   Puedes ejecutar: node create-base.js\n");
      
    } catch (error) {
      console.log("   ❌ Error al acceder a Firestore\n");
      
      if (error.code === 7) {
        if (error.message.includes("has not been used") || error.message.includes("disabled")) {
          console.log("   🔴 PROBLEMA: Firestore API no está habilitada");
          console.log("   📋 SOLUCIÓN:");
          console.log("      1. Ve a: https://console.firebase.google.com/project/kivo7-app/firestore");
          console.log("      2. Crea la base de datos si no existe");
          console.log("      3. O habilita la API: https://console.developers.google.com/apis/api/firestore.googleapis.com/overview?project=kivo7-app\n");
        } else if (error.message.includes("Missing or insufficient permissions")) {
          console.log("   🔴 PROBLEMA: Permisos insuficientes");
          console.log("   📋 SOLUCIÓN:");
          console.log("      1. Verifica que Firestore esté creado:");
          console.log("         https://console.firebase.google.com/project/kivo7-app/firestore");
          console.log("      2. Da permisos al Service Account:");
          console.log("         https://console.cloud.google.com/iam-admin/iam?project=kivo7-app");
          console.log("      3. Busca: firebase-adminsdk-fbsvc@kivo7-app.iam.gserviceaccount.com");
          console.log("      4. Agrega roles: 'Cloud Datastore User' y 'Editor'\n");
        } else {
          console.log(`   🔴 Error: ${error.message}\n`);
        }
      } else {
        console.log(`   🔴 Error inesperado: ${error.message}\n`);
        console.log(`   Código: ${error.code || 'N/A'}\n`);
      }
      
      throw error;
    }
    
  } catch (error) {
    console.error("\n❌ VERIFICACIÓN FALLIDA\n");
    console.error("Detalles del error:");
    console.error(error.message);
    if (error.code) {
      console.error(`Código: ${error.code}`);
    }
    process.exit(1);
  }
}

// Ejecutar
verifyFirebase();

