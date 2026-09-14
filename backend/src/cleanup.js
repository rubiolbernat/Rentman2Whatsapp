// src/cleanup.js
// Revisa els grups vinculats a un projecte i, si ha passat el nombre de
// dies configurat des de la data de fi del projecte, neteja el grup
// (treu la gent i en surt) i esborra el vincle.
//
// Important: això NOMÉS s'executa quan es crida runOnce() explícitament
// (des del botó "Netejar grups antics ara" de l'app, via
// POST /api/whatsapp/cleanup/run). No hi ha cap temporitzador en segon
// pla — la neteja no passa mai sola.
//
// Es pot desactivar per grup posant autoCleanup=false en crear el vincle
// (en aquest cas, runOnce() sempre l'ignorarà).

const store = require("./store");
const wa = require("./whatsapp");

const DAYS_AFTER_END = Number(process.env.CLEANUP_DAYS_AFTER_END || 14);

function daysSince(dateStr) {
  const end = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const diffMs = Date.now() - end.getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

async function runOnce() {
  const links = store.listLinks();
  const cleaned = [];
  const skipped = [];
  for (const link of links) {
    if (!link.autoCleanup || !link.endDate) { skipped.push({ ...link, reason: "sense data de fi o neteja desactivada" }); continue; }
    const elapsed = daysSince(link.endDate);
    if (elapsed == null) { skipped.push({ ...link, reason: "data de fi no vàlida" }); continue; }
    if (elapsed < DAYS_AFTER_END) { skipped.push({ ...link, reason: `encara falten ${Math.ceil(DAYS_AFTER_END - elapsed)} dies` }); continue; }
    try {
      console.log(`[cleanup] Netejant grup "${link.groupName}" (projecte ${link.projectName}), ${Math.floor(elapsed)} dies des del final`);
      await wa.cleanupGroup(link.groupId);
      store.removeLink(link.groupId);
      cleaned.push({ ...link, daysSinceEnd: Math.floor(elapsed) });
    } catch (e) {
      console.warn(`[cleanup] No s'ha pogut netejar el grup ${link.groupId}:`, e.message);
      skipped.push({ ...link, reason: e.message });
    }
  }
  return { cleaned, skipped };
}

function start() {
  // Deshabilitat expressament: la neteja no s'executa sola en segon pla.
  // Es dispara sempre manualment (vegeu POST /api/whatsapp/cleanup/run).
}

module.exports = { start, runOnce, DAYS_AFTER_END };
