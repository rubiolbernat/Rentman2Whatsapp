// main.js — procés principal d'Electron.
//
// A diferència de l'intent amb Flutter, aquí NO cal cap "sidecar": Electron
// JA és Node.js. El backend (Express + whatsapp-web.js) es carrega
// directament en aquest mateix procés amb un simple require(), i la
// finestra només mostra fitxers HTML/CSS/JS locals que hi parlen per
// http://localhost:3001, exactament com feia el frontend web original.

const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log/main");
const path = require("path");
const fs = require("fs");

// Registre en fitxer: com que l'app empaquetada NO té cap terminal
// visible, tots els console.log/warn/error (tant d'aquest fitxer com del
// backend, que ja en fa servir) van a parar a un fitxer que es pot obrir
// sempre, encara que l'app no mostri res per pantalla.
// Ubicació típica a Windows: %APPDATA%\Rentman WhatsApp\logs\main.log
log.initialize();
log.transports.file.level = "info";
console.log(`[app] Registre a: ${log.transports.file.getFile().path}`);

const PORT = 3001;

process.on("uncaughtException", (err) => {
  console.error("[app] Excepció no capturada:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[app] Promesa rebutjada sense capturar:", reason);
});

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

// Compara la versió actual amb la que es va desar la darrera vegada que
// l'app es va obrir (a un fitxeret dins de la carpeta d'usuari). Si són
// diferents, vol dir que s'acaba d'instal·lar una actualització.
let updateInfo = { justUpdated: false, version: app.getVersion(), previousVersion: null };
function detectVersionChange() {
  const versionFile = path.join(app.getPath("userData"), "last-version.txt");
  const currentVersion = app.getVersion();
  let previousVersion = null;
  try {
    previousVersion = fs.readFileSync(versionFile, "utf8").trim();
  } catch (_) {
    // primer cop que s'obre l'app: no hi ha fitxer encara, no és "actualització"
  }
  const justUpdated = Boolean(previousVersion && previousVersion !== currentVersion);
  try {
    fs.writeFileSync(versionFile, currentVersion);
  } catch (e) {
    console.warn("[updater] No s'ha pogut desar el fitxer de versió:", e.message);
  }
  updateInfo = { justUpdated, version: currentVersion, previousVersion };
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
      preload: path.join(__dirname, "preload.js"),
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
  detectVersionChange();
  startBackend();
  createWindow();
  setupAutoUpdater();

  ipcMain.handle("get-update-info", () => updateInfo);
  ipcMain.handle("open-log-folder", () => {
    shell.openPath(path.dirname(log.transports.file.getFile().path));
  });

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

// ---------------------------------------------------------------------
// Actualitzacions automàtiques (electron-updater, via GitHub Releases).
//
// Nomes s'activa en un build empaquetat de veritat (app.isPackaged):
// en desenvolupament (`npm start`) no hi ha "app-update.yml" i
// electron-updater es queixaria sense sentit.
//
// Perque funcioni cal haver publicat una versio amb
// `npm run publish:win` (o mac/linux), que puja l'instal.lador a un
// "Release" del repositori de GitHub configurat a package.json ("build.publish").
// ---------------------------------------------------------------------
function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    console.warn("[updater] Error comprovant actualitzacions:", err.message);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const result = await dialog.showMessageBox({
      type: "info",
      title: "Actualització disponible",
      message: `S'ha descarregat la versió ${info.version}. Vols reiniciar l'app ara per instal·lar-la?`,
      buttons: ["Reiniciar ara", "Més tard"],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  // Primera comprovació uns segons després d'arrencar (no destorba l'inici),
  // i després un cop cada 4 hores mentre l'app estigui oberta.
  setTimeout(() => checkForUpdates(), 8000);
  setInterval(() => checkForUpdates(), 4 * 60 * 60 * 1000);
}

function checkForUpdates() {
  autoUpdater.checkForUpdates().catch((e) => {
    console.warn("[updater] No s'ha pogut comprovar si hi ha actualitzacions:", e.message);
  });
}