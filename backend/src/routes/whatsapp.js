const express = require("express");
const wa = require("../whatsapp");
const store = require("../store");
const cleanup = require("../cleanup");

const router = express.Router();

router.get("/status", (req, res) => {
  res.json(wa.getStatus());
});

router.get("/groups", async (req, res, next) => {
  try {
    const groups = await wa.listGroups();
    const links = store.listLinks();
    const byId = new Map(links.map((l) => [l.groupId, l]));
    res.json({
      groups: groups.map((g) => ({ ...g, link: byId.get(g.id) || null })),
    });
  } catch (err) {
    next(err);
  }
});

// body: { name, members: [{name, phone}], defaultPrefix }
router.post("/groups", async (req, res, next) => {
  try {
    const { name, members, defaultPrefix } = req.body || {};
    if (!name || !Array.isArray(members) || members.length === 0) {
      const err = new Error("Cal 'name' i una llista 'members' no buida");
      err.status = 400;
      throw err;
    }
    const result = await wa.createGroup(name, members, defaultPrefix);
    store.appendHistory({ type: "group_created", groupName: name, detail: `${result.added.length} persones afegides` });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// body: { members: [{name, phone}], defaultPrefix }
router.post("/groups/:id/participants", async (req, res, next) => {
  try {
    const { members, defaultPrefix } = req.body || {};
    if (!Array.isArray(members) || members.length === 0) {
      const err = new Error("Cal una llista 'members' no buida");
      err.status = 400;
      throw err;
    }
    const result = await wa.addParticipants(req.params.id, members, defaultPrefix);
    if (result.added.length) store.appendHistory({ type: "members_added", groupName: req.params.id, detail: result.added.map((m) => m.phone).join(", ") });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// body: { phones: ["..."], defaultPrefix }
router.delete("/groups/:id/participants", async (req, res, next) => {
  try {
    const { phones, defaultPrefix } = req.body || {};
    if (!Array.isArray(phones) || phones.length === 0) {
      const err = new Error("Cal una llista 'phones' no buida");
      err.status = 400;
      throw err;
    }
    const result = await wa.removeParticipants(req.params.id, phones, defaultPrefix);
    if (result.removed.length) store.appendHistory({ type: "members_removed", groupName: req.params.id, detail: result.removed.join(", ") });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Sincronitza el grup perquè quedi exactament amb l'equip actual del
// projecte: afegeix qui falta, treu qui ja no hi és.
// body: { members: [{name, phone}], defaultPrefix }
router.post("/groups/:id/sync", async (req, res, next) => {
  try {
    const { members, defaultPrefix } = req.body || {};
    if (!Array.isArray(members)) {
      const err = new Error("Cal una llista 'members' (pot ser buida)");
      err.status = 400;
      throw err;
    }
    const result = await wa.syncParticipants(req.params.id, members, defaultPrefix);
    store.appendHistory({ type: "synced", groupName: req.params.id, detail: `+${result.added.length} / -${result.removedCount}` });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Afegeix nomes els membres que falten al grup (no treu ningu). Pensat
// per "actualitzar" un grup quan s'ha afegit gent nova al projecte.
// body: { members: [{name, phone}], defaultPrefix }
router.post("/groups/:id/add-missing", async (req, res, next) => {
  try {
    const { members, defaultPrefix } = req.body || {};
    if (!Array.isArray(members) || members.length === 0) {
      const err = new Error("Cal una llista 'members' no buida");
      err.status = 400;
      throw err;
    }
    const result = await wa.addMissingParticipants(req.params.id, members, defaultPrefix);
    if (result.added.length) store.appendHistory({ type: "members_added", groupName: req.params.id, detail: `${result.added.length} afegits (nomes qui faltava)` });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Envia un missatge de text al grup (p. ex. el camp custom_1 del projecte).
// body: { text }
router.post("/groups/:id/message", async (req, res, next) => {
  try {
    const { text } = req.body || {};
    const result = await wa.sendMessage(req.params.id, text);
    store.appendHistory({ type: "message_sent", groupName: req.params.id, detail: (text || "").slice(0, 80) });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Neteja manual: treu tothom i surt del grup. Si hi havia un vincle
// desat, també l'elimina.
router.post("/groups/:id/cleanup", async (req, res, next) => {
  try {
    const result = await wa.cleanupGroup(req.params.id);
    store.appendHistory({ type: "group_cleaned", groupName: req.params.id, detail: result.warning || `${result.removedCount} persones tretes` });
    store.removeLink(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------- Vincles projecte ↔ grup (per a la neteja automàtica) ----------

router.get("/links", (req, res) => {
  res.json({ links: store.listLinks() });
});

// body: { groupId, groupName, projectId, projectName, endDate, autoCleanup }
router.post("/links", (req, res, next) => {
  try {
    const { groupId } = req.body || {};
    if (!groupId) {
      const err = new Error("Cal 'groupId'");
      err.status = 400;
      throw err;
    }
    const entry = store.upsertLink(req.body);
    store.appendHistory({ type: "linked", groupName: entry.groupName, detail: `projecte "${entry.projectName}"` });
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

router.delete("/links/:groupId", (req, res) => {
  const removed = store.removeLink(req.params.groupId);
  res.json({ removed });
});

// Dispara la neteja de grups antics ara mateix, sense esperar la revisió
// periòdica (que per defecte és cada 6 hores).
router.post("/cleanup/run", async (req, res, next) => {
  try {
    const result = await cleanup.runOnce();
    res.json({ ...result, daysAfterEnd: cleanup.DAYS_AFTER_END });
  } catch (err) {
    next(err);
  }
});

// Llista els membres d'un grup amb el seu telefon.
router.get("/groups/:id/members", async (req, res, next) => {
  try {
    const members = await wa.getGroupMembers(req.params.id);
    res.json({ members });
  } catch (err) {
    next(err);
  }
});

// Canvia el nom d'un grup. body: { name }
router.post("/groups/:id/rename", async (req, res, next) => {
  try {
    const { name } = req.body || {};
    const result = await wa.renameGroup(req.params.id, name);
    store.appendHistory({ type: "renamed", groupName: name, detail: "" });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Tanca la sessio de WhatsApp (cal tornar a escanejar un QR despres).
router.post("/logout", async (req, res, next) => {
  try {
    const result = await wa.logout();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Historial d'accions (informatiu, nomes lectura).
router.get("/history", (req, res) => {
  res.json({ entries: store.listHistory(200) });
});

module.exports = router;