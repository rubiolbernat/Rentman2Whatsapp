// src/whatsapp.js
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");

const state = {
  status: "starting", // starting | qr | authenticating | ready | auth_failure | disconnected
  qrDataUrl: null,
  lastError: null,
};

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: "events91-rentman",
    // Electron ens passa una carpeta d'usuari fixa (dataPath) perque la
    // sessio sobrevisqui actualitzacions de l'app; si no es dona, cau al
    // comportament per defecte (.wwebjs_auth al directori de treball).
    dataPath: process.env.WWEBJS_AUTH_DIR || undefined,
  }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
  // WhatsApp actualitza de tant en tant la versio de "WhatsApp Web" que
  // accepta, i deixa de respondre (error 426 "Upgrade Required") a la
  // versio que porta fixada per defecte whatsapp-web.js. En lloc de
  // dependre d'aquesta versio fixa, li diem que vagi a buscar sempre la
  // vigent a un repositori extern mantingut per la comunitat -- aixi
  // no es torna a quedar desactualitzat sol.
  webVersionCache: {
    type: "remote",
    remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html",
  },
});

client.on("qr", async (qr) => {
  state.status = "qr";
  state.qrDataUrl = await qrcode.toDataURL(qr);
  console.log("[whatsapp] Escaneja el QR (disponible a GET /api/whatsapp/status)");
});

client.on("authenticated", () => {
  state.status = "authenticating";
  state.qrDataUrl = null;
});

client.on("ready", () => {
  state.status = "ready";
  state.qrDataUrl = null;
  console.log("[whatsapp] Client connectat i llest");
});

client.on("auth_failure", (msg) => {
  state.status = "auth_failure";
  state.lastError = msg;
  console.error("[whatsapp] Error d'autenticació:", msg);
});

client.on("disconnected", (reason) => {
  state.status = "disconnected";
  state.lastError = reason;
  console.warn("[whatsapp] Desconnectat:", reason);
});

function getStatus() {
  return { status: state.status, qr: state.qrDataUrl, error: state.lastError };
}

async function resolveNumberId(rawPhone, defaultPrefix) {
  const digits = String(rawPhone || "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const hadPlus = String(rawPhone).trim().startsWith("+");
  const prefix = String(defaultPrefix || "34").replace(/[^\d]/g, "");

  const candidates = [];
  if (hadPlus) candidates.push(digits);
  candidates.push(digits);
  if (!digits.startsWith(prefix)) candidates.push(`${prefix}${digits}`);
  if (digits.startsWith("0")) candidates.push(`${prefix}${digits.replace(/^0+/, "")}`);

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const id = await client.getNumberId(candidate);
      if (id) return id;
    } catch (e) {
      // segueix provant la resta de variants
    }
  }
  return null;
}

async function resolveMembers(members, defaultPrefix) {
  const resolved = [];
  const notFound = [];
  for (const m of members) {
    const id = await resolveNumberId(m.phone, defaultPrefix);
    if (id) {
      resolved.push({ name: m.name, phone: m.phone, waId: id._serialized });
    } else {
      notFound.push({ name: m.name, phone: m.phone });
    }
  }
  return { resolved, notFound };
}

function assertReady() {
  if (state.status !== "ready") {
    const err = new Error(
      `WhatsApp no està connectat (estat actual: ${state.status}). Escaneja el QR a la pestanya "Connexió".`
    );
    err.status = 409;
    throw err;
  }
}

async function createGroup(name, members, defaultPrefix) {
  assertReady();
  const { resolved, notFound } = await resolveMembers(members, defaultPrefix);
  if (resolved.length === 0) {
    const err = new Error("Cap dels números té WhatsApp o cap s'ha pogut resoldre.");
    err.status = 422;
    throw err;
  }
  const result = await client.createGroup(name, resolved.map((m) => m.waId));
  const gid = result.gid ? result.gid._serialized : result.gid;
  return {
    groupId: gid,
    added: resolved.map((m) => ({ name: m.name, phone: m.phone })),
    notFound,
  };
}

async function listGroups() {
  assertReady();
  // Just despres de connectar, whatsapp-web.js pot trigar un moment a
  // tenir tots els xats sincronitzats i getChats() pot tornar una llista
  // buida o incompleta la primera vegada. Es reintenta un parell de
  // cops abans de donar-ho per bo.
  let chats = await client.getChats();
  let attempts = 0;
  while (chats.filter((c) => c.isGroup).length === 0 && attempts < 3) {
    await new Promise((r) => setTimeout(r, 1200));
    chats = await client.getChats();
    attempts++;
  }
  return chats
    .filter((c) => c.isGroup)
    .map((c) => ({ id: c.id._serialized, name: c.name, participants: c.participants?.length ?? null }));
}

// Llista els membres d'un grup amb el seu telefon (extret del waId), per
// poder-los revisar sense haver de recordar qui hi vas afegir.
async function getGroupMembers(groupId) {
  assertReady();
  const chat = await getGroupChat(groupId);
  return (chat.participants || []).map((p) => ({
    phone: p.id.user,
    waId: p.id._serialized,
    isAdmin: !!(p.isAdmin || p.isSuperAdmin),
  }));
}

// Canvia el nom del grup.
async function renameGroup(groupId, newName) {
  assertReady();
  if (!newName || !newName.trim()) {
    const err = new Error("El nom no pot ser buit");
    err.status = 400;
    throw err;
  }
  const chat = await getGroupChat(groupId);
  await chat.setSubject(newName.trim());
  return { renamed: true, name: newName.trim() };
}

// Tanca la sessio de WhatsApp (per poder vincular un altre mobil). Despres
// d'aixo caldra tornar a escanejar un QR nou a la pestanya "Connexio".
async function logout() {
  try {
    await client.logout();
  } finally {
    state.status = "starting";
    state.qrDataUrl = null;
    state.lastError = null;
    // Reinicialitza per generar un QR nou sense haver de reiniciar l'app.
    client.initialize();
  }
  return { loggedOut: true };
}

async function getGroupChat(groupId) {
  const chat = await client.getChatById(groupId);
  if (!chat || !chat.isGroup) {
    const err = new Error("Grup no trobat");
    err.status = 404;
    throw err;
  }
  return chat;
}

// WhatsApp només deixa afegir/treure gent o tancar un grup si el número
// connectat és ADMINISTRADOR d'aquell grup. Si no ho és, les crides
// fallen (o, pitjor, semblen anar bé però no fan res). Ho comprovem
// abans i donem un error clar, en lloc de deixar que peti més avall.
function assertIsGroupAdmin(chat) {
  const myId = client.info.wid._serialized;
  const me = (chat.participants || []).find((p) => p.id._serialized === myId);
  if (!me || !(me.isAdmin || me.isSuperAdmin)) {
    const err = new Error(
      "El número connectat no és administrador d'aquest grup. WhatsApp només deixa afegir, " +
      "treure gent o tancar un grup si ets administrador — fes-te'n admin des del mòbil i torna-ho a provar."
    );
    err.status = 403;
    throw err;
  }
}

// whatsapp-web.js pot retornar, segons la versio i el que digui WhatsApp
// en aquell moment, un objecte amb el resultat per participant
// ({ [waId]: { code, message } }), o no retornar res de detall. Aquesta
// funcio interpreta el que sigui i separa qui s'ha afegit/tret de veritat
// de qui ha fallat, en lloc de donar per fet que tot ha anat be.
function splitParticipantResult(result, attempted) {
  if (!result || typeof result !== "object") {
    // La llibreria no ha donat detall: no podem saber-ho amb certesa,
    // pero no vam rebre cap excepcio, aixi que ho tractem com a exit.
    return { succeeded: attempted, failed: [] };
  }
  const succeeded = [];
  const failed = [];
  for (const m of attempted) {
    const entry = result[m.waId];
    if (!entry || entry.code === 200 || entry.code === undefined) {
      succeeded.push(m);
    } else {
      failed.push({ ...m, reason: entry.message || `codi ${entry.code}` });
    }
  }
  return { succeeded, failed };
}

async function addParticipants(groupId, members, defaultPrefix) {
  assertReady();
  const chat = await getGroupChat(groupId);
  assertIsGroupAdmin(chat);
  const { resolved, notFound } = await resolveMembers(members, defaultPrefix);
  let succeeded = [];
  if (resolved.length > 0) {
    const result = await chat.addParticipants(resolved.map((m) => m.waId));
    const split = splitParticipantResult(result, resolved);
    succeeded = split.succeeded;
    for (const f of split.failed) notFound.push({ name: f.name, phone: f.phone, reason: f.reason });
  }
  return { added: succeeded.map((m) => ({ name: m.name, phone: m.phone })), notFound };
}

async function removeParticipants(groupId, phones, defaultPrefix) {
  assertReady();
  const chat = await getGroupChat(groupId);
  assertIsGroupAdmin(chat);
  const { resolved, notFound } = await resolveMembers(
    phones.map((p) => ({ name: p, phone: p })),
    defaultPrefix
  );
  let succeeded = [];
  let failed = [];
  if (resolved.length > 0) {
    const result = await chat.removeParticipants(resolved.map((m) => m.waId));
    const split = splitParticipantResult(result, resolved);
    succeeded = split.succeeded;
    failed = split.failed;
  }
  if (resolved.length > 0 && succeeded.length === 0) {
    const err = new Error(
      failed.length ? `WhatsApp no ha deixat treure ningú: ${failed.map((f) => f.reason).join("; ")}` : "WhatsApp no ha deixat treure ningú."
    );
    err.status = 422;
    throw err;
  }
  return {
    removed: succeeded.map((m) => m.phone),
    notFound: [...notFound.map((m) => m.phone), ...failed.map((f) => f.phone)],
  };
}

// Afegeix nomes els membres que encara no hi son (no treu ningu mai).
// Util per "actualitzar" un grup quan s'ha afegit gent nova al projecte
// sense voler arriscar-se a treure ningu per error.
async function addMissingParticipants(groupId, desiredMembers, defaultPrefix) {
  assertReady();
  const chat = await getGroupChat(groupId);
  assertIsGroupAdmin(chat);
  const { resolved: desired, notFound } = await resolveMembers(desiredMembers, defaultPrefix);
  const currentIds = new Set((chat.participants || []).map((p) => p.id._serialized));
  const toAdd = desired.filter((m) => !currentIds.has(m.waId));
  let succeeded = [];
  if (toAdd.length > 0) {
    const result = await chat.addParticipants(toAdd.map((m) => m.waId));
    succeeded = splitParticipantResult(result, toAdd).succeeded;
  }
  return {
    added: succeeded.map((m) => ({ name: m.name, phone: m.phone })),
    alreadyPresent: desired.length - toAdd.length,
    notFound,
  };
}

// Sincronitza els participants del grup perquè coincideixin amb la llista
// actual de l'equip del projecte: afegeix qui hi falta i treu qui ja no hi és
// (comparant per número, sense tocar qui ja hi és i coincideix).
async function syncParticipants(groupId, desiredMembers, defaultPrefix) {
  assertReady();
  const chat = await getGroupChat(groupId);
  assertIsGroupAdmin(chat);
  const { resolved: desired } = await resolveMembers(desiredMembers, defaultPrefix);
  const desiredIds = new Set(desired.map((m) => m.waId));
  const currentIds = new Set((chat.participants || []).map((p) => p.id._serialized));

  const toAdd = desired.filter((m) => !currentIds.has(m.waId));
  const toRemoveIds = [...currentIds].filter((id) => !desiredIds.has(id) && id !== client.info.wid._serialized);

  let added = [];
  let removedCount = 0;
  if (toAdd.length > 0) {
    const result = await chat.addParticipants(toAdd.map((m) => m.waId));
    added = splitParticipantResult(result, toAdd).succeeded;
  }
  if (toRemoveIds.length > 0) {
    const attempted = toRemoveIds.map((id) => ({ waId: id }));
    const result = await chat.removeParticipants(toRemoveIds);
    removedCount = splitParticipantResult(result, attempted).succeeded.length;
  }

  return { added: added.map((m) => ({ name: m.name, phone: m.phone })), removedCount };
}

// Envia un missatge de text al grup (p. ex. el contingut del camp custom_1
// del projecte de Rentman).
async function sendMessage(groupId, text) {
  assertReady();
  if (!text || !text.trim()) {
    const err = new Error("El missatge és buit");
    err.status = 400;
    throw err;
  }
  const chat = await getGroupChat(groupId);
  await chat.sendMessage(text);
  return { sent: true };
}

// "Elimina" el grup: treu tots els altres participants i en surt.
// whatsapp-web.js no permet disgregar un grup per a tothom des de fora,
// així que això és el més a prop: el grup queda buit i tu en surts.
async function cleanupGroup(groupId) {
  assertReady();
  const chat = await getGroupChat(groupId);
  assertIsGroupAdmin(chat);
  const myId = client.info.wid._serialized;
  const others = (chat.participants || []).map((p) => p.id._serialized).filter((id) => id !== myId);
  let removedCount = 0;
  let removeError = null;
  if (others.length > 0) {
    try {
      const attempted = others.map((id) => ({ waId: id }));
      const result = await chat.removeParticipants(others);
      removedCount = splitParticipantResult(result, attempted).succeeded.length;
      if (removedCount < others.length) {
        removeError = `Nomes s'han pogut treure ${removedCount} de ${others.length} persones.`;
      }
    } catch (e) {
      removeError = `No s'ha pogut treure la gent: ${e.message}`;
    }
  }
  await chat.leave();
  return { left: true, removedCount, warning: removeError };
}

function init() {
  client.initialize();
}

module.exports = {
  init,
  getStatus,
  createGroup,
  listGroups,
  addParticipants,
  removeParticipants,
  addMissingParticipants,
  syncParticipants,
  sendMessage,
  cleanupGroup,
  getGroupMembers,
  renameGroup,
  logout,
};