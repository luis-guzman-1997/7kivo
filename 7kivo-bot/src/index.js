require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { router } = require("./routes/route");
const { startInactivityMonitor } = require("./services/inactivityService");
const { startCampaignScheduler } = require("./services/campaignService");
const { startUnattendedScheduler } = require("./services/unattendedService");
const { rehydrateAll } = require("./connector/sessionManager");

const PORT = process.env.PORT || 3005;
const app = express();

app.use(express.json());
app.use(cors());
app.use(router);

const LOCAL_DEV = process.env.LOCAL_DEV === "true" || process.env.LOCAL_DEV === "1";

app.listen(PORT, () => {
  console.log(`✅ 7kivo Bot activo en http://localhost:${PORT}`);
  if (LOCAL_DEV) {
    // Modo local seguro: NO tocar el WhatsApp de producción.
    // - No se rehidratan sesiones de conector (evita pelear la sesión con Railway → churn 440 → baneo).
    // - No corren los jobs que ENVÍAN mensajes (campañas, inactividad, no-atendidas).
    // El servidor HTTP sí queda arriba para probar endpoints/panel en local.
    console.log("🧪 LOCAL_DEV activo: sin conector ni jobs de fondo. No se envía nada a producción.");
    return;
  }
  startInactivityMonitor();
  startCampaignScheduler();
  startUnattendedScheduler();
  // Reconecta las sesiones conector (Baileys) persistidas en Firestore.
  rehydrateAll();
});

