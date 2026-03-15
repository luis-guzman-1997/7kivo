/**
 * Script puntual — Agrega flujo Prematrícula a CanZion Sonsonate
 * NO resetea datos existentes.
 */

require("dotenv").config();
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT_ID || "kivo7-app";
const ORG_ID    = "instituto-canzion-sonsonate";
const ORG_NAME  = "Instituto CanZion Sonsonate";

const credsVal = (
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.FIREBASE_SERVICE_ACCOUNT || ""
).trim();
if (credsVal && credsVal.startsWith("{")) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(credsVal)), projectId });
} else {
  admin.initializeApp({ projectId });
}

const db     = admin.firestore();
const ts     = admin.firestore.FieldValue.serverTimestamp;
const orgRef = db.collection("organizations").doc(ORG_ID);

async function run() {
  console.log("\n========================================");
  console.log("  CanZion — Agregar Prematrícula");
  console.log("========================================\n");

  // 1. Esquema de colección
  console.log("1. Registrando colección 'prematriculas'...");
  await orgRef.collection("_collections").add({
    name: "Prematrículas", slug: "prematriculas",
    description: "Solicitudes de prematrícula recibidas desde el bot",
    displayField: "nombre",
    fields: [
      { key: "nombre",      label: "Nombre completo",   type: "text",   required: true  },
      { key: "edad",        label: "Edad",               type: "text",   required: true  },
      { key: "curso",       label: "Curso de interés",   type: "text",   required: true  },
      { key: "instrumento", label: "Instrumento",        type: "text",   required: true  },
      { key: "phoneNumber", label: "WhatsApp",           type: "text",   required: false, protected: true }
    ],
    createdAt: ts(), updatedAt: ts()
  });
  console.log("   ✓\n");

  // 2. Flujo Prematrícula
  console.log("2. Creando flujo 'Prematrícula'...");
  const sb = {
    required: true, validation: {}, errorMessage: "",
    optionsSource: "custom", optionsTitleField: "", optionsDescField: "",
    customOptions: [], buttonText: "Ver opciones",
    sourceCollection: "", displayField: "", detailFields: [], timeFieldKey: ""
  };

  const flowRef = await orgRef.collection("flows").add({
    name:             "Prematrícula",
    description:      "Registro de interés para el próximo ciclo",
    type:             "registration",
    active:           true,
    order:            4,
    saveToCollection: "prematriculas",
    notifyAdmin:      true,
    menuLabel:        "Prematrícula",
    menuDescription:  "Reserva tu lugar para el próximo ciclo",
    showInMenu:       true,
    steps: [
      {
        ...sb,
        id:           "s1",
        type:         "text_input",
        prompt:
          "🎵 *Prematrícula — Instituto CanZion Sonsonate*\n\n" +
          "Nos alegra tu interés en aprender música con nosotros 😊\n\n" +
          "_Puedes escribir *cancelar* en cualquier momento para salir._\n\n" +
          "¿Cuál es tu *nombre completo*?",
        fieldKey:     "nombre",
        fieldLabel:   "Nombre",
        required:     true,
        validation:   { minLength: 3 },
        errorMessage: "Por favor escribe tu nombre completo (mínimo 3 caracteres)."
      },
      {
        ...sb,
        id:           "s2",
        type:         "text_input",
        prompt:       "¿Cuántos años tienes?",
        fieldKey:     "edad",
        fieldLabel:   "Edad",
        required:     true,
        validation:   { minLength: 1 },
        errorMessage: "Por favor ingresa tu edad."
      },
      {
        ...sb,
        id:                "s3",
        type:              "select_list",
        prompt:            "¿Qué *programa* te interesa?",
        fieldKey:          "curso",
        fieldLabel:        "Curso de interés",
        required:          true,
        optionsSource:     "programas",
        optionsTitleField: "nombre",
        optionsDescField:  "edad",
        buttonText:        "Ver programas"
      },
      {
        ...sb,
        id:                "s4",
        type:              "select_list",
        prompt:            "¿Qué *instrumento* te gustaría aprender?",
        fieldKey:          "instrumento",
        fieldLabel:        "Instrumento",
        required:          true,
        optionsSource:     "instrumentos",
        optionsTitleField: "nombre",
        buttonText:        "Ver instrumentos"
      }
    ],
    completionMessage:
      "✅ *¡Prematrícula registrada!*\n\n" +
      "Gracias, *{nombre}* 🎵\n\n" +
      "*Curso de interés:* {curso}\n" +
      "*Instrumento:* {instrumento}\n\n" +
      "📢 Nuestras clases del ciclo actual *ya iniciaron*, " +
      "pero queremos que formes parte de nuestra familia musical.\n\n" +
      "📅 *Próximo ingreso: Junio 2026*\n\n" +
      "Te contactaremos por este medio para invitarte a una " +
      "*clase de prueba gratuita* antes del inicio. ¡No te la pierdas! 🎶\n\n" +
      `_${ORG_NAME}_`,
    createdAt: ts(), updatedAt: ts()
  });
  console.log(`   ✓ id: ${flowRef.id}\n`);

  // 3. Actualizar menú — insertar en posición 3, correr los demás
  console.log("3. Actualizando menú...");
  const menuRef  = orgRef.collection("config").doc("menu");
  const menuSnap = await menuRef.get();
  const menuData = menuSnap.data();

  // Subir orden de ítems que estaban en posición 3+
  const updatedItems = menuData.items.map(item => {
    if (item.order >= 3) return { ...item, order: item.order + 1 };
    return item;
  });

  updatedItems.push({
    id:          "m8",
    type:        "flow",
    flowId:      flowRef.id,
    label:       "Prematrícula",
    description: "Reserva tu lugar para el próximo ciclo",
    order:       3,
    active:      true
  });

  updatedItems.sort((a, b) => a.order - b.order);
  await menuRef.update({ items: updatedItems });

  console.log("   Menú actualizado:");
  updatedItems.forEach(i => console.log(`   ${i.order}. ${i.label}`));
  console.log();

  console.log("========================================");
  console.log("  Completado ✓");
  console.log("========================================\n");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
