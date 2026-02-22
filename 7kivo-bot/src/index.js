require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { router } = require("./routes/route");
const { startInactivityMonitor } = require("./services/inactivityService");

const PORT = process.env.PORT || 3005;
const app = express();

app.use(express.json());
app.use(cors());
app.use(router);

app.listen(PORT, () => {
  console.log(`✅ 7kivo Bot activo en http://localhost:${PORT}`);
  startInactivityMonitor();
});

