// renderer/app.js
// Sense frameworks. Parla amb el backend (mateix procés d'Electron) per
// http://127.0.0.1:3001. Icones definides a icons.js (carregat abans).

const BACKEND = "http://127.0.0.1:3001";
const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------------
// Icones: hidrata tots els elements amb data-icon="nom"
// ---------------------------------------------------------------------
function hydrateIcons() {
  document.querySelectorAll("[data-icon]").forEach((elm) => {
    const name = elm.dataset.icon;
    const isRail = elm.classList.contains("rail-btn");
    const isIconOnly = elm.classList.contains("icon-btn");
    const size = isRail ? 22 : isIconOnly ? 18 : 16;
    const iconHtml = icon(name, size);
    if (elm.querySelector(".label")) {
      elm.insertAdjacentHTML("afterbegin", iconHtml);
    } else if (isIconOnly || !elm.textContent.trim()) {
      elm.innerHTML = iconHtml;
    } else {
      const text = elm.textContent.trim();
      elm.innerHTML = `${iconHtml}<span class="btn-text">${escapeHtml(text)}</span>`;
    }
  });
}
hydrateIcons();

// ---------------------------------------------------------------------
// Notificacions d'escriptori (opcional, no bloqueja res si es denega)
// ---------------------------------------------------------------------
if (typeof Notification !== "undefined" && Notification.permission === "default") {
  Notification.requestPermission().catch(() => {});
}
function notify(title, body) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body });
    }
  } catch (_) { /* no passa res si falla, es purament informatiu */ }
}

// ---------------------------------------------------------------------
// Configuració persistida (localStorage)
// ---------------------------------------------------------------------
let config = {
  token: localStorage.getItem("rentmanToken") || "",
  defaultPrefix: localStorage.getItem("defaultPrefix") || "34",
  alwaysAdd: JSON.parse(localStorage.getItem("alwaysAdd") || "[]"),
};
function saveConfig() {
  localStorage.setItem("rentmanToken", config.token);
  localStorage.setItem("defaultPrefix", config.defaultPrefix);
  localStorage.setItem("alwaysAdd", JSON.stringify(config.alwaysAdd));
}

// ---------------------------------------------------------------------
// Client API
// ---------------------------------------------------------------------
async function apiRentman(path) {
  if (!config.token) throw new Error("Falta el token API de Rentman (pestanya Configuració)");
  return fetchSafe(`${BACKEND}/api/rentman/${path}`, { headers: { "X-Rentman-Token": config.token } });
}
async function apiWhatsapp(path, options = {}) {
  return fetchSafe(`${BACKEND}/api/whatsapp/${path}`, { headers: { "Content-Type": "application/json" }, ...options });
}
async function fetchSafe(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    throw new Error(`No es pot connectar amb el backend (${BACKEND}). ${e.message || ""}`.trim());
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function normalizePhone(raw) {
  const p = (raw || "").trim();
  if (!p) return "";
  const hadPlus = p.startsWith("+");
  const digits = p.replace(/[^\d]/g, "");
  if (!digits) return "";
  return hadPlus ? `+${digits}` : digits;
}

// ---------------------------------------------------------------------
// Diàleg de confirmació genèric
// ---------------------------------------------------------------------
function confirmAction({ title, message, confirmLabel = "Confirmar", danger = true }) {
  return new Promise((resolve) => {
    const box = el("modalBox");
    box.innerHTML = `
      <h2 class="modal-title">${icon(danger ? "alert" : "info", 20)}<span>${escapeHtml(title)}</span></h2>
      <p class="modal-sub">${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button class="secondary" id="confirmCancel">Cancel·lar</button>
        <button class="${danger ? "danger" : "primary"}" id="confirmOk">${escapeHtml(confirmLabel)}</button>
      </div>
    `;
    openModal();
    el("confirmCancel").onclick = () => { closeModal(); resolve(false); };
    el("confirmOk").onclick = () => { closeModal(); resolve(true); };
  });
}
function openModal() { el("modalOverlay").classList.remove("hidden"); }
function closeModal() { el("modalOverlay").classList.add("hidden"); }
el("modalOverlay").addEventListener("click", (e) => { if (e.target.id === "modalOverlay") closeModal(); });

function banner(elmt, text, kind) {
  if (!text) { elmt.classList.add("hidden"); return; }
  const iconName = kind === "error" ? "alert" : kind === "ok" ? "checkCircle" : "info";
  elmt.innerHTML = `${icon(iconName, 15)}<span>${escapeHtml(text)}</span>`;
  elmt.className = `banner ${kind}`;
}

// ---------------------------------------------------------------------
// Navegació entre seccions
// ---------------------------------------------------------------------
const sectionTitles = { rentman: "Rentman", grups: "Grups", manteniment: "Manteniment", historial: "Historial", connexio: "Connexió WhatsApp", config: "Configuració" };
document.querySelectorAll(".rail-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".rail-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    const sec = btn.dataset.section;
    el(`sec-${sec}`).classList.add("active");
    el("section-title").textContent = sectionTitles[sec];
    if (sec === "grups") refreshGroups();
    if (sec === "manteniment") refreshLinks();
    if (sec === "historial") refreshHistory();
  });
});
el("section-title").textContent = sectionTitles.rentman;

// =======================================================================
// SECCIÓ RENTMAN
// =======================================================================
let selectedProject = null;
let crew = [];

el("searchProjectBtn").addEventListener("click", searchProjects);
el("projectSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") searchProjects(); });

async function searchProjects() {
  const q = el("projectSearch").value.trim();
  if (!q) { banner(el("rentmanStatus"), "Escriu un nom, número o ID de projecte", "error"); return; }
  el("searchProjectBtn").disabled = true;
  el("projectResults").innerHTML = "";
  banner(el("rentmanStatus"), "Cercant…", "info");
  try {
    const full = el("fullHistory").checked;
    const { matches } = await apiRentman(`projects/search?q=${encodeURIComponent(q)}&full=${full}`);
    renderProjectResults(matches);
    banner(el("rentmanStatus"), matches.length ? `${matches.length} projecte(s) trobats.` : "Cap projecte coincideix.", matches.length ? "ok" : "error");
  } catch (e) {
    banner(el("rentmanStatus"), e.message, "error");
  } finally {
    el("searchProjectBtn").disabled = false;
  }
}

function renderProjectResults(matches) {
  const div = el("projectResults");
  div.innerHTML = "";
  matches.forEach((p) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="avatar">${escapeHtml((p.name || "?").slice(0, 1).toUpperCase())}</div>
      <div class="main">
        <div class="title">${escapeHtml(p.name)}</div>
        <div class="subtitle">${p.number ? `#${escapeHtml(p.number)} · ` : ""}ID ${escapeHtml(String(p.id))}</div>
      </div>
      <div class="chev">${icon("chevron", 16)}</div>
    `;
    row.addEventListener("click", () => selectProject(p));
    div.appendChild(row);
  });
}

async function selectProject(p) {
  el("projectResults").innerHTML = "";
  el("projectSearch").value = "";
  banner(el("rentmanStatus"), "Carregant equip…", "info");
  try {
    const data = await apiRentman(`projects/${p.id}/crew`);
    selectedProject = data.project;
    crew = data.crew.map((m) => ({ ...m, include: true }));
    el("selectedProjectLabel").textContent = selectedProject.name;
    el("groupName").value = selectedProject.name;
    renderCrew();
    el("crewBlock").classList.remove("hidden");
    banner(el("rentmanStatus"), `${crew.length} persones carregades. Revisa els números.`, "ok");
  } catch (e) {
    banner(el("rentmanStatus"), e.message, "error");
  }
}

function renderCrew() {
  const div = el("crewList");
  div.innerHTML = "";
  crew.forEach((m, idx) => {
    const row = document.createElement("div");
    row.className = "list-item crew-row";
    row.style.cursor = "default";
    row.innerHTML = `
      <input type="checkbox" data-idx="${idx}" class="include-cb" ${m.include ? "checked" : ""} />
      <div class="main">
        <div class="title">${escapeHtml(m.name)}</div>
        <div class="subtitle">${escapeHtml(m.function || "")}</div>
      </div>
      <input type="text" data-idx="${idx}" class="phone-input" value="${escapeHtml(m.phone || "")}" placeholder="+34..." />
    `;
    div.appendChild(row);
  });
  div.querySelectorAll(".include-cb").forEach((cb) => cb.addEventListener("change", (e) => { crew[e.target.dataset.idx].include = e.target.checked; }));
  div.querySelectorAll(".phone-input").forEach((inp) => inp.addEventListener("input", (e) => { crew[e.target.dataset.idx].phone = e.target.value.trim(); }));
}

el("createBtn").addEventListener("click", async () => {
  const selected = crew.filter((m) => m.include && m.phone);
  if (selected.length === 0) { banner(el("rentmanStatus"), "Ningú de la selecció té número", "error"); return; }
  const groupName = el("groupName").value.trim() || "Nou grup";
  const ok = await confirmAction({
    title: "Crear grup a WhatsApp",
    message: `Es crearà el grup "${groupName}" amb ${selected.length} persones. Continuar?`,
    confirmLabel: "Crear", danger: false,
  });
  if (!ok) return;

  const members = selected.map((m) => ({ name: m.name, phone: m.phone }));
  const seen = new Set(members.map((m) => m.phone));
  for (const fixed of config.alwaysAdd) {
    if (!seen.has(fixed.phone)) { members.push({ name: fixed.name, phone: fixed.phone }); seen.add(fixed.phone); }
  }

  el("createBtn").disabled = true;
  banner(el("rentmanStatus"), "Creant grup…", "info");
  try {
    const result = await apiWhatsapp("groups", { method: "POST", body: JSON.stringify({ name: groupName, members, defaultPrefix: config.defaultPrefix }) });
    if (result.groupId && selectedProject) {
      await apiWhatsapp("links", {
        method: "POST",
        body: JSON.stringify({
          groupId: result.groupId, groupName, projectId: String(selectedProject.id),
          projectName: selectedProject.name, endDate: selectedProject.endDate, autoCleanup: true,
        }),
      });
    }
    banner(el("rentmanStatus"), `Grup creat amb ${result.added.length} persones i vinculat al projecte.`, "ok");
    notify("Grup creat", `"${groupName}" amb ${result.added.length} persones.`);
  } catch (e) {
    banner(el("rentmanStatus"), e.message, "error");
  } finally {
    el("createBtn").disabled = false;
  }
});

// =======================================================================
// SECCIÓ GRUPS
// =======================================================================
let allGroups = [];

el("refreshGroupsBtn").addEventListener("click", refreshGroups);
el("groupSearch").addEventListener("input", renderGroups);

async function refreshGroups() {
  el("groupsList").innerHTML = `<div class="empty-state">Carregant…</div>`;
  try {
    const { groups } = await apiWhatsapp("groups");
    allGroups = groups;
    banner(el("groupsStatus"), "", "");
    renderGroups();
  } catch (e) {
    el("groupsList").innerHTML = "";
    banner(el("groupsStatus"), e.message, "error");
  }
}

function renderGroups() {
  const q = el("groupSearch").value.trim().toLowerCase();
  const filtered = allGroups.filter((g) => (g.name || "").toLowerCase().includes(q));
  const div = el("groupsList");
  div.innerHTML = "";
  if (allGroups.length === 0) { div.innerHTML = `<div class="empty-state">Encara no hi ha cap grup. Crea'n un des de la pestanya Rentman.</div>`; return; }
  if (filtered.length === 0) { div.innerHTML = `<div class="empty-state">Cap grup coincideix amb la cerca.</div>`; return; }
  filtered.forEach((g) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `
      <div class="avatar">${icon("users", 18)}</div>
      <div class="main">
        <div class="title">${escapeHtml(g.name)}</div>
        <div class="subtitle">${g.link ? `Vinculat a "${escapeHtml(g.link.projectName)}"` : `${g.participants ?? "?"} membres · sense vincle`}</div>
      </div>
      <div class="chev">${icon("chevron", 16)}</div>
    `;
    row.addEventListener("click", () => openGroupModal(g));
    div.appendChild(row);
  });
}

function fieldGroupTitle(name, title) {
  return `<div class="label-row">${icon(name, 16)}<span>${title}</span></div>`;
}

async function openGroupModal(group) {
  const box = el("modalBox");
  const link = group.link;
  box.innerHTML = `
    <h2>${escapeHtml(group.name)}</h2>
    <p class="modal-sub">${group.participants ?? "?"} membres ${link ? `· vinculat a "${escapeHtml(link.projectName)}"` : "· sense vincle"}</p>

    <div class="field-group">
      ${fieldGroupTitle("edit", "Canviar nom del grup")}
      <div class="row">
        <input type="text" id="m-rename" value="${escapeHtml(group.name)}" />
        <button class="primary" id="m-rename-btn" data-icon="save">Desar</button>
      </div>
    </div>

    <div class="field-group">
      ${fieldGroupTitle("users", "Membres del grup")}
      <button class="secondary" id="m-members-btn" data-icon="eye">Veure membres</button>
      <div id="m-members-wrap" class="chip-wrap"></div>
    </div>

    <div class="field-group">
      ${fieldGroupTitle("userPlus", "Afegir / treure gent")}
      <div class="row">
        <input type="text" id="m-add-phone" placeholder="+34... (afegir)" />
        <button class="secondary" id="m-add-btn" data-icon="userPlus">Afegir</button>
      </div>
      <div class="row">
        <input type="text" id="m-remove-phone" placeholder="+34... (treure)" />
        <button class="danger-outline" id="m-remove-btn" data-icon="userMinus">Treure</button>
      </div>
    </div>

    <div class="field-group">
      ${fieldGroupTitle("link", "Vincular a un projecte de Rentman")}
      <p class="hint" style="margin:0 0 6px;">Necessari per a la neteja, la sincronització i l'enviament de missatges.</p>
      <div class="row">
        <input type="text" id="m-project-id" placeholder="ID del projecte" value="${link ? escapeHtml(link.projectId) : ""}" />
        <button class="primary" id="m-link-btn" data-icon="link">Vincular</button>
      </div>
    </div>

    <div class="field-group">
      ${fieldGroupTitle("sync", "Actualitzar amb l'equip del projecte")}
      <div class="row">
        <button class="secondary" id="m-addmissing-btn" data-icon="userPlus" ${link ? "" : "disabled"} style="flex:1;">Només afegir qui falta</button>
        <button class="danger-outline" id="m-sync-btn" data-icon="sync" ${link ? "" : "disabled"} style="flex:1;">Afegir i treure</button>
      </div>
    </div>

    <div class="field-group">
      ${fieldGroupTitle("trash", "Eliminar grup")}
      <p class="hint" style="margin:0 0 6px;">Treu tothom del grup i en surts. No es pot desfer.</p>
      <button class="danger" id="m-delete-btn" data-icon="trash">Eliminar grup ara</button>
    </div>

    <div id="m-status" class="banner hidden"></div>
    <div class="modal-actions"><button class="secondary" id="m-close">Tancar</button></div>
  `;
  hydrateIcons();
  openModal();
  el("m-close").onclick = closeModal;
  const status = el("m-status");
  const busy = (fn) => async () => {
    banner(status, "", "");
    try {
      const msg = await fn();
      banner(status, msg || "Fet.", "ok");
    } catch (e) {
      banner(status, e.message, "error");
    }
  };

  el("m-rename-btn").onclick = busy(async () => {
    await apiWhatsapp(`groups/${encodeURIComponent(group.id)}/rename`, { method: "POST", body: JSON.stringify({ name: el("m-rename").value.trim() }) });
    refreshGroups();
    return "Nom canviat.";
  });

  el("m-members-btn").onclick = busy(async () => {
    const { members } = await apiWhatsapp(`groups/${encodeURIComponent(group.id)}/members`);
    const wrap = el("m-members-wrap");
    wrap.innerHTML = members.length
      ? members.map((m) => `<span class="chip">${m.isAdmin ? icon("star", 12) : ""}+${escapeHtml(m.phone)}</span>`).join("")
      : `<span class="hint">Cap membre.</span>`;
    return null;
  });

  el("m-add-btn").onclick = busy(async () => {
    const phone = el("m-add-phone").value.trim();
    if (!phone) return null;
    await apiWhatsapp(`groups/${encodeURIComponent(group.id)}/participants`, { method: "POST", body: JSON.stringify({ members: [{ name: phone, phone }], defaultPrefix: config.defaultPrefix }) });
    el("m-add-phone").value = "";
    return "Afegit.";
  });

  el("m-remove-btn").onclick = async () => {
    const phone = el("m-remove-phone").value.trim();
    if (!phone) return;
    const ok = await confirmAction({ title: "Treure del grup", message: `Es traurà ${phone} d'aquest grup. Continuar?` });
    if (!ok) return;
    await busy(async () => {
      await apiWhatsapp(`groups/${encodeURIComponent(group.id)}/participants`, { method: "DELETE", body: JSON.stringify({ phones: [phone], defaultPrefix: config.defaultPrefix }) });
      el("m-remove-phone").value = "";
      return "Tret.";
    })();
  };

  el("m-link-btn").onclick = busy(async () => {
    const pid = el("m-project-id").value.trim();
    const data = await apiRentman(`projects/${pid}/crew`);
    await apiWhatsapp("links", {
      method: "POST",
      body: JSON.stringify({
        groupId: group.id, groupName: group.name, projectId: String(data.project.id),
        projectName: data.project.name, endDate: data.project.endDate, autoCleanup: true,
      }),
    });
    group.link = { projectId: String(data.project.id), projectName: data.project.name, endDate: data.project.endDate };
    refreshGroups();
    return "Vinculat. Tanca i torna a obrir el grup per veure les opcions desbloquejades.";
  });

  el("m-addmissing-btn").onclick = busy(async () => {
    if (!link) return null;
    const data = await apiRentman(`projects/${link.projectId}/crew`);
    const members = data.crew.filter((m) => m.phone).map((m) => ({ name: m.name, phone: m.phone }));
    const result = await apiWhatsapp(`groups/${encodeURIComponent(group.id)}/add-missing`, { method: "POST", body: JSON.stringify({ members, defaultPrefix: config.defaultPrefix }) });
    return `Afegits: ${result.added.length}. Ja hi eren: ${result.alreadyPresent}.`;
  });

  el("m-sync-btn").onclick = async () => {
    if (!link) return;
    const ok = await confirmAction({ title: "Sincronitzar equip", message: "Això afegirà qui falta i TREURÀ del grup qui ja no estigui planificat a Rentman. Continuar?" });
    if (!ok) return;
    await busy(async () => {
      const data = await apiRentman(`projects/${link.projectId}/crew`);
      const members = data.crew.filter((m) => m.phone).map((m) => ({ name: m.name, phone: m.phone }));
      const result = await apiWhatsapp(`groups/${encodeURIComponent(group.id)}/sync`, { method: "POST", body: JSON.stringify({ members, defaultPrefix: config.defaultPrefix }) });
      return `Afegits: ${result.added.length}. Trets: ${result.removedCount}.`;
    })();
  };

  el("m-delete-btn").onclick = async () => {
    const ok = await confirmAction({ title: "Eliminar grup", message: `Es traurà tothom del grup "${group.name}" i en sortiràs. No es pot desfer.`, confirmLabel: "Eliminar" });
    if (!ok) return;
    await busy(async () => {
      const result = await apiWhatsapp(`groups/${encodeURIComponent(group.id)}/cleanup`, { method: "POST", body: "{}" });
      closeModal();
      refreshGroups();
      notify("Grup eliminat", `"${group.name}" s'ha buidat i tu n'has sortit.`);
      return result.warning ? `Has sortit del grup, però: ${result.warning}` : "Grup eliminat.";
    })();
  };
}

// =======================================================================
// SECCIÓ MANTENIMENT
// =======================================================================
let allLinks = [];
const selectedLinks = new Set();

el("refreshLinksBtn").addEventListener("click", refreshLinks);
el("cleanupThresholdBtn").addEventListener("click", cleanupThreshold);
el("cleanupSelectedBtn").addEventListener("click", cleanupSelected);

async function refreshLinks() {
  el("linksList").innerHTML = `<div class="empty-state">Carregant…</div>`;
  selectedLinks.clear();
  updateSelectedCount();
  try {
    const { links } = await apiWhatsapp("links");
    allLinks = links.sort((a, b) => (daysSince(b.endDate) ?? -99999) - (daysSince(a.endDate) ?? -99999));
    renderLinks();
  } catch (e) {
    el("linksList").innerHTML = "";
    banner(el("maintenanceStatus"), e.message, "error");
  }
}

function daysSince(endDate) {
  if (!endDate) return null;
  const end = new Date(`${endDate}T00:00:00`);
  if (isNaN(end.getTime())) return null;
  return Math.floor((Date.now() - end.getTime()) / 86400000);
}
function pillFor(days) {
  if (days == null) return { text: "sense data de fi", cls: "" };
  if (days < 0) return { text: `acaba d'aquí ${-days} dies`, cls: "info" };
  if (days < 7) return { text: `${days} dies des del final`, cls: "ok" };
  if (days < 14) return { text: `${days} dies des del final`, cls: "warn" };
  return { text: `${days} dies des del final`, cls: "danger" };
}

function renderLinks() {
  const div = el("linksList");
  div.innerHTML = "";
  if (allLinks.length === 0) {
    div.innerHTML = `<div class="empty-state">Cap grup vinculat encara.<br/>Vincula projectes des de la pestanya Grups perquè apareguin aquí.</div>`;
    return;
  }
  allLinks.forEach((l) => {
    const days = daysSince(l.endDate);
    const pill = pillFor(days);
    const row = document.createElement("div");
    row.className = "list-item";
    row.style.cursor = "default";
    row.innerHTML = `
      <input type="checkbox" data-gid="${escapeHtml(l.groupId)}" class="link-cb" />
      <div class="main">
        <div class="title">${escapeHtml(l.groupName)}</div>
        <div class="subtitle">Projecte "${escapeHtml(l.projectName)}"${l.endDate ? ` · fi: ${escapeHtml(l.endDate)}` : ""}</div>
      </div>
      <span class="pill ${pill.cls}">${pill.text}</span>
      <button class="icon-btn" data-unlink="${escapeHtml(l.groupId)}" title="Desvincular">${icon("unlink", 15)}</button>
    `;
    div.appendChild(row);
  });
  div.querySelectorAll(".link-cb").forEach((cb) => cb.addEventListener("change", (e) => {
    const gid = e.target.dataset.gid;
    if (e.target.checked) selectedLinks.add(gid); else selectedLinks.delete(gid);
    updateSelectedCount();
  }));
  div.querySelectorAll("[data-unlink]").forEach((btn) => btn.addEventListener("click", async () => {
    const gid = btn.dataset.unlink;
    const ok = await confirmAction({ title: "Desvincular", message: "El grup deixarà d'estar vinculat al projecte (no s'esborra el grup).", confirmLabel: "Desvincular", danger: false });
    if (!ok) return;
    await apiWhatsapp(`links/${encodeURIComponent(gid)}`, { method: "DELETE" });
    refreshLinks();
  }));
}

function updateSelectedCount() {
  const cleanupBtn = el("cleanupSelectedBtn");
  const n = selectedLinks.size;
  cleanupBtn.querySelector(".btn-text").textContent = `Netejar seleccionats (${n})`;
  cleanupBtn.disabled = n === 0;
}

async function cleanupThreshold() {
  const ok = await confirmAction({ title: "Netejar tots els grups antics", message: "Es netejaran tots els grups vinculats que superin el llindar de dies configurat al backend. No es pot desfer.", confirmLabel: "Netejar" });
  if (!ok) return;
  banner(el("maintenanceStatus"), "Netejant…", "info");
  try {
    const result = await apiWhatsapp("cleanup/run", { method: "POST", body: "{}" });
    banner(el("maintenanceStatus"), result.cleaned.length
      ? `S'han netejat ${result.cleaned.length} grup(s): ${result.cleaned.map((g) => g.groupName).join(", ")}.`
      : `Cap grup superava encara el llindar de ${result.daysAfterEnd} dies.`, "ok");
    if (result.cleaned.length) notify("Neteja completada", `${result.cleaned.length} grup(s) netejats.`);
    refreshLinks();
  } catch (e) {
    banner(el("maintenanceStatus"), e.message, "error");
  }
}

async function cleanupSelected() {
  if (selectedLinks.size === 0) return;
  const ok = await confirmAction({ title: "Netejar grups seleccionats", message: `Es traurà tota la gent i se sortirà de ${selectedLinks.size} grup(s). No es pot desfer.`, confirmLabel: "Netejar" });
  if (!ok) return;
  banner(el("maintenanceStatus"), "Netejant…", "info");
  let count = 0;
  for (const gid of [...selectedLinks]) {
    try { await apiWhatsapp(`groups/${encodeURIComponent(gid)}/cleanup`, { method: "POST", body: "{}" }); count++; } catch (_) {}
  }
  banner(el("maintenanceStatus"), `Netejats ${count} grup(s).`, "ok");
  notify("Neteja completada", `${count} grup(s) netejats.`);
  refreshLinks();
}

// =======================================================================
// SECCIÓ HISTORIAL
// =======================================================================
const HISTORY_META = {
  group_created: { icon: "userPlus", label: "Grup creat" },
  message_sent: { icon: "send", label: "Missatge enviat" },
  group_cleaned: { icon: "trash", label: "Grup netejat" },
  synced: { icon: "sync", label: "Equip sincronitzat" },
  members_added: { icon: "userPlus", label: "Membres afegits" },
  members_removed: { icon: "userMinus", label: "Membres tret(s)" },
  renamed: { icon: "edit", label: "Nom canviat" },
  linked: { icon: "link", label: "Vinculat a projecte" },
  unlinked: { icon: "unlink", label: "Desvinculat" },
};

el("refreshHistoryBtn").addEventListener("click", refreshHistory);

async function refreshHistory() {
  el("historyList").innerHTML = `<div class="empty-state">Carregant…</div>`;
  try {
    const { entries } = await apiWhatsapp("history");
    renderHistory(entries);
  } catch (e) {
    el("historyList").innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

function renderHistory(entries) {
  const div = el("historyList");
  if (!entries.length) { div.innerHTML = `<div class="empty-state">Encara no hi ha cap acció registrada.</div>`; return; }
  div.innerHTML = entries.map((e) => {
    const meta = HISTORY_META[e.type] || { icon: "info", label: e.type };
    const date = new Date(e.at);
    const dateStr = isNaN(date.getTime()) ? "" : date.toLocaleString("ca-ES", { dateStyle: "medium", timeStyle: "short" });
    return `
      <div class="list-item" style="cursor:default;">
        <div class="avatar">${icon(meta.icon, 17)}</div>
        <div class="main">
          <div class="title">${escapeHtml(meta.label)}${e.groupName ? ` · ${escapeHtml(e.groupName)}` : ""}</div>
          <div class="subtitle">${e.detail ? escapeHtml(e.detail) + " · " : ""}${dateStr}</div>
        </div>
      </div>
    `;
  }).join("");
}

// =======================================================================
// SECCIÓ CONNEXIÓ
// =======================================================================
async function pollWaStatus() {
  try {
    const s = await apiWhatsapp("status");
    const textEl = el("waStatusText");
    const qrEl = el("waQr");
    const logoutBtn = el("logoutBtn");
    if (s.status === "qr" && s.qr) {
      textEl.textContent = "Escaneja el codi QR amb el WhatsApp del mòbil:";
      qrEl.src = s.qr;
      qrEl.classList.remove("hidden");
      logoutBtn.classList.add("hidden");
    } else if (s.status === "ready") {
      textEl.innerHTML = `${icon("checkCircle", 18)}<span>Connectat a WhatsApp</span>`;
      textEl.classList.add("ok-line");
      qrEl.classList.add("hidden");
      logoutBtn.classList.remove("hidden");
    } else {
      textEl.classList.remove("ok-line");
      textEl.textContent = `Estat: ${s.status}${s.error ? " — " + s.error : ""}`;
      qrEl.classList.add("hidden");
      logoutBtn.classList.add("hidden");
    }
  } catch (e) {
    el("waStatusText").textContent = `No es pot connectar amb el backend. ${e.message}`;
  }
}
setInterval(pollWaStatus, 2500);
pollWaStatus();

el("logoutBtn").addEventListener("click", async () => {
  const ok = await confirmAction({ title: "Desconnectar WhatsApp", message: "Caldrà escanejar un codi QR nou (pot ser amb un altre mòbil) per tornar a fer servir l'app.", confirmLabel: "Desconnectar" });
  if (!ok) return;
  try { await apiWhatsapp("logout", { method: "POST", body: "{}" }); } catch (_) {}
});

// =======================================================================
// SECCIÓ CONFIGURACIÓ
// =======================================================================
el("token").value = config.token;
el("defaultPrefix").value = config.defaultPrefix;

el("saveConfigBtn").addEventListener("click", () => {
  config.token = el("token").value.trim();
  config.defaultPrefix = el("defaultPrefix").value.trim() || "34";
  saveConfig();
  el("savedTick").innerHTML = `${icon("check", 14)}<span>Desat</span>`;
  el("savedTick").classList.remove("hidden");
  setTimeout(() => el("savedTick").classList.add("hidden"), 2000);
});

function renderAlwaysList() {
  const div = el("alwaysList");
  if (config.alwaysAdd.length === 0) { div.innerHTML = `<div class="hint">Cap número fix encara.</div>`; return; }
  div.innerHTML = config.alwaysAdd.map((p, idx) => `
    <div class="list-item" style="cursor:default;">
      <div class="main"><div class="title">${escapeHtml(p.name)}</div><div class="subtitle">${escapeHtml(p.phone)}</div></div>
      <button class="icon-btn" data-idx="${idx}" title="Eliminar">${icon("x", 15)}</button>
    </div>
  `).join("");
  div.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", (e) => {
    config.alwaysAdd.splice(Number(e.currentTarget.dataset.idx), 1);
    saveConfig();
    renderAlwaysList();
  }));
}
renderAlwaysList();

el("addAlwaysBtn").addEventListener("click", () => {
  const name = el("alwaysName").value.trim();
  const phone = normalizePhone(el("alwaysPhone").value.trim());
  if (!phone) return;
  config.alwaysAdd.push({ name: name || phone, phone });
  saveConfig();
  renderAlwaysList();
  el("alwaysName").value = "";
  el("alwaysPhone").value = "";
});