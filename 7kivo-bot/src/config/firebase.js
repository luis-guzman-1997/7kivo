const admin = require("firebase-admin");
require("dotenv").config();

// Inicializar Firebase Admin
if (!admin.apps.length) {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID || "kivo7-app";
    
    // Si hay credenciales de servicio en el archivo de entorno
    if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_SERVICE_ACCOUNT.trim() !== "") {
      try {
        // Intentar parsear como JSON
        let serviceAccount;
        const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
        
        // Si parece ser un objeto JavaScript (no JSON válido), intentar convertirlo
        if (serviceAccountStr.startsWith("{")) {
          try {
            serviceAccount = JSON.parse(serviceAccountStr);
          } catch (e) {
            // Si falla, podría ser un objeto JavaScript sin comillas en las keys
            // Convertir formato objeto JS a JSON válido
            console.warn("⚠️ FIREBASE_SERVICE_ACCOUNT no es JSON válido. Intentando convertir formato objeto JavaScript...");
            let fixedJson = serviceAccountStr
              .replace(/([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '$1"$2":') // Agregar comillas a las keys
              .replace(/:(\s*)([^",\[\]{}]+)(\s*)([,}])/g, ': "$2"$3$4') // Agregar comillas a valores simples
              .replace(/'/g, '"'); // Reemplazar comillas simples por dobles
            
            try {
              serviceAccount = JSON.parse(fixedJson);
            } catch (e2) {
              throw new Error("No se pudo convertir el formato de objeto JavaScript a JSON válido");
            }
          }
        } else {
          throw new Error("FIREBASE_SERVICE_ACCOUNT debe ser un objeto JSON válido");
        }
        
        // Verificar que tenga los campos necesarios para Service Account
        if (serviceAccount.type === "service_account" && serviceAccount.private_key) {
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: projectId
          });
          console.log("✅ Firebase inicializado con Service Account");
        } else {
          // Si no es Service Account, usar solo projectId (las credenciales web no funcionan con Admin SDK)
          console.warn("⚠️ Las credenciales proporcionadas son del SDK web, no de Service Account.");
          console.warn("   Firebase Admin SDK requiere credenciales de Service Account.");
          console.warn("   Inicializando solo con projectId (puede tener limitaciones).");
          admin.initializeApp({
            projectId: projectId
          });
          console.log("✅ Firebase inicializado con projectId únicamente");
        }
      } catch (parseError) {
        console.error("❌ Error al parsear FIREBASE_SERVICE_ACCOUNT:", parseError.message);
        console.warn("⚠️ Inicializando Firebase solo con projectId...");
        admin.initializeApp({
          projectId: projectId
        });
        console.log("✅ Firebase inicializado con configuración básica");
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      const credsVal = process.env.GOOGLE_APPLICATION_CREDENTIALS.trim();
      // Si parece JSON (prod: variable con contenido), usar cert(). Si es ruta de archivo, applicationDefault().
      if (credsVal.startsWith("{")) {
        try {
          const serviceAccount = JSON.parse(credsVal);
          if (serviceAccount.type === "service_account" && serviceAccount.private_key) {
            admin.initializeApp({
              credential: admin.credential.cert(serviceAccount),
              projectId: projectId
            });
            console.log("✅ Firebase inicializado con credenciales desde variable de entorno");
          } else {
            admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
            console.log("✅ Firebase inicializado con Application Default Credentials");
          }
        } catch (e) {
          console.error("❌ GOOGLE_APPLICATION_CREDENTIALS parece JSON pero falló el parse:", e.message);
          throw e;
        }
      } else {
        // Ruta de archivo
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          projectId: projectId
        });
        console.log("✅ Firebase inicializado con Application Default Credentials");
      }
    } else {
      // Inicialización básica - requiere configuración de credenciales
      // Para producción, se recomienda usar service account
      console.warn("⚠️ Advertencia: Firebase se inicializará sin credenciales explícitas.");
      console.warn("   Para funcionalidad completa, configura GOOGLE_APPLICATION_CREDENTIALS o FIREBASE_SERVICE_ACCOUNT");
      admin.initializeApp({
        projectId: projectId
      });
      console.log("✅ Firebase inicializado con configuración básica");
    }
  } catch (error) {
    console.error("❌ Error al inicializar Firebase:", error.message);
    throw error;
  }
}

const db = admin.firestore();

module.exports = { admin, db };

