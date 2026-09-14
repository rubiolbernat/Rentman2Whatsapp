// src/store.js
// Persistència mínima en un fitxer JSON local (no cal cap base de dades).
// Guarda els vincles "aquest grup de WhatsApp correspon a aquest projecte
// de Rentman", amb una data de fi opcional per a la neteja automàtica.
//
// Format de dades/links.json:
// {
//   "links": [
//     {
//       "groupId": "1203630...@g.us",
//       "groupName": "Boda Martí",
//       "projectId": "2381",
//       "projectName": "Boda Martí",
//       "endDate": "2025-09-20",       // ISO date, opcional
//       "autoCleanup": true,            // si s'ha de netejar sola
//       "createdAt": "2025-09-10T12:00:00.000Z"
//     }
//   ]
// }

const fs = require("fs");
const path = require("path");

// Es guarda al costat de l'executable/backend, no dins de node_modules.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "links.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const HISTORY_MAX = 300;

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ links: [] }, null, 2));
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.links)) data.links = [];
    return data;
  } catch (e) {
    return { links: [] };
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function listLinks() {
  return readAll().links;
}

function getLinkByGroupId(groupId) {
  return readAll().links.find((l) => l.groupId === groupId) || null;
}

function upsertLink(link) {
  const data = readAll();
  const idx = data.links.findIndex((l) => l.groupId === link.groupId);
  const entry = {
    groupId: link.groupId,
    groupName: link.groupName || "",
    projectId: link.projectId != null ? String(link.projectId) : null,
    projectName: link.projectName || "",
    endDate: link.endDate || null,
    autoCleanup: link.autoCleanup !== false, // per defecte true
    createdAt: idx >= 0 ? data.links[idx].createdAt : new Date().toISOString(),
  };
  if (idx >= 0) data.links[idx] = entry;
  else data.links.push(entry);
  writeAll(data);
  return entry;
}

function removeLink(groupId) {
  const data = readAll();
  const before = data.links.length;
  data.links = data.links.filter((l) => l.groupId !== groupId);
  writeAll(data);
  return before !== data.links.length;
}

module.exports = { listLinks, getLinkByGroupId, upsertLink, removeLink, listHistory, appendHistory };

// ---------------------------------------------------------------------
// Historial d'accions: registre senzill de qui/que/quan, nomes per
// consultar dins de la pestanya "Historial" de l'app -- no afecta res
// del funcionament, es purament informatiu.
// ---------------------------------------------------------------------

function ensureHistoryFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify({ entries: [] }, null, 2));
}

function listHistory(limit = 100) {
  ensureHistoryFile();
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    const entries = Array.isArray(data.entries) ? data.entries : [];
    return entries.slice(0, limit);
  } catch (e) {
    return [];
  }
}

// type: "group_created" | "message_sent" | "group_cleaned" | "synced" |
//       "members_added" | "members_removed" | "renamed" | "linked" | "unlinked"
function appendHistory({ type, groupName, detail }) {
  ensureHistoryFile();
  let data;
  try {
    data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
  } catch (e) {
    data = { entries: [] };
  }
  if (!Array.isArray(data.entries)) data.entries = [];
  data.entries.unshift({
    type,
    groupName: groupName || "",
    detail: detail || "",
    at: new Date().toISOString(),
  });
  if (data.entries.length > HISTORY_MAX) data.entries.length = HISTORY_MAX;
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
}