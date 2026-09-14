// main.js — procés principal d'Electron.
//
// A diferència de l'intent amb Flutter, aquí NO cal cap "sidecar": Electron
// JA és Node.js. El backend (Express + whatsapp-web.js) es carrega
// directament en aquest mateix procés amb un simple require(), i la
// finestra només mostra fitxers HTML/CSS/JS locals que hi parlen per
// http://localhost:3001, exactament com feia el frontend web original.

const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const PORT = 3001;

function configureEnv() {
  // Carpeta d'usuari pròpia del sistema operatiu (persisteix entre
  // actualitzacions de l'app): aquí es guarden la sessió de WhatsApp i
  // els vincles projecte↔grup.
  const userData = app.getPath("userData");
  process.env.PORT = String(PORT);
  process.env.DATA_DIR = path.join(userData, "data");
  process.env.WWEBJS_AUTH_DIR = path.join(userData, "wwebjs_auth");
  process.env.CORS_ORIGIN = "*"; // tot queda en local (localhost), no cal restringir
  process.env.CLEANUP_DAYS_AFTER_END = process.env.CLEANUP_DAYS_AFTER_END || "14";
}

function startBackend() {
  // Simplement carregar el mòdul ja arrenca el servidor Express i
  // inicialitza whatsapp-web.js (vegeu backend/server.js).
  require("./backend/server.js");
}

function createWindow() {
  const iconPath = path.join(__dirname, "renderer", "E91.png");
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#0f1420",
    icon: iconPath, // icona de la finestra/barra de tasques durant el desenvolupament
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Els enllaços externs (si mai n'hi ha) s'obren al navegador del
  // sistema, no dins de la finestra de l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  configureEnv();
  startBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // A macOS és habitual deixar l'app viva a la barra fins que l'usuari
  // la tanqui explícitament; a Windows/Linux, tancar la finestra tanca
  // l'app (i amb ella, el backend, perquè viu al mateix procés).
  if (process.platform !== "darwin") app.quit();
});