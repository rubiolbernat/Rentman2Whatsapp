// src/rentman.js
// El token de Rentman NO es guarda mai aquí: es rep a cada petició
// (capçalera X-Rentman-Token) i es reenvia directament a l'API de Rentman.

const API_BASE = process.env.RENTMAN_API_BASE || "https://api.rentman.net";

async function rentmanFetch(token, pathOrRef) {
  if (!token) {
    const err = new Error("Falta el token API de Rentman");
    err.status = 400;
    throw err;
  }
  let url = pathOrRef;
  if (!/^https?:\/\//.test(url)) {
    url = `${API_BASE}/${String(url).replace(/^\/+/, "")}`;
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const err = new Error(`Rentman API ${res.status} a ${url}`);
    err.status = res.status >= 400 && res.status < 500 ? res.status : 502;
    throw err;
  }
  return res.json();
}

function normalizeRef(ref) {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id ?? null;
}

function pickPhone(crewData) {
  const candidates = [
    "mobile", "mobilephone", "mobile_phone",
    "phone", "phonenumber", "phone_number", "tel",
  ];
  for (const key of candidates) {
    if (crewData[key]) return String(crewData[key]).trim();
  }
  return "";
}

function pickProjectNumber(project) {
  const candidates = ["number", "project_number", "projectnumber", "code", "reference", "displaynumber"];
  for (const key of candidates) {
    if (project[key]) return String(project[key]).trim();
  }
  return "";
}

function projectMatchesQuery(project, query) {
  const q = query.toLowerCase();
  return Object.values(project).some((v) => {
    if (typeof v === "string" || typeof v === "number") {
      return String(v).toLowerCase().includes(q);
    }
    return false;
  });
}

async function fetchSubprojectRefs(token, project, projectId) {
  let subprojectRefs = project.subprojects || project.subproject || [];
  if (!Array.isArray(subprojectRefs)) subprojectRefs = [subprojectRefs];
  subprojectRefs = subprojectRefs.map(normalizeRef).filter(Boolean);
  if (subprojectRefs.length > 0) return subprojectRefs;

  const filterAttempts = [
    `subprojects?project=projects/${projectId}&limit=200`,
    `subprojects?project=${projectId}&limit=200`,
    `subprojects?project_id=${projectId}&limit=200`,
  ];
  for (const path of filterAttempts) {
    try {
      const subRes = await rentmanFetch(token, path);
      const items = subRes.data ?? [];
      if (items.length > 0) {
        return items.map((sp) => normalizeRef(sp)).filter(Boolean);
      }
    } catch (e) {
      console.warn("Filtre de subprojectes fallit:", path, e.message);
    }
  }
  return [];
}

async function searchProjects(token, query, fullHistory) {
  if (!query || !query.trim()) {
    const err = new Error("Falta el text de cerca");
    err.status = 400;
    throw err;
  }
  const limit = 200;
  const maxPages = fullHistory ? 25 : 4;
  const wantMatches = 30;
  let matches = [];

  let url = `projects?limit=${limit}&sort=-id`;
  let pages = 0;
  while (url && pages < maxPages && matches.length < wantMatches) {
    const res = await rentmanFetch(token, url);
    const items = res.data ?? [];
    for (const p of items) {
      if (projectMatchesQuery(p, query)) matches.push(p);
    }
    pages++;
    url = res.next_page_url || null;
  }

  const seen = new Set();
  matches = matches.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  matches.sort((a, b) => Number(b.id) - Number(a.id));

  return matches.slice(0, 30).map((p) => ({
    id: p.id,
    name: p.displayname || p.name || `Projecte ${p.id}`,
    number: pickProjectNumber(p),
  }));
}

// Retorna el projecte "en cru" tal com el dona l'API de Rentman
// (inclou totes les dates de planificació i altres camps).
async function getRawProject(token, projectId) {
  const res = await rentmanFetch(token, `projects/${projectId}`);
  return res.data ?? res;
}

// Data de fi del projecte: Rentman la retorna directament al projecte
// (GET /projects) al camp "planperiod_end" (periode de planificacio).
// "usageperiod_end" es una alternativa mes propera a l'us real de
// l'equipament, per si algun cop planperiod_end no hi es.
function pickProjectEndDate(project) {
  const candidates = ["planperiod_end", "usageperiod_end"];
  for (const key of candidates) {
    const value = project[key];
    if (!value) continue;
    const str = String(value).slice(0, 10); // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  }
  return null;
}

async function loadCrew(token, projectId) {
  const project = await getRawProject(token, projectId);

  const subprojectRefs = await fetchSubprojectRefs(token, project, projectId);
  if (subprojectRefs.length === 0) {
    const err = new Error(
      "No s'ha trobat cap subprojecte/planificació per a aquest projecte. Comprova l'ID."
    );
    err.status = 404;
    throw err;
  }

  const crewEntries = [];
  for (const subId of subprojectRefs) {
    if (!subId) continue;
    const path = String(subId).includes("/") ? `${subId}/projectcrew` : `subprojects/${subId}/projectcrew`;
    try {
      const pcRes = await rentmanFetch(token, path);
      crewEntries.push(...(pcRes.data ?? []));
    } catch (e) {
      console.warn("No s'ha pogut llegir projectcrew de", subId, e.message);
    }
  }

  if (crewEntries.length === 0) {
    const err = new Error("No s'ha trobat cap membre d'equip planificat per aquest projecte.");
    err.status = 404;
    throw err;
  }

  const seen = new Map();
  for (const entry of crewEntries) {
    const crewRef = normalizeRef(entry.crewmember);
    if (!crewRef || seen.has(crewRef)) continue;
    seen.set(crewRef, entry);
  }

  const crew = [];
  for (const [crewRef, entry] of seen.entries()) {
    try {
      const path = String(crewRef).includes("/") ? crewRef : `crew/${crewRef}`;
      const crewRes = await rentmanFetch(token, path);
      const data = crewRes.data ?? crewRes;
      crew.push({
        id: crewRef,
        name: data.displayname || data.name || `Membre ${crewRef}`,
        function: entry.function_name || entry.function || "",
        phone: pickPhone(data),
      });
    } catch (e) {
      crew.push({ id: crewRef, name: `Membre ${crewRef} (error carregant dades)`, function: "", phone: "" });
    }
  }

  return {
    project: {
      id: project.id,
      name: project.displayname || project.name || `Projecte ${projectId}`,
      endDate: pickProjectEndDate(project),
    },
    crew,
  };
}

module.exports = { searchProjects, loadCrew, getRawProject, pickProjectEndDate };