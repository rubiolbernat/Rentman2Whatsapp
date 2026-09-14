// preload.js
// Pont mínim i segur entre el procés principal (Node) i la interfície
// (renderer, sense accés a Node). Només exposa el que cal: saber si
// l'app s'acaba d'actualitzar.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getUpdateInfo: () => ipcRenderer.invoke("get-update-info"),
  openLogFolder: () => ipcRenderer.invoke("open-log-folder"),
});