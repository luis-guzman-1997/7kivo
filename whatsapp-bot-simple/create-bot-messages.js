const { db, admin } = require("./src/config/firebase");
require("dotenv").config();
const { getSchoolId } = require("./src/config/schoolConfig");

async function createBotMessages() {
  try {
    const schoolId = getSchoolId();
    const schoolRef = db.collection("schools").doc(schoolId);

    console.log(`\nCreando mensajes del bot para: ${schoolId}\n`);

    const existing = await schoolRef.collection("botMessages").get();
    if (!existing.empty) {
      const batch = db.batch();
      existing.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      console.log(`Eliminados ${existing.size} mensajes existentes\n`);
    }

    // Solo mensajes genéricos que el bot usa como fallback.
    // Los mensajes de flujos (registro, consultas, etc.) ahora se definen
    // directamente en cada flujo desde el panel admin (/admin/flujos).
    const messages = [
      {
        key: "greeting",
        label: "Saludo de Bienvenida (fallback)",
        category: "greeting",
        description: "Fallback si no hay config de menú. Usa {name} para el nombre.",
        content: "¡Hola{name}!\n\nBienvenido al *Instituto CanZion Sonsonate*.\n\nSelecciona una opción:"
      },
      {
        key: "menu_button_text",
        label: "Texto del Botón de Menú (fallback)",
        category: "greeting",
        description: "Fallback si no hay config de menú.",
        content: "Ver opciones"
      },
      {
        key: "fallback",
        label: "Mensaje por Defecto (fallback)",
        category: "fallback",
        description: "Fallback si no hay config de menú. Cuando el usuario escribe algo no reconocido.",
        content: "No estoy seguro de qué necesitas. Selecciona una opción:"
      },
      {
        key: "option_not_recognized",
        label: "Opción No Reconocida",
        category: "fallback",
        description: "Cuando se selecciona una opción interactiva inválida.",
        content: "Opción no reconocida. Selecciona una opción del menú."
      },
      {
        key: "programs_menu",
        label: "Menú de Programas",
        category: "programs",
        description: "Mensaje antes de mostrar la lista de programas.",
        content: "*Programas Disponibles*\n\nSelecciona un programa:"
      },
      {
        key: "flow_timeout",
        label: "Tiempo Expirado en Flujo",
        category: "flows",
        description: "Cuando se excede el tiempo en un flujo dinámico.",
        content: "El tiempo del proceso expiró. Escribe *menu* para volver al menú principal."
      },
      {
        key: "flow_cancelled",
        label: "Flujo Cancelado",
        category: "flows",
        description: "Cuando el usuario cancela un flujo escribiendo 'cancelar'.",
        content: "Proceso cancelado. Volviendo al menú principal."
      },
      {
        key: "no_registration",
        label: "Registro No Disponible",
        category: "flows",
        description: "Cuando no hay flujo de registro configurado.",
        content: "El registro no está disponible en este momento. Contacta con la administración."
      }
    ];

    for (const msg of messages) {
      await schoolRef.collection("botMessages").add({
        ...msg,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    console.log(`${messages.length} mensajes del bot creados exitosamente\n`);

    // ========== ADMIN INICIAL ==========
    console.log("Verificando administrador inicial...\n");

    const adminsRef = db.collection("admins");
    const existingAdmins = await adminsRef.get();

    if (existingAdmins.empty) {
      await adminsRef.add({
        name: "Administrador Principal",
        email: "admin@canzion.com",
        role: "superadmin",
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      console.log("Admin inicial creado: admin@canzion.com");
      console.log("IMPORTANTE: Crea este usuario en Firebase Authentication\n");
    } else {
      console.log(`Ya existen ${existingAdmins.size} administradores.\n`);
    }

    console.log("=== Proceso completado ===");
    console.log("\nNOTA: Los mensajes de registro ya NO se crean aquí.");
    console.log("Ahora se configuran desde los flujos dinámicos.");
    console.log("Ejecuta: node create-flows.js  para crear los flujos.\n");

  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

createBotMessages();
