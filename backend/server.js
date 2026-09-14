try { require("dotenv").config(); } catch { /* dotenv és opcional: sense ell, fes servir variables d'entorn reals */ }
const express = require("express");
const cors = require("cors");

const rentmanRoutes = require("./src/routes/rentman");
const whatsappRoutes = require("./src/routes/whatsapp");
const wa = require("./src/whatsapp");

const app = express();
const PORT = process.env.PORT || 3001;
const rawCorsOrigin = process.env.CORS_ORIGIN || "*";
const corsOrigin = rawCorsOrigin.trim() === "*"
  ? "*"
  : rawCorsOrigin.split(",").map((s) => s.trim());

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.use("/api/rentman", rentmanRoutes);
app.use("/api/whatsapp", whatsappRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Gestor d'errors centralitzat: totes les rutes fan next(err) i acaba aquí.
// Nomes es registra la traca sencera per als errors de veritat (5xx).
// Els 4xx (p. ex. "WhatsApp encara no esta connectat", 409) son estats
// normals de l'aplicacio, no errors del servidor, aixi que nomes se'n
// registra una linia curta per no confondre.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(err);
  } else {
    console.warn(`[${status}] ${req.method} ${req.originalUrl} -> ${err.message}`);
  }
  res.status(status).json({ error: err.message || "Error intern" });
});

app.listen(PORT, () => {
  console.log(`[server] API escoltant a http://localhost:${PORT}`);
});

// Inicialitza la sessió de WhatsApp (mostrarà el QR als logs i a
// GET /api/whatsapp/status fins que sigui escanejat; després es manté
// connectat sol gràcies a LocalAuth).
wa.init();

// NOTA: la neteja de grups antics NO s'executa sola. Es dispara sempre
// manualment des de l'app (botó "Netejar grups antics ara", que crida
// POST /api/whatsapp/cleanup/run) o grup a grup amb "Eliminar grup ara".
