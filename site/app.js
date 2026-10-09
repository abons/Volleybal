// Volleybal-PWA: team zoeken, favoriet lokaal bewaren, wedstrijden naar je agenda.

import * as shared from "./shared.js";
import { sameStart, currentFor, staleIds, shouldPush, shouldDrop, missingChoices, snapshotOf, presenceDiff, ENOUGH, candidatesFor, pickTarget, groupConfirms, keyType } from "./fresh.js";

const NEVOBO = "api.nevobo.nl";
const TZ = "Europe/Amsterdam";
const STORE = "volleybal.v1";

const $ = (sel) => document.querySelector(sel);
const view = $("#view");
view.addEventListener("toggle", (e) => { // toggle bubbelt niet: in de capture-fase, één keer
  const id = e.target.dataset?.who;
  if (id) e.target.open ? whoOpen.add(id) : whoOpen.delete(id);
}, true);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- Iconen: eigen SVG's, zodat ze de themakleur volgen en overal gelijk zijn ----
const svg = (body, fill = "none") => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ico = {
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>'),
  calPlus: svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M12 13v5M9.5 15.5h5"/>'),
  download: svg('<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  swap: svg('<path d="M4 8h14m0 0-4-4m4 4-4 4M20 16H6m0 0 4-4m-4 4 4 4"/>'),
  star: (on) => svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>', on ? "currentColor" : "none"),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),
};

// ---- Opslag: alleen op dit toestel (localStorage) ----
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ favs: state.favs, active: state.active, att: state.att, name: state.name, groups: state.groups, watch: state.watch, seen: state.seen, names: state.names, moved: state.moved, noAdopt: state.noAdopt })); } catch { /* privémodus */ }
  syncManifest();
}

// Naam en club bewaren naast de sleutel van elk team dat je gebruikt (favoriet of groep). Verandert Nevobo de sleutel van een
// team, dan vinden we het team op naam terug (zie moveTeam) in plaats van dat je favoriet en groep stil verdwijnen.
function rememberNames() {
  if (!teamIndex) return;
  let dirty = false;
  for (const k of new Set([...state.favs, ...Object.keys(state.groups)])) {
    const t = teamIndex.get(k);
    if (t && (state.names[k]?.n !== t.naam || state.names[k]?.c !== t.club)) { state.names[k] = { n: t.naam, c: t.club }; dirty = true; }
  }
  if (dirty) save();
}

// EXPERIMENT: een geïnstalleerde app heeft soms een eigen opslag (iPhone altijd): dan start hij zonder groep. Daarom krijgt de
// manifest als start_url je herstel-link mee zodra je in een groep zit; de app opent dan op het deelnemen-blad met je naam al
// ingevuld. `id` blijft de oude start_url, zodat bestaande installaties dezelfde app blijven. Werkt alleen als de browser een
// manifest uit een blob-URL accepteert bij het installeren.
let manifestStart = "";
function syncManifest() {
  const link = document.querySelector('link[rel="manifest"]');
  const code = shared.enabled && state.groups?.[state.active];
  if (!link || !location.protocol.startsWith("http")) return;
  if (!code) { // groep verlaten of team zonder groep: terug naar de vaste manifest
    if (manifestStart) { URL.revokeObjectURL(link.href); link.href = "manifest.webmanifest"; manifestStart = ""; }
    return;
  }
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  let start = `${base}#groep=${code}&team=${encodeURIComponent(state.active)}`;
  if (!state.watch?.[state.active] && state.name) start += `&naam=${encodeURIComponent(state.name)}`;
  if (myUid && !state.watch?.[state.active]) start += `&id=${encodeURIComponent(myUid)}`;
  if (start === manifestStart) return;
  if (manifestStart) URL.revokeObjectURL(link.href);
  manifestStart = start;
  const icon = (f, extra = {}) => ({ src: base + f, sizes: "512x512", type: "image/png", ...extra });
  const manifest = {
    id: base, name: "Volleybal", short_name: "Volleybal", lang: "nl", start_url: start, scope: base, display: "standalone",
    background_color: "#0e1424", theme_color: "#1d4ed8",
    icons: [{ ...icon("icon-192.png"), sizes: "192x192" }, icon("icon-512.png"), icon("icon-512.png", { purpose: "maskable" })],
  };
  link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" }));
}
const state = { favs: [], active: null, att: {}, name: "", groups: {}, watch: {}, seen: {}, ...load(), searching: false, club: null, query: "", matches: null, results: [], poules: [], tables: null, tab: "programma", error: "" };
if (!Array.isArray(state.favs)) state.favs = [];
for (const k of ["names", "moved", "noAdopt"]) if (typeof state[k] !== "object" || !state[k] || Array.isArray(state[k])) state[k] = {};

// ---- Aanwezigheid: per wedstrijd ja / misschien / nee ----
// Je eigen keuze staat altijd op dit toestel. Is Firebase ingesteld (firebase-config.js), dan
// wordt hij ook met je naam gedeeld, zodat teamgenoten zien wie er komt.
const STATUS = [["yes", "Ja", "Ik ben erbij"], ["maybe", "Misschien", "Misschien erbij"], ["no", "Nee", "Ik ben er niet bij"]];
const attendance = {
  get: (id) => state.att[id]?.[0] || null,
  set(id, status, start) {
    if (status) state.att[id] = [status, start]; else delete state.att[id];
    save();
  },
  // Ruim oude wedstrijden (meer dan 30 dagen geleden) op.
  prune() {
    const limit = Date.now() - 30 * 864e5;
    for (const [id, v] of Object.entries(state.att)) if (!Array.isArray(v) || !(parseDt(v[1]) >= limit)) delete state.att[id];
  },
};
if (typeof state.name !== "string") state.name = "";
if (typeof state.groups !== "object" || !state.groups || Array.isArray(state.groups)) state.groups = {};
for (const [k, c] of Object.entries(state.groups)) if (!shared.validCode(String(c))) delete state.groups[k];
if (typeof state.seen !== "object" || !state.seen || Array.isArray(state.seen)) state.seen = {};
for (const c of Object.keys(state.seen)) if (!Object.values(state.groups).includes(c)) delete state.seen[c]; // baseline hoort bij de groep; verlaten groepen ruimen we op
if (typeof state.watch !== "object" || !state.watch || Array.isArray(state.watch)) state.watch = {};
// ---- Groep per team: de code is de enige beveiliging ----
let others = null; // wedstrijd -> keuzes van groepsleden [{ uid, name, status }]
let memberList = []; // leden van de groep [{ uid, name }]
let memberCount = 0;
let myUid = "";
const groupOf = () => (shared.enabled && state.groups[state.active]) || null;
const viewing = () => !!(groupOf() && state.watch[state.active]); // zonder naam in de groep: alleen kijken
const showCode = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;
const upcomingMine = () => upcomingOf(state.matches || []).filter((m) => attendance.get(m.i));

async function pushMine(m) {
  const code = groupOf();
  if (!code || !state.name || viewing()) return;
  await shared.put({ code, match: m.i, start: m.s, name: state.name, status: attendance.get(m.i) });
}

let othersSeq = 0;
function resetShared() { others = null; memberList = []; memberCount = 0; state.shareError = false; othersSeq++; }

// Alleen de aanwezigheidsblokken en de groepsregel verversen, zodat de focus en een openstaande keuze blijven staan.
function refreshShared() {
  if (state.searching || state.club || state.tab !== "programma") return;
  const root = $("#matches");
  if (!root) return;
  refreshFill();
  const active = document.activeElement;
  const focusBox = active?.classList?.contains("att-now") ? active.closest("[data-box]")?.dataset.box : null;
  const focusLine = active?.id === "g-open";
  const focusAtt = active?.dataset?.att ? { m: active.dataset.for, k: active.dataset.att } : null; // keuzeknop in de Geef-door-modus
  for (const box of root.querySelectorAll("[data-box]")) {
    if (box.dataset.box === editing) continue;
    const m = (state.matches || []).find((x) => x.i === box.dataset.box);
    if (m) box.innerHTML = attInner(m);
    if (box.dataset.box === focusBox) box.querySelector(".att-now")?.focus();
    if (focusAtt && box.dataset.box === focusAtt.m) box.querySelector(`[data-att="${focusAtt.k}"]`)?.focus();
  }
  const focusMode = active?.id === "att-mode";
  const bar = root.querySelector(".modebar");
  if (bar) bar.outerHTML = modeBar();
  else { const line = root.querySelector(".share"); if (line) line.outerHTML = groupLine(); }
  if (focusLine) $("#g-open")?.focus();
  if (focusMode) $("#att-mode")?.focus();
}

// Jouw keuzes die in de groep ontbreken of afwijken (bijvoorbeeld na een mislukte push) opnieuw delen.
async function reconcile(code, list) {
  const remote = new Map((list || []).map((o) => [o.match, o]));
  const jobs = [];
  for (const m of upcomingOf(state.matches || [])) {
    const mineNow = attendance.get(m.i), r = remote.get(m.i);
    if (shouldPush(r, m, mineNow, state.name)) jobs.push(pushMine(m));
    else if (shouldDrop(r, m, mineNow)) jobs.push(shared.put({ code, match: m.i, start: m.s, name: state.name, status: null }));
  }
  await Promise.all(jobs);
}

// Staat het team van deze groep in het groepsdocument, en klopt het? Anders (als lid) bijwerken. Eén keer per sessie per groep; mislukt het
// (bijvoorbeeld omdat de nieuwe regels nog niet online staan), dan merk je er niets van.
const teamSynced = new Set();
async function syncGroupTeam(code, key) {
  const team = teamIndex.get(key);
  if (!team || teamSynced.has(code)) return;
  teamSynced.add(code);
  try {
    const info = await shared.groupInfo(code);
    if (info && (info.team !== team.key || info.naam !== team.naam || (info.club || "") !== (team.club || ""))) await shared.setGroupTeam(code, team);
  } catch { /* nieuwe regels nog niet online of geen verbinding: volgende sessie opnieuw */ }
}

async function loadOthers() {
  const code = groupOf();
  const key = state.active;
  if (!code) { others = null; return; }
  const seq = ++othersSeq;
  const stale = () => seq !== othersSeq || state.active !== key || groupOf() !== code;
  try {
    myUid = await shared.myUid();
    syncManifest();
    const [map, list] = await Promise.all([shared.rsvps(code), shared.members(code)]);
    if (stale()) return;
    others = map;
    memberList = list;
    state.shareError = false;
    // Heeft een teamgenoot mij als "spook" verwijderd terwijl ik de app nog gebruik? Dan word ik weer lid.
    if (state.name && !viewing() && !list.some((o) => o.uid === myUid)) {
      memberList = [...list, { uid: myUid, name: state.name }];
      shared.writeMember(code, state.name).catch(() => {});
    }
    memberCount = memberList.length;
    // eigen keuzes die in de groep ontbreken of afwijken, gelijktrekken (op de achtergrond)
    const mineRemote = [...map.entries()].flatMap(([match, l]) => l.filter((o) => o.uid === myUid).map((o) => ({ ...o, match })));
    if (!viewing()) { reconcile(code, mineRemote).catch(() => {}); syncGroupTeam(code, key); }
  } catch { if (!stale()) state.shareError = true; }
  if (!stale()) refreshShared();
}

if (typeof state.att !== "object" || !state.att || Array.isArray(state.att)) state.att = {};

// ---- Teamlijst ----
let teamIndex = null; // key -> team
let teamList = [];
let updated = "";

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function loadTeams() {
  if (teamIndex) return;
  // Een paar pogingen: direct na een nieuwe versie kan het bestand heel even ontbreken.
  let data;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch("data/teams.json", { cache: attempt ? "reload" : "default" });
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
      break;
    } catch (err) {
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  updated = data.updated;
  teamList = data.teams.map(([key, naam, club, plaats, stand]) => {
    const [, type, nr] = key.split("/");
    const soort = type === "dames" ? "dames ds" : type === "heren" ? "heren hs" : type;
    return { key, naam, club, plaats, stand, hay: norm(`${naam} ${club} ${plaats} ${stand} ${soort} ${nr}`) };
  });
  teamIndex = new Map(teamList.map((t) => [t.key, t]));
  $("#updated").textContent = ", bijgewerkt op " + new Date(updated).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: TZ });
}

function search(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return teamList.filter((t) => words.every((w) => t.hay.includes(w)));
}

// ---- Datum en tijd ----
// Nevobo geeft UTC ("20261008T190000Z"); zonder Z is het een lokale tijd.
function parseDt(s) {
  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(Z?)$/.exec(s);
  if (!m) return new Date(NaN);
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  return m[7] ? new Date(Date.UTC(y, mo - 1, d, h, mi, se)) : new Date(y, mo - 1, d, h, mi, se);
}
const fmt = (opts) => new Intl.DateTimeFormat("nl-NL", { timeZone: TZ, ...opts });
const fDay = fmt({ weekday: "short", day: "numeric", month: "short" });
const fDayYear = fmt({ day: "numeric", month: "short", year: "numeric" });
const fYear = fmt({ year: "numeric" });
const dayLabel = (d) => (fYear.format(d) === fYear.format(new Date()) ? fDay : fDayYear).format(d);
const fKey = fmt({ year: "numeric", month: "numeric", day: "numeric" });
const isToday = (d) => fKey.format(d) === fKey.format(new Date());
const fTime = fmt({ hour: "2-digit", minute: "2-digit" });

// ---- iCalendar maken ----
const icsText = (s) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
function fold(line) {
  // Maximaal 75 bytes per regel; vervolgregels beginnen met een spatie.
  const enc = new TextEncoder();
  const out = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}
// Aanwezigheid als momentopname in de beschrijving van de afspraak; leeg zonder groep of zonder keuzes.
function whoNote(m) {
  if (!shared.enabled || !others) return "";
  const groups = whoGroups(m);
  if (!groups.length) return "";
  return `Aanwezigheid (stand van ${dayLabel(new Date())} ${fTime.format(new Date())}):\n${groups.map(([k, names]) => `${GLYPH[k]} ${LABEL[k]} (${names.length}): ${names.join(", ")}`).join("\n")}`;
}
function veventFor(m, withWho = false) {
  const start = parseDt(m.s);
  const end = m.e ? parseDt(m.e) : new Date(start.getTime() + 2 * 3600e3);
  const dt = (raw, d) => (raw.endsWith("Z") ? utc(d) : raw);
  const note = withWho ? whoNote(m) : "";
  const lines = [
    "BEGIN:VEVENT",
    `UID:${m.i}`, // zelfde UID als Nevobo: opnieuw toevoegen werkt dan een bestaande afspraak bij
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${dt(m.s, start)}`,
    `DTEND:${m.e ? dt(m.e, end) : utc(end)}`,
    `SUMMARY:${icsText(m.t)}`,
  ];
  if (m.l) lines.push(`LOCATION:${icsText(m.l)}`);
  // Oplopend nummer (seconden), zodat de agenda dit als nieuwere versie van een eerdere import ziet en bijwerkt.
  if (note) lines.push(`SEQUENCE:${Math.floor(Date.now() / 1000)}`, `DESCRIPTION:${icsText(note)}`);
  if (m.g) lines.push(`GEO:${m.g}`);
  if (m.u) lines.push(`URL:${m.u}`);
  lines.push("END:VEVENT");
  return lines.map(fold).join("\r\n");
}
function calendar(name, matches, withWho = false) {
  const head = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Volleybal PWA//NL", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(name)}`];
  return [...head, ...matches.map((m) => veventFor(m, withWho)), "END:VCALENDAR"].join("\r\n") + "\r\n";
}
function download(filename, text) {
  const file = new File([text], filename, { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// ---- Weergave ----
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function teamUrls(key) {
  const [code, type, nr] = key.split("/");
  const path = `${NEVOBO}/export/team/${code.toUpperCase()}/${type}/${nr}/programma.ics`;
  return { web: `webcal://${path}`, https: `https://${path}` };
}

// "Sporthal X, Straat 5, 1234AB  Plaats" -> "Sporthal X, Plaats"
function shortPlace(loc) {
  const m = /^(.*?), .*?, \d{4}\s?[A-Z]{2}\s+(.*)$/.exec(loc);
  return m ? `${m[1]}, ${m[2]}` : loc;
}

function renderSearch() {
  view.innerHTML = `
    <section class="card">
      <h2>${state.active ? "Ander team kiezen" : "Zoek je team"}</h2>
      <p class="muted">Typ de naam van je club of team, bijvoorbeeld “Volley2B DS 1” of “heren 2 Rotterdam”.</p>
      <input id="q" type="search" placeholder="Teamnaam, club of plaats" value="${esc(state.query)}" autocomplete="off" autocapitalize="off" enterkeyhint="search" aria-label="Zoek een team">
      <p id="count" class="muted" role="status"></p>
      <ul class="results" id="results"></ul>
      ${state.active ? `<button id="back">Terug naar mijn team</button>` : ""}
    </section>
    ${shared.enabled ? `<section class="card">
      <h2>Heb je een herstel-link?</h2>
      <p class="muted">Plak de link of de groepscode die je van een teamgenoot kreeg, of die je bewaard had. Bijvoorbeeld na het installeren als app.</p>
      <div class="row">
        <input id="link" type="text" placeholder="Link of groepscode" autocomplete="off" autocapitalize="off" enterkeyhint="go" aria-label="Herstel-link of groepscode">
        <button id="link-go">Gebruik link</button>
      </div>
    </section>` : ""}`;
  const useLink = () => {
    const params = parseLinkText($("#link").value);
    if (!params) return toast("Dat lijkt geen link of groepscode van deze app.");
    applyLink(params);
  };
  $("#link-go")?.addEventListener("click", useLink);
  $("#link")?.addEventListener("keydown", (e) => { if (e.key === "Enter") useLink(); });
  const q = $("#q");
  q.addEventListener("input", () => { state.query = q.value; updateResults(); });
  $("#results").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-key]");
    if (b) selectTeam(b.dataset.key);
  });
  $("#back")?.addEventListener("click", () => { pendingCode = pendingName = pendingId = ""; state.searching = false; render(); $("#change")?.focus(); });
  updateResults();
  q.focus({ preventScroll: true });
}

// Alleen de lijst verversen, zodat het zoekveld (en je toetsenbord) blijft staan.
function updateResults() {
  const enough = state.query.trim().length >= 2;
  const results = enough ? search(state.query) : [];
  const shown = results.slice(0, 40);
  $("#results").innerHTML = shown.map((t) => `<li><button data-key="${esc(t.key)}"><b>${esc(t.naam)}</b><span class="muted">${esc(t.club)}${t.plaats ? ", " + esc(t.plaats) : ""}${t.stand ? " · " + esc(t.stand) : ""}</span></button></li>`).join("");
  $("#count").textContent = !enough ? "" : !results.length ? "Geen team gevonden. Probeer een deel van de naam."
    : results.length > shown.length ? `${results.length} teams gevonden. Typ iets specifieker om de lijst te verkleinen.`
    : `${results.length} ${results.length === 1 ? "team" : "teams"} gevonden`;
}

// Vanuit het eigen team bekeken: thuis of uit, en wie de tegenstander is.
function sideOf(m, team) {
  const [home, away] = m.t.split(" - ");
  const me = norm(team.naam);
  const isHome = norm(home || "") === me;
  const isAway = norm(away || "") === me;
  return { isHome, opp: isHome ? away : isAway ? home : null };
}

function matchRow(m, team) {
  const { isHome, opp } = sideOf(m, team);
  const d = parseDt(m.s);
  const place = m.l ? `<div class="where"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.l)}" target="_blank" rel="noopener">${esc(shortPlace(m.l))}</a></div>` : "";
  return `
    <div class="match ${d < Date.now() - 3 * 3600e3 ? "past" : ""}${isToday(d) ? " today" : ""}" data-id="${esc(m.i)}">
      <div class="when"><div class="d">${isToday(d) ? "vandaag" : esc(dayLabel(d))}</div><div class="t">${esc(fTime.format(d))}</div></div>
      <div class="what">
        <div class="vs">${opp ? `${isHome ? "" : `<span class="tag away">uit</span>`}<span>${esc(opp)}</span>` : `<span>${esc(m.t)}</span>`}</div>
        ${place}
        ${attendanceHtml(m)}
      </div>
      <button class="small icon" data-add="${esc(m.i)}" title="Zet in je agenda" aria-label="Zet ${esc(m.t)} in je agenda">${ico.calPlus}</button>
    </div>`;
}

// Wie komt er? Teamgenoten (zonder jezelf) plus jouw eigen keuze met je naam, en wie nog niets heeft gekozen,
// compact: "✓ Anouk, Bo  ? Dewi  ✕ Eline  ○ Fenna".
const GLYPH = { yes: "✓", maybe: "?", no: "✕", open: "○" };
const byName = (a, b) => a.localeCompare(b, "nl");
// Keuzes bij een wedstrijd: die van teamgenoten uit de groep en je eigen keuze zoals die op dit toestel staat.
function whoList(m) {
  const list = currentFor(others?.get(m.i), m).filter((o) => o.uid !== myUid);
  const mine = attendance.get(m.i);
  if (mine && state.name && !viewing()) list.push({ uid: myUid, name: state.name, status: mine });
  return list;
}
// Leden die bij deze wedstrijd nog niets hebben gekozen (jijzelf met de naam van dit toestel).
function openNames(m, list) {
  const done = new Set(list.map((o) => o.uid));
  return memberList.filter((o) => o.uid && !done.has(o.uid)).map((o) => (o.uid === myUid ? state.name : o.name) || "?").sort(byName);
}
// Per keuze de namen: [["yes", ["Anouk", "Bo"]], ["open", ["Fenna"]]], alleen gevulde groepen.
function whoGroups(m) {
  const list = whoList(m);
  const groups = STATUS.map(([k]) => [k, list.filter((o) => o.status === k).map((o) => o.name).sort(byName)]);
  groups.push(["open", openNames(m, list)]);
  return groups.filter(([, names]) => names.length);
}
const LABEL = { yes: "Ja", maybe: "Misschien", no: "Nee", open: "Nog niet gereageerd" };
// Ingeklapt: alleen het aantal dat komt ("✓ 8"); tikken toont per keuze de namen.
const whoOpen = new Set(); // wedstrijden waarvan de namen uitgeklapt zijn; blijft staan bij verversen
function whoDetails(m) {
  const full = whoHtml(m);
  if (!full) return "";
  const yes = whoGroups(m).find(([k]) => k === "yes")?.[1].length || 0;
  const level = yes < ENOUGH ? " who-low" : yes === ENOUGH ? " who-edge" : "";
  const hint = yes < ENOUGH ? `. Te weinig, minimaal ${ENOUGH}` : yes === ENOUGH ? ". Precies genoeg" : "";
  const counts = `<span class="who-yes${level}"><span aria-hidden="true">${GLYPH.yes}</span><span class="sr-only">${LABEL.yes}: </span>${yes}</span>`;
  return `<details class="who-d" data-who="${esc(m.i)}"${whoOpen.has(m.i) ? " open" : ""}><summary aria-label="${yes} ${yes === 1 ? "komt" : "komen"}${hint}. Toon namen">${counts}</summary><div class="who" aria-live="polite">${full}</div></details>`;
}
function whoHtml(m) {
  if (!shared.enabled || !others) return "";
  return whoGroups(m).map(([k, names]) =>
    `<span class="who-${k}"><span aria-hidden="true">${GLYPH[k]}</span><span class="sr-only">${LABEL[k]}: </span> ${names.map(esc).join(", ")}</span>`).join(" ");
}

// ---- Keuzes doorsturen via een link: &a=<sleutel><letter>,… ----
// Sleutel per wedstrijd is de starttijd in UTC (jjjjmmdduumm), kort en stabiel; letters j/m/n voor Ja/Misschien/Nee.
const ATT_CODE = { yes: "j", maybe: "m", no: "n" };
const CODE_ATT = Object.fromEntries(Object.entries(ATT_CODE).map(([k, v]) => [v, k]));
const matchKey = (m) => parseDt(m.s).toISOString().slice(0, 16).replace(/\D/g, "");
const keyDate = (k) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), +k.slice(8, 10), +k.slice(10, 12)));
let pendingProposal = null; // { from, items: [{ k, status }] } uit een link, tot het is overgenomen of afgewezen

function parseProposal(a, from) {
  const items = String(a || "").split(",").map((p) => /^(\d{12})([jmn])$/.exec(p)).filter(Boolean).map((x) => ({ k: x[1], status: CODE_ATT[x[2]] }));
  return items.length ? { from: String(from || "").trim().slice(0, 30), items } : null;
}
// Mijn keuzes voor komende wedstrijden als link, met mijn naam als afzender.
function forwardLink() {
  const a = upcomingMine().map((m) => matchKey(m) + ATT_CODE[attendance.get(m.i)]).join(",");
  return `${inviteLink()}&van=${encodeURIComponent(state.name)}&a=${a}`;
}
function forwardText(team) {
  const lines = upcomingMine().map((m) => {
    const { isHome, opp } = sideOf(m, team);
    const d = parseDt(m.s);
    return `${GLYPH[attendance.get(m.i)]} ${dayLabel(d)} · ${opp ? `${isHome ? "thuis" : "uit"} tegen ${opp}` : m.t}`;
  });
  return `Aanwezigheid ${team.naam}, zoals ik hem heb ingevuld:\n${lines.join("\n")}\n\nOvernemen of aanpassen: ${forwardLink()}`;
}
// Regels voor het voorstel in een blad, uit de sleutels zelf (de wedstrijdlijst hoeft nog niet geladen te zijn).
const proposalLines = (items) => items.map(({ k, status }) => { const d = keyDate(k); return `<li><span class="who-${status}"><span aria-hidden="true">${GLYPH[status]}</span><span class="sr-only">${LABEL[status]}: </span></span> ${esc(dayLabel(d))} ${esc(fTime.format(d))}</li>`; }).join("");
// Voorstel overnemen: zet de keuzes op dit toestel voor de wedstrijden die (nog) in het programma staan. Geeft het aantal terug.
async function applyProposal() {
  const p = pendingProposal;
  pendingProposal = null;
  if (!p) return 0;
  await matchesLoaded;
  const byKey = new Map(upcomingOf(state.matches || []).map((m) => [matchKey(m), m]));
  let n = 0;
  for (const { k, status } of p.items) { const m = byKey.get(k); if (m) { attendance.set(m.i, status, m.s); n++; } }
  return n;
}
// Al in de groep en een link met keuzes geopend: vraag of je ze overneemt.
async function offerProposal() {
  const p = pendingProposal;
  if (!p || !state.active || state.searching || !groupOf()) return;
  if (viewing()) { pendingProposal = null; return toast("Vul eerst je naam in onder beheer; daarna kun je keuzes overnemen."); }
  const dlg = $("#group-dlg");
  if (!dlg) return;
  // De wedstrijdlijst is geladen: toon alleen keuzes voor wedstrijden die er nog in staan.
  const keys = new Set(upcomingOf(state.matches || []).map(matchKey));
  const items = p.items.filter((it) => keys.has(it.k));
  const gone = p.items.length - items.length;
  if (!items.length) { pendingProposal = null; return toast("De wedstrijden uit de link staan niet (meer) in het programma."); }
  dlg.innerHTML = `<div class="sheet-head"><h3 id="group-title">Aanwezigheid overnemen</h3><button class="star" id="g-close" aria-label="Sluiten">${ico.close}</button></div>
    <p class="muted">${p.from ? esc(p.from) + " stuurde" : "Iemand stuurde"} je deze keuzes voor ${esc(teamIndex.get(state.active)?.naam || "je team")}. Neem ze over; aanpassen kan daarna per wedstrijd.</p>
    <ul class="proposal">${proposalLines(items)}</ul>
    ${gone ? `<p class="muted hint">${gone} ${gone === 1 ? "wedstrijd uit de link staat" : "wedstrijden uit de link staan"} niet (meer) in het programma.</p>` : ""}
    <button class="btn primary" id="p-accept">Overnemen</button>
    <p id="g-err" class="notice" role="alert" hidden></p>
    <button class="link" id="p-skip">Nee, mijn keuzes laten staan</button>`;
  if (!dlg.open) (dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", ""));
  $("#p-accept")?.focus();
}

// Tekstoverzicht voor in de teamapp: per komende wedstrijd wie komt en wie nog niet heeft gereageerd, plus de uitnodigingslink.
const OVERVIEW_MAX = 8;
function overviewText(team) {
  const upcoming = upcomingOf(state.matches || []);
  const lines = upcoming.slice(0, OVERVIEW_MAX).map((m) => {
    const { isHome, opp } = sideOf(m, team);
    const d = parseDt(m.s);
    const who = whoGroups(m).map(([k, names]) => `${GLYPH[k]} ${k === "open" ? "nog niet: " : ""}${names.join(", ")}`);
    return `${dayLabel(d)} ${fTime.format(d)} · ${opp ? `${isHome ? "thuis" : "uit"} tegen ${opp}` : m.t}\n${who.length ? who.join(" · ") : "nog geen keuzes"}`;
  });
  if (upcoming.length > OVERVIEW_MAX) lines.push(`… en nog ${upcoming.length - OVERVIEW_MAX} wedstrijden in de app.`);
  return `Wie komt er? ${team.naam}\n\n${lines.join("\n\n")}\n\nGeef je aanwezigheid door in de app: ${inviteLink()}`;
}

// Standaard een rustige regel met je keuze; tik erop en dezelfde plek wordt Ja / Misschien / Nee.
let editing = null; // id van de wedstrijd waarvan de keuzeknoppen openstaan
let entering = false; // "Geef door"-modus: bij alle wedstrijden staan de keuzeknoppen open

function attInner(m) {
  if (viewing()) return whoDetails(m);
  const cur = attendance.get(m.i);
  if (entering || editing === m.i) {
    const who = entering ? whoHtml(m) : "";
    return `<div class="att" role="group" aria-label="Aanwezig bij ${esc(m.t)}?">${STATUS.map(([k, name, long]) =>
      `<button class="att-${k}" data-att="${k}" data-g="${GLYPH[k]}" data-for="${esc(m.i)}" aria-pressed="${cur === k}" aria-label="${esc(long)}">${name}</button>`).join("")}</div>${who ? `<div class="who" aria-live="polite">${who}</div>` : ""}`;
  }
  const text = { yes: "Je komt", maybe: "Misschien", no: "Je komt niet" }[cur];
  const whoLine = whoDetails(m);
  // Nog niets gekozen: geen regel per wedstrijd; invullen gaat via de knop 'Geef door' bovenaan.
  if (!cur) return whoLine;
  const line = `<span class="dot att-${cur}" aria-hidden="true">${GLYPH[cur]}</span>${text}`;
  return `<button class="att-now set att-${cur}" data-edit="${esc(m.i)}" aria-label="Aanwezigheid: ${esc(text.toLowerCase())}. Tik om te wijzigen">${line}</button>${whoLine}`;
}

function attendanceHtml(m) {
  return `<div class="att-box" data-box="${esc(m.i)}">${attInner(m)}</div>`;
}

function renderTeam() {
  const team = teamIndex.get(state.active);
  const isFav = state.favs.includes(state.active);

  view.innerHTML = `
    ${state.favs.length > 1 ? `<div class="chips" role="group" aria-label="Mijn teams">${state.favs.map((k) => `<button class="chip" data-switch="${esc(k)}" aria-pressed="${k === state.active}">${esc(teamIndex.get(k)?.naam || k)}</button>`).join("")}</div>` : ""}
    <section class="card">
      <div class="team-head">
        <div>
          <h2 id="team-name" tabindex="-1">${esc(team.naam)}</h2>
          <p class="muted">${team.club ? `<button class="link inline" id="club" title="Alle thuiswedstrijden van ${esc(team.club)}">${esc(team.club)}</button>` : ""}${team.plaats ? ", " + esc(team.plaats) : ""}${team.stand ? " · " + esc(team.stand).replace(/ (\S+)$/, "&nbsp;$1") : ""}</p>
        </div>
        <div class="head-btns">
          <button class="star" id="change" aria-label="Ander team" title="Ander team">${ico.swap}</button>
          <button class="star" id="fav" aria-pressed="${isFav}" aria-label="Mijn team" title="${isFav ? "Verwijder uit mijn teams" : "Bewaar als mijn team"}">${ico.star(isFav)}</button>
        </div>
      </div>
      <div class="actions">
        <div class="main-action">
          <button class="btn primary" id="agenda-open" aria-haspopup="dialog">${ico.cal} In je agenda</button>
        </div>
      </div>
      <dialog class="sheet" id="agenda-dlg" aria-labelledby="agenda-title">
        <div class="sheet-head">
          <h3 id="agenda-title">Zet in je agenda</h3>
          <button class="star" id="agenda-close" aria-label="Sluiten">${ico.close}</button>
        </div>
        <a class="opt" id="subscribe" href="${esc(teamUrls(state.active).web)}">
          ${ico.cal}<span><b>Alle wedstrijden (aanbevolen)</b><span class="muted">Nieuwe en gewijzigde wedstrijden komen vanzelf mee.</span></span>
        </a>
        <button class="opt" id="copy">
          ${ico.link}<span><b>Link kopiëren</b><span class="muted">Plak de link in Google Agenda of een andere agenda-app.</span></span>
        </button>
        <button class="opt" id="all">
          ${ico.download}<span><b>Downloaden met aanwezigheid</b><span class="muted">Komende wedstrijden als bestand, met de aanwezigheid in de beschrijving. Latere wijzigingen komen niet mee.</span></span>
        </button>
      </dialog>
    </section>
    <div class="tabs" role="group" aria-label="Wat wil je zien?">
      ${[["programma", "Programma"], ["uitslagen", "Uitslagen"], ["stand", "Stand"]].map(([k, l]) => `<button data-tab="${k}" aria-pressed="${state.tab === k}">${l}</button>`).join("")}
    </div>
    <div id="matches"></div>
    <dialog class="sheet" id="group-dlg" aria-labelledby="group-title"></dialog>`;
  $("#group-dlg").addEventListener("click", onGroupClick);
  $("#group-dlg").addEventListener("input", (e) => { // knop: 'Alleen kijken' zolang er geen naam is
    const join = e.target.id === "g-name" && $("#g-join");
    if (join) join.textContent = e.target.value.trim() ? "Deelnemen" : "Alleen kijken";
  });
  $("#group-dlg").addEventListener("keydown", (e) => { // Enter verstuurt het blad
    if (e.key !== "Enter" || !e.target.matches("input:not([type=checkbox])")) return;
    e.preventDefault();
    const dlg = e.currentTarget;
    const go = $("#g-sub-save") ? "#g-sub-save" : e.target.id === "g-code" || $("#g-code")?.value.trim() ? "#g-join" : $("#g-rename") ? "#g-rename" : "#g-create";
    dlg.querySelector(go)?.click();
  });

  $("#fav").addEventListener("click", () => {
    state.favs = isFav ? state.favs.filter((k) => k !== state.active) : [...state.favs, state.active];
    save();
    renderTeam();
    $("#fav").focus();
    toast(isFav ? "Verwijderd uit je teams." : "Opgeslagen als je team. Tik nogmaals op de ster om te verwijderen.");
  });
  $("#club")?.addEventListener("click", () => { state.club = team.club; render(); });
  $("#change").addEventListener("click", () => { state.searching = true; state.query = ""; render(); });
  const dlg = $("#agenda-dlg");
  // Oudere browsers kennen <dialog> niet: dan tonen we het blad gewoon met het open-attribuut.
  const closeDlg = () => (dlg.close ? dlg.close() : dlg.removeAttribute("open"));
  $("#agenda-open").addEventListener("click", () => (dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", "")));
  $("#agenda-close").addEventListener("click", closeDlg);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDlg(); }); // tik naast het blad
  $("#subscribe").addEventListener("click", () => setTimeout(closeDlg, 300));
  $("#all").addEventListener("click", () => {
    closeDlg();
    const up = upcomingOf(state.matches || []);
    download(`${slug(team.naam)}.ics`, calendar(`Wedstrijden ${team.naam}`, up, true));
    toast(`${up.length} komende wedstrijden. Open het bestand om ze toe te voegen.`);
  });
  $("#copy").addEventListener("click", async () => {
    closeDlg();
    const link = teamUrls(state.active).https;
    try { await navigator.clipboard.writeText(link); toast("Link gekopieerd. Plak hem in je agenda-app."); }
    catch { prompt("Kopieer deze link en plak hem in je agenda-app:", link); }
  });
  view.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    state.tab = b.dataset.tab;
    view.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderMatches();
  }));
  view.querySelectorAll("[data-switch]").forEach((b) => b.addEventListener("click", () => selectTeam(b.dataset.switch, false)));
  $("#matches").addEventListener("click", (e) => {
    const redraw = (m, focusSel) => {
      const box = $("#matches").querySelector(`[data-box="${CSS.escape(m.i)}"]`);
      if (!box) return;
      box.innerHTML = attInner(m);
      if (focusSel) box.querySelector(focusSel)?.focus();
    };
    const ed = e.target.closest("[data-edit]");
    const em = ed && (state.matches || []).find((x) => x.i === ed.dataset.edit);
    if (em) { // keuzeknoppen openen; eventueel openstaande andere sluiten
      const prev = editing && (state.matches || []).find((x) => x.i === editing);
      editing = em.i;
      if (prev) redraw(prev);
      redraw(em, ".att button");
      return;
    }
    const a = e.target.closest("[data-att]");
    const am = a && (state.matches || []).find((x) => x.i === a.dataset.for);
    if (am) { // opnieuw tikken op de gekozen knop haalt je keuze weg
      const next = attendance.get(am.i) === a.dataset.att ? null : a.dataset.att;
      attendance.set(am.i, next, am.s);
      editing = null;
      redraw(am, entering ? `[data-att="${a.dataset.att}"]` : ".att-now");
      refreshFill();
      pushMine(am).then(loadOthers, () => toast("Delen met je team is niet gelukt. Je keuze staat wel op dit toestel."));
      return;
    }
    if (e.target.closest("#g-open")) { openGroupDialog(); return; }
    if (e.target.closest("#presence-ok")) return ackPresence();
    if (e.target.closest("#att-fill")) { // alle keuzeknoppen open en naar de eerste wedstrijd zonder keuze
      const first = missingChoices(upcomingOf(state.matches || []), (x) => attendance.get(x.i))[0];
      entering = true;
      editing = null;
      renderMatches();
      const box = first && $("#matches").querySelector(`[data-box="${CSS.escape(first.i)}"]`);
      box?.scrollIntoView({ block: "center" });
      box?.querySelector(".att button")?.focus();
      return;
    }
    if (e.target.closest("#att-mode")) {
      entering = !entering;
      editing = null;
      renderMatches();
      $("#att-mode")?.focus();
      return;
    }
    const b = e.target.closest("[data-add]");
    const m = b && (state.matches || []).find((x) => x.i === b.dataset.add);
    if (!m) return;
    download(`${slug(m.t)}-${m.s.slice(0, 8)}.ics`, calendar(m.t, [m], true));
    toast("Open het bestand om de wedstrijd toe te voegen.");
  });
  renderMatches();
}

const upcomingOf = (all) => all.filter((m) => parseDt(m.s) >= Date.now() - 3 * 3600e3);

// Alleen het onderste deel verversen, zodat de focus op de pagina blijft staan.
function renderMatches() {
  const team = teamIndex.get(state.active);
  const body = $("#matches");
  if (state.tab === "uitslagen") body.innerHTML = resultsHtml(team);
  else if (state.tab === "stand") { body.innerHTML = standHtml(team); loadTables(); }
  else body.innerHTML = programHtml(team);
  $("#retry")?.addEventListener("click", loadMatches);
  const all = $("#all");
  if (all) all.disabled = !upcomingOf(state.matches || []).length;
}

const loading = () => (state.matches === null && !state.error ? `<p class="muted">Laden…</p>` : "");
const problem = () => (state.error ? `<p class="notice">${esc(state.error)}</p><button id="retry">Opnieuw proberen</button>` : "");

// Balk boven het programma: groepsinfo en de knop die bij alle wedstrijden tegelijk de keuzeknoppen opent.
function modeBar() {
  return `<div class="modebar">${shared.enabled ? groupLine() : ""}${viewing() ? "" : `<button class="small${entering ? " on" : ""}" id="att-mode" aria-pressed="${entering}" title="Aanwezigheid bij alle wedstrijden doorgeven">${entering ? "Klaar" : "Geef door"}</button>`}</div>`;
}

// Waarschuwing boven het programma als je er al veel hebt ingevuld maar een paar ontbreken.
function fillWarningHtml() {
  if (viewing()) return "";
  const missing = missingChoices(upcomingOf(state.matches || []), (m) => attendance.get(m.i));
  if (!missing.length) return "";
  const days = missing.map((m) => dayLabel(parseDt(m.s)));
  const list = days.length > 3 ? `${days.slice(0, 3).join(", ")} en ${days.length - 3} meer` : days.join(", ");
  return `<div class="notice fill-warn" role="status"><span><b>${missing.length === 1 ? "1 wedstrijd" : `${missing.length} wedstrijden`} niet ingevuld</b>: ${esc(list)}.</span> <button class="small" id="att-fill">Vul nu in</button></div>`;
}
// Wat teamgenoten veranderd hebben sinds je het laatst zag. De vorige stand staat per team op dit toestel (state.seen)
// en wordt pas bijgewerkt als je de melding wegtikt; een eerste bezoek en nieuwe of verzette wedstrijden zetten we stil als beginstand.
const othersNow = (m) => snapshotOf(currentFor(others?.get(m.i), m).filter((o) => o.uid !== myUid));
function presenceChanges() {
  if (!others || !state.matches) return [];
  const code = groupOf();
  if (!code) return [];
  const seen = state.seen[code] || (state.seen[code] = {});
  const members = new Set(memberList.map((o) => o.uid));
  const out = [];
  let dirty = false;
  const upcoming = upcomingOf(state.matches);
  for (const id of Object.keys(seen)) if (state.matches.some((m) => m.i === id) && !upcoming.some((m) => m.i === id)) { delete seen[id]; dirty = true; }
  for (const m of upcoming) {
    const cur = othersNow(m), base = seen[m.i];
    if (!base || base.s !== m.s) { seen[m.i] = { s: m.s, v: cur }; dirty = true; continue; }
    // wie niet meer in de groep zit (verwijderd of vertrokken) is geen aanwezigheidswijziging
    // (behalve een lid dat onder een nieuw uid terug is, zie presenceDiff)
    const names = new Set(Object.values(cur).map((v) => v[1]));
    const was = Object.fromEntries(Object.entries(base.v).filter(([uid, v]) => members.has(uid) || (!(uid in cur) && names.has(v[1]))));
    const d = presenceDiff(was, cur, !viewing() && state.name && attendance.get(m.i) === "yes" ? 1 : 0);
    if (d.changes.length) out.push({ m, ...d });
  }
  if (dirty) save();
  return out;
}
function presenceHtml() {
  const list = presenceChanges();
  if (!list.length) return "";
  const lines = list.map(({ m, changes, now, dropped }) => {
    const who = changes.map((c) => `${esc(c.name)} ${c.from ? GLYPH[c.from] : GLYPH.open}→${c.to ? GLYPH[c.to] : GLYPH.open}`).join(", ");
    return `<li${dropped ? ' class="drop"' : ""}><b>${esc(dayLabel(parseDt(m.s)))}</b>: ${who}. ${dropped ? `<b>Nu ${now} ja, minimaal ${ENOUGH} nodig.</b>` : `Nu ${now} ja.`}</li>`;
  }).join("");
  const dropped = list.some((x) => x.dropped);
  return `<div class="notice presence${dropped ? " drop" : ""}" role="status"><b>${dropped ? "Let op: te weinig spelers" : "Aanwezigheid gewijzigd"}</b><ul>${lines}</ul><button class="small" id="presence-ok">Gezien</button></div>`;
}
function ackPresence() {
  const code = groupOf();
  if (!code) return;
  const seen = state.seen[code] = {};
  for (const m of upcomingOf(state.matches || [])) seen[m.i] = { s: m.s, v: othersNow(m) };
  save();
  refreshFill();
}
function refreshFill() { const el = $("#fill-warn"); if (el) el.innerHTML = presenceHtml() + fillWarningHtml(); }

const inviteLink = () => `${location.origin}${location.pathname}#groep=${groupOf()}&team=${encodeURIComponent(state.active)}`;

// Delen via het deelmenu van het toestel (WhatsApp enzovoort); zonder deelmenu naar het klembord.
async function shareText(text, title, copied = "Overzicht gekopieerd. Plak het in je teamapp.") {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; }
    catch (e) { if (e.name === "AbortError") return; } // geannuleerd: niets doen
  }
  await navigator.clipboard.writeText(text).then(() => toast(copied), () => prompt("Kopieer:", text));
}

function groupLine() {
  const code = groupOf();
  if (!code) return `<p class="muted share">Zie wie er komt: <button class="link inline" id="g-open">maak een groep of neem deel</button></p>`;
  return `<p class="muted share">${state.shareError ? "Groepsleden laden lukt nu niet. " : ""}Groep <b>${esc(showCode(code))}</b>${viewing() ? " · je kijkt mee" : ""}${memberCount ? ` · ${memberCount} ${memberCount === 1 ? "lid" : "leden"}` : ""} · <button class="link inline" id="g-open">beheer</button></p>`;
}

// Ledenlijst voor het beheerblad: per lid hoeveel komende wedstrijden zijn ingevuld, en een knop om een "spook" te verwijderen.
function membersHtml() {
  if (!memberList.length) return "";
  const upcoming = upcomingOf(state.matches || []);
  const filled = (uid) => upcoming.filter((m) => (uid === myUid ? attendance.get(m.i) : currentFor(others?.get(m.i), m).some((o) => o.uid === uid))).length;
  const rows = [...memberList].sort((a, b) => byName(a.name || "", b.name || "")).map((o) => {
    const me = o.uid === myUid;
    const n = filled(o.uid);
    const count = !others || !upcoming.length ? "" : n ? `${n} van ${upcoming.length} ingevuld` : "nog niets ingevuld";
    return `<li><span class="m-name">${esc(me ? state.name : o.name || "?")}${me ? ` <span class="muted">(jij)</span>` : ""}</span><span class="muted m-count">${count}</span>${me ? "" : `<span class="m-act"><button class="link" data-restore="${esc(o.uid)}" aria-label="Kopieer herstel-link voor ${esc(o.name || "dit lid")}">Herstel-link</button><button class="link" data-remove="${esc(o.uid)}" aria-label="Verwijder ${esc(o.name || "dit lid")} uit de groep">Verwijder</button></span>`}</li>`;
  }).join("");
  return `<h4 class="m-head">Leden (${memberList.length})</h4>
    <ul class="members">${rows}</ul>
    <p class="muted hint">Is iemand zijn toestel kwijt? Kopieer de herstel-link van dat lid en stuur hem door. Staat iemand dubbel of is iemand gestopt? Verwijder dat lid; de keuzes verdwijnen uit de groep. Wie de app nog gebruikt, komt vanzelf terug.</p>`;
}

function groupDialogHtml(prefill = "", prefillName = "") {
  const code = groupOf();
  const nameField = `<label class="field">Je naam<input id="g-name" type="text" maxlength="30" autocomplete="given-name" value="${esc(prefillName || state.name)}" placeholder="Bijvoorbeeld Axel"></label>`;
  const head = `<div class="sheet-head"><h3 id="group-title">${code ? "Je groep" : "Aanwezigheid delen"}</h3><button class="star" id="g-close" aria-label="Sluiten">${ico.close}</button></div>`;
  if (code) return `${head}
    <p class="muted">Deel deze code met je teamgenoten. Iedereen die de code heeft, kan de groep zien en meedoen.</p>
    <p class="code" aria-label="Groepscode">${esc(showCode(code))}</p>
    <div class="row2"><button id="g-copy">${ico.link} Kopieer code</button><button id="g-link">${ico.link} Kopieer link</button></div>
    <button id="g-share"${upcomingOf(state.matches || []).length ? "" : " disabled"}>${ico.share} Deel wie er komt</button>
    <p class="muted hint">Een tekstoverzicht van de komende wedstrijden voor in je teamapp, met wie nog niet heeft gereageerd.</p>
    ${viewing() ? "" : `<button id="g-forward"${upcomingMine().length ? "" : " disabled"}>${ico.share} Stuur je keuzes door</button>
    <p class="muted hint">Een link met jouw keuzes voor de komende wedstrijden. Wie hem opent, neemt ze in één keer over, handig als je altijd samen gaat.</p>`}
    ${state.name ? `<button id="g-sub">Voeg een teamgenoot toe</button>
    <p class="muted hint">Voor wie (nog) geen eigen toestel heeft: jij meldt die teamgenoot aanwezig bij de wedstrijden waar die bij is. Daarna geef je de herstel-link uit de ledenlijst; wie die opent, neemt de keuzes over.</p>` : ""}
    ${membersHtml()}
    ${viewing() ? "" : `<h4 class="m-head">Voor jezelf</h4>
    <button id="g-restore">${ico.link} Kopieer herstel-link</button>
    <p class="muted hint">Bewaar deze link in je notities. Op een nieuw toestel, of als de browser je gegevens heeft gewist, opent hij je team en groep met je naam, en neem je je eerdere keuzes over.</p>`}
    ${viewing() ? `<p class="muted">Je kijkt alleen mee. Vul je naam in om zelf je aanwezigheid door te geven.</p>` : ""}
    ${nameField}<button id="g-rename">${viewing() ? "Meedoen met naam" : "Naam opslaan"}</button>
    <p id="g-err" class="notice" role="alert" hidden></p>
    <button class="link" id="g-leave">Groep verlaten</button>`;
  if (prefill) return `<div class="sheet-head"><h3 id="group-title">Deelnemen aan de groep</h3><button class="star" id="g-close" aria-label="Sluiten">${ico.close}</button></div>
    <p class="muted">Je bent uitgenodigd voor een groep. Vul je naam in om mee te doen; zonder naam kijk je alleen mee.</p>
    ${pendingProposal ? `<p class="muted">${pendingProposal.from ? esc(pendingProposal.from) + " stuurde" : "Er zijn"} ook keuzes mee die je overneemt; aanpassen kan daarna per wedstrijd.</p><ul class="proposal">${proposalLines(pendingProposal.items)}</ul>` : ""}
    ${nameField}
    <label class="field">Groepscode<input id="g-code" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(prefill)}"></label>
    <button class="btn primary" id="g-join">${prefillName || state.name ? "Deelnemen" : "Alleen kijken"}</button>
    <p id="g-err" class="notice" role="alert" hidden></p>`;
  return `${head}
    <p class="muted">Je keuzes zijn dan zichtbaar voor je teamgenoten. Zonder naam kun je alleen meekijken. Er is geen account; de code van de groep is de enige beveiliging.</p>
    ${nameField}
    <button class="btn primary" id="g-create">Nieuwe groep maken</button>
    <label class="field">Of neem deel met een code<input id="g-code" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="XXXXX-XXXXX"></label>
    <button id="g-join">${state.name ? "Deelnemen" : "Alleen kijken"}</button>
    <p id="g-err" class="notice" role="alert" hidden></p>`;
}

// Teamgenoot toevoegen: naam en per komende wedstrijd een vinkje (alleen aanwezig); komt in hetzelfde blad.
function subFormHtml() {
  const team = teamIndex.get(state.active);
  const rows = upcomingOf(state.matches || []).map((m) => {
    const { isHome, opp } = sideOf(m, team);
    const d = parseDt(m.s);
    return `<label class="sub-row"><input type="checkbox" data-sub-m="${esc(m.i)}"><span>${esc(dayLabel(d))} ${fTime.format(d)} · ${esc(opp ? `${isHome ? "thuis" : "uit"} tegen ${opp}` : m.t)}</span></label>`;
  }).join("");
  return `<div class="sheet-head"><h3 id="group-title">Teamgenoot toevoegen</h3><button class="star" id="g-close" aria-label="Sluiten">${ico.close}</button></div>
    <label class="field">Naam<input id="g-name" type="text" maxlength="30" autocomplete="off" placeholder="Bijvoorbeeld Jitse"></label>
    ${rows ? `<p class="muted">Vink de wedstrijden aan waar die teamgenoot bij is.</p>${rows}` : `<p class="muted">Er zijn geen komende wedstrijden geladen. Je kunt de teamgenoot toch toevoegen.</p>`}
    <button id="g-sub-save">Toevoegen</button><button class="link" id="g-sub-back">Terug</button>
    <p id="g-err" class="notice" role="alert" hidden></p>`;
}

let linkName = "", linkId = ""; // naam en lid-id uit een herstel-link die het deelnemen-blad heeft ingevuld
function openGroupDialog(prefill = "", prefillName = "", prefillId = "") {
  const dlg = $("#group-dlg");
  if (!dlg) return;
  linkName = prefillName; linkId = prefillName ? prefillId : "";
  dlg.innerHTML = groupDialogHtml(prefill, prefillName);
  if (!dlg.open) (dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", ""));
  if (prefill) (prefillName ? $("#g-join") : $("#g-name"))?.focus(); // met naam uit de link hoef je alleen te bevestigen
}

// Deelnemen met een naam die al in de groep staat onder een ander toestel: waarschijnlijk jijzelf, na verlies van je opslag
// (nieuw toestel, browsergegevens gewist). Vraagt het, neemt dan de keuzes voor komende wedstrijden over (wat al op dit toestel
// staat gaat voor) en ruimt het oude lid op. Een herstel-link bevat het id van het oude lid: dan nemen we precies dat lid over
// zonder te vragen, en nooit een andere teamgenoot met dezelfde naam. Geeft terug of er iets is overgenomen.
const sameName = (a, b) => a.localeCompare(b, "nl", { sensitivity: "base" }) === 0;
async function claimGhost(code, name, fromId = "") {
  const uid = await shared.myUid();
  const members = await shared.members(code);
  const ghosts = fromId
    ? members.filter((o) => o.uid === fromId && o.uid !== uid && o.name && sameName(o.name, name))
    : members.filter((o) => o.uid && o.uid !== uid && o.name && sameName(o.name, name));
  if (!ghosts.length) return false;
  if (!fromId && !confirm(`Er doet al een ${ghosts[0].name} mee in deze groep, vanaf een ander toestel. Ben jij dat? Dan nemen we die keuzes over en verdwijnt het oude lid.`)) return false;
  const from = new Date(Date.now() - 864e5).toISOString().slice(0, 10).replace(/-/g, "");
  await matchesLoaded;
  const program = state.matches ? new Map(state.matches.map((m) => [m.i, m])) : null; // zonder programma (offline) kunnen we de start niet controleren
  for (const g of ghosts) {
    for (const r of await shared.rsvpsOf(code, g.uid)) {
      if (!r.match || !r.status || (r.start || "") < from || attendance.get(r.match)) continue;
      const m = program?.get(r.match);
      if (program && !(m && sameStart(r.start, m.s))) continue; // wedstrijd verzet of niet meer in het programma: de keuze geldt niet meer
      attendance.set(r.match, r.status, r.start);
    }
    await shared.removeMember(code, g.uid);
  }
  return true;
}

// Namen in een groep zijn uniek: staat er (na het eventuele overnemen) nog een andere teamgenoot met jouw naam, dan word je "Naam 2".
// Geeft de naam terug die je nu in de groep hebt.
async function ensureUniqueName(code, name) {
  const uid = await shared.myUid();
  const taken = (await shared.members(code)).filter((o) => o.uid !== uid && o.name).map((o) => o.name);
  if (!taken.some((t) => sameName(t, name))) return name;
  for (let n = 2; ; n++) {
    const base = name.slice(0, 30 - String(n).length - 1).trimEnd();
    const cand = `${base} ${n}`;
    if (!taken.some((t) => sameName(t, cand))) {
      await shared.rename(code, cand);
      state.name = cand; save();
      return cand;
    }
  }
}

// Vraag de browser onze opslag niet op te ruimen. Chrome en Safari beslissen stil (geïnstalleerd of veel gebruikt = ja);
// Firefox vraagt het de gebruiker. Zonder groep maakt verlies weinig uit, dus alleen dan.
function persistStorage() {
  if (!Object.keys(state.groups).length) return;
  navigator.storage?.persist?.().catch(() => {});
}

// Na maken, deelnemen of wijzigen: blad sluiten en meteen de nieuwe stand tonen; delen gebeurt op de achtergrond.
function afterGroupChange(reopen = false, enter = false) {
  $("#group-dlg")?.close?.();
  resetShared();
  persistStorage();
  showInstall(); // de hint vertelt nu ook dat je groep als app bewaard blijft
  if (enter) { // na maken of deelnemen meteen de keuzeknoppen bij alle wedstrijden openen
    entering = true;
    editing = null;
    renderMatches();
  } else refreshShared();
  if (reopen) openGroupDialog();
  else $("#g-open")?.focus();
  Promise.all(upcomingMine().map(pushMine)).catch(() => toast("Delen met je team is niet gelukt. Je keuzes staan wel op dit toestel.")).then(loadOthers);
}

// Eén knop in het blad: toont een fout in het blad zelf.
async function groupAction(btn, fn) {
  const err = $("#g-err");
  const name = ($("#g-name")?.value || "").trim().slice(0, 30);
  if (err) err.hidden = true;
  btn.disabled = true;
  try { await fn(name); }
  catch (e) {
    err.textContent = e.message === "notfound" ? "Die code bestaat niet. Controleer hem en probeer opnieuw." : e.message === "name" ? (document.querySelector("#g-sub-save") ? "Vul de naam in." : "Vul eerst je naam in.") : e.message === "code" ? "Een code heeft 10 tekens (letters en cijfers)." : e.message === "dup" ? "Er staat al een lid met die naam in de groep." : "Het is niet gelukt. Controleer je verbinding en probeer het opnieuw.";
    if (err) err.hidden = false; else toast("Het is niet gelukt. Probeer het opnieuw.");
  } finally { btn.disabled = false; }
}

async function onGroupClick(e) {
  const dlg = e.currentTarget;
  if (e.target === dlg || e.target.closest("#g-close")) return dlg.close();
  const btn = e.target.closest("button");
  const id = btn?.id;
  if (id === "g-create") groupAction(btn, async (name) => {
    if (!name) throw new Error("name");
    const code = shared.newCode();
    await shared.createGroup(code, name, teamIndex.get(state.active));
    state.name = name; state.groups[state.active] = code; delete state.watch[state.active]; save();
    toast("Groep gemaakt. Deel de code met je team.");
    afterGroupChange(true, true);
  });
  else if (id === "g-join") groupAction(btn, async (name) => {
    const code = shared.cleanCode($("#g-code").value);
    if (!shared.validCode(code)) throw new Error("code");
    await shared.joinGroup(code, name); // zonder naam: alleen controleren dat de groep bestaat
    state.groups[state.active] = code;
    if (name) { state.name = name; delete state.watch[state.active]; } else state.watch[state.active] = true;
    save();
    const claimed = name ? await claimGhost(code, name, linkName === name ? linkId : "").catch(() => { toast("Keuzes overnemen is niet gelukt. Verwijder het oude lid onder beheer."); return false; }) : false;
    const was = name;
    if (name) name = await ensureUniqueName(code, name).catch(() => name);
    const renamed = name !== was;
    const proposed = name && pendingProposal ? await applyProposal() : 0; // meegestuurde keuzes gaan voor
    if (proposed) save();
    toast(renamed ? `Er doet al een ${was} mee; jij staat in de groep als ${name}. Aanpassen kan onder beheer.` : proposed ? `Je doet mee. ${proposed} ${proposed === 1 ? "keuze" : "keuzes"} overgenomen; klopt het niet, pas het aan.` : claimed ? "Welkom terug. Je eerdere keuzes zijn overgenomen." : name ? "Je doet mee met de groep. Geef je aanwezigheid door." : "Je kijkt mee. Vul later een naam in om mee te doen.");
    pendingProposal = null;
    afterGroupChange(false, !!name && (!claimed || !!proposed));
  });
  else if (id === "g-rename") groupAction(btn, async (name) => {
    if (!name) throw new Error("name");
    const wasViewing = viewing();
    const code = groupOf();
    await shared.rename(code, name);
    state.name = name; delete state.watch[state.active]; save();
    const claimed = await claimGhost(code, name).catch(() => { toast("Keuzes overnemen is niet gelukt. Verwijder het oude lid onder beheer."); return false; });
    const was = name;
    name = await ensureUniqueName(code, name).catch(() => name);
    toast(name !== was ? `Er doet al een ${was} mee; jij staat in de groep als ${name}.` : claimed ? "Welkom terug. Je eerdere keuzes zijn overgenomen." : wasViewing ? "Je doet mee. Geef je aanwezigheid door." : "Naam opgeslagen.");
    afterGroupChange(false, wasViewing && !claimed);
  });
  else if (id === "g-copy" || id === "g-link" || id === "g-restore") {
    const code = groupOf();
    const text = id === "g-copy" ? showCode(code) : id === "g-link" ? inviteLink() : `${inviteLink()}&naam=${encodeURIComponent(state.name)}&id=${encodeURIComponent(myUid || await shared.myUid().catch(() => ""))}`;
    navigator.clipboard.writeText(text).then(() => toast(id === "g-copy" ? "Code gekopieerd." : id === "g-link" ? "Link gekopieerd." : "Herstel-link gekopieerd. Bewaar hem in je notities."), () => prompt("Kopieer:", text));
  } else if (id === "g-sub") { dlg.innerHTML = subFormHtml(); $("#g-name")?.focus(); }
  else if (id === "g-sub-back") { dlg.innerHTML = groupDialogHtml(); $("#g-sub")?.focus(); }
  else if (id === "g-sub-save") groupAction(btn, async (name) => {
    if (!name) throw new Error("name");
    const current = await shared.members(groupOf()); // vers ophalen: memberList kan verouderd zijn
    if (current.some((o) => o.name && sameName(o.name, name))) throw new Error("dup");
    const byId = new Map((state.matches || []).map((m) => [m.i, m]));
    const picks = [...dlg.querySelectorAll("[data-sub-m]")].filter((s) => s.checked).map((s) => ({ match: s.dataset.subM, start: byId.get(s.dataset.subM)?.s || "", status: "yes" }));
    const uid = await shared.addProxyMember(groupOf(), name, picks);
    memberList = [...current, { uid, name }];
    memberCount = memberList.length;
    toast(`${name} is toegevoegd. Geef ${name} de herstel-link uit de ledenlijst.`);
    dlg.innerHTML = groupDialogHtml();
    $("#g-sub")?.focus();
    loadOthers();
  });
  else if (id === "g-share") shareText(overviewText(teamIndex.get(state.active)), "Wie komt er?");
  else if (id === "g-forward") shareText(forwardText(teamIndex.get(state.active)), "Mijn aanwezigheid", "Je keuzes zijn gekopieerd. Plak ze in je teamapp.");
  else if (id === "p-skip") { pendingProposal = null; dlg.close(); }
  else if (id === "p-accept") groupAction(btn, async () => {
    const n = await applyProposal();
    save();
    toast(n ? `${n} ${n === 1 ? "keuze" : "keuzes"} overgenomen. Klopt het niet? Pas het hieronder aan.` : "Deze wedstrijden staan niet (meer) in het programma.");
    afterGroupChange(false, !!n);
  });
  else if (btn?.dataset.restore) { // herstel-link voor een teamgenoot die zijn toestel of opslag kwijt is
    const o = memberList.find((m) => m.uid === btn.dataset.restore);
    if (!o) return;
    const text = `${inviteLink()}&naam=${encodeURIComponent(o.name || "")}&id=${encodeURIComponent(o.uid)}`;
    navigator.clipboard.writeText(text).then(() => toast(`Herstel-link voor ${o.name || "dit lid"} gekopieerd. Stuur hem naar ${o.name || "dit lid"}.`), () => prompt("Kopieer:", text));
  }
  else if (btn?.dataset.remove) groupAction(btn, async () => {
    const uid = btn.dataset.remove;
    const who = memberList.find((o) => o.uid === uid)?.name || "dit lid";
    if (!confirm(`${who} uit de groep verwijderen? De keuzes van ${who} verdwijnen uit de groep. Gebruikt ${who} de app nog, dan verschijnt ${who} vanzelf weer.`)) return;
    await shared.removeMember(groupOf(), uid);
    memberList = memberList.filter((o) => o.uid !== uid);
    memberCount = memberList.length;
    for (const list of others?.values() || []) { const i = list.findIndex((o) => o.uid === uid); if (i >= 0) list.splice(i, 1); }
    toast(`${who} is uit de groep verwijderd.`);
    openGroupDialog(); // blad opnieuw tekenen met de nieuwe lijst
    refreshShared();
  });
  else if (id === "g-leave") groupAction(btn, async () => {
    if (!confirm("Groep verlaten? Je keuzes verdwijnen uit de groep; op dit toestel blijven ze staan.")) return;
    const code = groupOf();
    await shared.leaveGroup(code);
    delete state.groups[state.active]; delete state.watch[state.active]; save();
    resetShared();
    dlg.close();
    refreshShared();
    showInstall(); // zonder groep weer de gewone installeerhint
    $("#g-open")?.focus();
  });
}

function programHtml(team) {
  const upcoming = upcomingOf(state.matches || []);
  return `<section class="card flat">
    <h3 class="sr-only">Komende wedstrijden</h3>
    ${problem()}${loading()}
    ${state.matches && !upcoming.length ? `<p class="muted">Geen komende wedstrijden. Het programma volgt later.</p>` : ""}
    ${upcoming.length ? modeBar() : shared.enabled ? groupLine() : ""}
    <div id="fill-warn">${presenceHtml()}${fillWarningHtml()}</div>
    ${upcoming.map((m) => matchRow(m, team)).join("")}
  </section>`;
}

// Uitslagen vanuit het eigen team bekeken: tegenstander als hoofdregel, eigen score eerst.
function resultSide(r, team) {
  const me = norm(team.naam);
  const idx = r.k ? r.k.indexOf(state.active) : -1; // liefst op team-sleutel, anders op naam
  const isHome = idx >= 0 ? idx === 0 : norm(r.t[0]) === me;
  const isAway = idx >= 0 ? idx === 1 : norm(r.t[1]) === me;
  return { isHome, isAway, won: (isHome || isAway) && Number(r.e[isHome ? 0 : 1]) > Number(r.e[isHome ? 1 : 0]) };
}

function resultRow(r, team) {
  const { isHome, isAway, won } = resultSide(r, team);
  const day = new Date(r.s);
  const when = (ha = "") => `<div class="when"><div class="d">${esc(dayLabel(day))}</div>${r.c ? `<div class="t">${esc(r.c)}</div>` : ""}${ha}</div>`;
  if (!isHome && !isAway) { // zou niet moeten voorkomen: toon dan de ruwe uitslag
    return `<div class="match result">${when()}<div class="what"><div class="vs">${esc(r.t.join(" – "))}</div></div><div class="score"><div class="sc">${Number(r.e[0])}–${Number(r.e[1])}</div></div></div>`;
  }
  const mine = Number(r.e[isHome ? 0 : 1]), theirs = Number(r.e[isHome ? 1 : 0]);
  const opp = r.t[isHome ? 1 : 0];
  const sets = r.z.map(([x, y]) => `<span>${isHome ? `${Number(x)}-${Number(y)}` : `${Number(y)}-${Number(x)}`}</span>`).join(" ");
  return `
    <div class="match result ${won ? "win" : "loss"}" role="group" aria-label="${won ? "Gewonnen" : "Verloren"} met ${mine}–${theirs} ${isHome ? "thuis" : "uit"} tegen ${esc(opp)}">
      ${when(`<div class="ha"><span class="tag ${isHome ? "home" : "away"}">${isHome ? "thuis" : "uit"}</span></div>`)}
      <div class="what">
        <div class="vs"><span>${esc(opp)}</span></div>
        <div class="where sets">${sets}</div>
      </div>
      <div class="score ${won ? "win" : "loss"}">
        <div class="sc">${mine}–${theirs}</div>
        <div class="wl"><span aria-hidden="true">${won ? "✓" : "✕"}</span> ${won ? "winst" : "verlies"}</div>
      </div>
    </div>`;
}

function resultsHtml(team) {
  return `<section class="card">
    <h3 class="sr-only">Uitslagen</h3>
    ${problem()}${loading()}
    ${state.matches && !state.results.length ? `<p class="muted">Nog geen uitslagen dit seizoen.</p>` : ""}
    ${state.results.length ? `<p class="summary">${state.results.length} gespeeld · ${state.results.filter((r) => resultSide(r, team).won).length} gewonnen</p>` : ""}
    ${state.results.map((r) => resultRow(r, team)).join("")}
  </section>`;
}

function standHtml(team) {
  if (state.matches === null && !state.error) return `<section class="card"><p class="muted">Laden…</p></section>`;
  if (state.error) return `<section class="card">${problem()}</section>`;
  if (!state.poules.length) return `<section class="card"><p class="muted">Er is nog geen stand: de competitie is nog niet gestart.</p></section>`;
  if (state.tables === null) return `<section class="card"><p class="muted">Stand laden…</p></section>`;
  if (!state.tables.some(Boolean)) return `<section class="card"><p class="muted">De stand is nu niet beschikbaar. Probeer het later opnieuw.</p></section>`;
  return state.tables.filter(Boolean).map((t) => `
    <section class="card">
      <h3>${t.cup && !/^beker/i.test(t.n) ? "Beker · " : ""}${esc(t.n)}</h3>
      <div class="table-wrap" role="region" tabindex="0" aria-label="Stand ${esc(t.n)}">
        <table class="stand">
          <caption class="sr-only">Stand ${esc(t.n)}</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col">Gesp.</th><th scope="col">Pnt</th><th scope="col">Sets</th></tr></thead>
          <tbody>${t.r.map(([pos, key, naam, gs, pt, sv, st]) => `<tr${key === state.active ? ' class="me" aria-current="true"' : ""}><td>${Number(pos) || "–"}</td><td>${esc(naam)}</td><td>${Number(gs)}</td><td>${Number(pt)}</td><td>${Number(sv)}-${Number(st)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
      <p class="muted legend">Gesp. = gespeeld · Pnt = punten · Sets = gewonnen-verloren</p>
    </section>`).join("");
}

async function loadTables() {
  if (state.tables !== null || !state.poules.length) return;
  const key = state.active;
  const list = await Promise.all(state.poules.map((slug) => fetch(`data/p/${slug}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  if (state.active !== key) return;
  state.tables = list;
  if (state.tab === "stand" && !state.searching) $("#matches").innerHTML = standHtml(teamIndex.get(key));
}

// Eigen keuzes voor wedstrijden die van starttijd veranderd zijn wissen: de speler heeft die nieuwe tijd nooit gezien.
// Het document in de groep ruimt reconcile daarna op. Alleen wedstrijden van het geladen team tellen mee.
function dropStale() {
  const ids = staleIds(state.att, state.matches);
  if (!ids.length) return;
  for (const id of ids) delete state.att[id];
  save();
  toast(ids.length === 1 ? "Een wedstrijd is verzet. Kies opnieuw of je erbij bent." : `${ids.length} wedstrijden zijn verzet. Kies opnieuw of je erbij bent.`);
}

let matchesLoaded = Promise.resolve(); // laatste loadMatches, om op te wachten
function loadMatches() { return (matchesLoaded = loadMatchesNow()); }
async function loadMatchesNow() {
  state.matches = null;
  state.error = "";
  const key = state.active;
  if (!state.searching) renderMatches();
  try {
    const res = await fetch(`data/t/${key.replace(/\//g, "-")}.json`, { cache: "no-cache" });
    if (res.status === 404) state.matches = [];
    else if (!res.ok) throw new Error();
    else {
      const j = await res.json();
      if (state.active !== key) return; // ondertussen een ander team gekozen
      // Een kapot item (zonder geldige datum) mag niet de hele lijst laten crashen.
      state.matches = (j.m || []).filter((m) => !isNaN(parseDt(m.s)));
      state.results = (j.r || []).filter((r) => !isNaN(new Date(r.s)));
      state.poules = j.p || [];
      dropStale();
    }
  } catch {
    state.error = "Geen internet, en dit team heb je nog niet eerder geopend. Probeer het opnieuw zodra je weer verbinding hebt.";
  }
  if (state.active === key && !state.searching) renderMatches();
  if (state.matches?.length) loadOthers();
  if (state.matches && !upcomingOf(state.matches).length) adoptSibling(key).catch(() => {});
}

// ---- Vereniging: alle thuiswedstrijden van alle teams ----
let clubToken = 0;
async function renderClub() {
  const name = state.club;
  const token = ++clubToken;
  const teams = teamList.filter((t) => t.club === name);
  view.innerHTML = `
    <section class="card">
      <button class="link back" id="club-back">‹ Terug naar ${esc(teamIndex.get(state.active)?.naam || "mijn team")}</button>
      <div class="team-head">
        <div>
          <h2 id="team-name" tabindex="-1">${esc(name)}</h2>
          <p class="muted">Thuiswedstrijden van ${teams.length} ${teams.length === 1 ? "team" : "teams"}</p>
        </div>
      </div>
    </section>
    <section class="card" id="club-matches"><p class="muted">Laden…</p></section>`;
  $("#club-back").addEventListener("click", () => { state.club = null; render(); $("#club")?.focus(); });
  $("#team-name").focus({ preventScroll: true });
  const seen = new Map();
  let failed = 0;
  await Promise.all(teams.map(async (t) => {
    try {
      const res = await fetch(`data/t/${t.key.replace(/\//g, "-")}.json`, { cache: "no-cache" });
      if (res.status === 404) return;
      if (!res.ok) throw new Error();
      const j = await res.json();
      const me = norm(t.naam);
      for (const m of j.m || []) {
        const [home] = m.t.split(" - ");
        if (norm(home || "") === me && !isNaN(parseDt(m.s))) seen.set(m.i, m);
      }
    } catch { failed++; }
  }));
  if (token !== clubToken || state.club !== name) return;
  const list = upcomingOf([...seen.values()]).sort((a, b) => parseDt(a.s) - parseDt(b.s));
  const rows = list.map((m) => {
    const [home, away] = m.t.split(" - ");
    const d = parseDt(m.s);
    const place = m.l ? `<div class="where"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.l)}" target="_blank" rel="noopener">${esc(shortPlace(m.l))}</a></div>` : "";
    return `<div class="match club-match${isToday(d) ? " today" : ""}">
      <div class="when"><div class="d">${isToday(d) ? "vandaag" : esc(dayLabel(d))}</div><div class="t">${esc(fTime.format(d))}</div></div>
      <div class="what"><div class="vs">${esc(home)}</div><div class="muted">tegen ${esc(away || "?")}</div>${place}</div>
      <button class="small icon" data-add="${esc(m.i)}" title="Zet in je agenda" aria-label="Zet ${esc(m.t)} in je agenda">${ico.calPlus}</button>
    </div>`;
  }).join("");
  const box = $("#club-matches");
  box.innerHTML = `<h3>Komende thuiswedstrijden</h3>
    ${failed ? `<p class="notice">Het programma van ${failed} ${failed === 1 ? "team" : "teams"} is nu niet beschikbaar. Probeer het later opnieuw.</p>` : ""}
    ${list.length ? rows : failed ? "" : `<p class="muted">Geen komende thuiswedstrijden.</p>`}`;
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-add]");
    const m = b && seen.get(b.dataset.add);
    if (!m) return;
    download(`${slug(m.t)}-${m.s.slice(0, 8)}.ics`, calendar(m.t, [m]));
    toast("Open het bestand om de wedstrijd toe te voegen.");
  });
}

let pendingCode = ""; // code uit een uitnodigingslink die wacht tot er een team gekozen is
let pendingName = "", pendingId = ""; // naam en lid-id uit een herstel-link

function offerPendingJoin() {
  if (!pendingCode || !shared.enabled || !state.active || state.searching) return;
  const code = pendingCode, name = pendingName, id = pendingId;
  pendingCode = pendingName = pendingId = "";
  if (groupOf()) return toast("Je zit al in een groep voor dit team.");
  openGroupDialog(showCode(code), name, id);
}

// Favoriet, groep en 'alleen kijken' van de ene teamsleutel naar de andere verhuizen. Bestaat bij de nieuwe sleutel al een groep, dan blijft die
// en blijft de oude groep staan (anders raak je een groepscode kwijt). Onthoudt de oude sleutel in state.moved. Geeft terug wat er verhuisd is.
function moveTeam(from, to) {
  const hadGroup = !!state.groups[from];
  let groupMoved = false;
  if (from === to) return { hadGroup, groupMoved };
  state.favs = [...new Set(state.favs.map((k) => (k === from ? to : k)))];
  if (hadGroup && !state.groups[to]) {
    state.groups[to] = state.groups[from]; if (state.watch[from]) state.watch[to] = true;
    delete state.groups[from]; delete state.watch[from];
    groupMoved = true;
  }
  delete state.names[from];
  state.moved[from] = to;
  if (state.active === from) state.active = to;
  save();
  rememberNames();
  return { hadGroup, groupMoved };
}

// Melding na een verhuizing: noemt de oude code, en zegt alleen dat de groep is meeverhuisd als dat zo is.
function movedToast(from, to, { hadGroup, groupMoved }) {
  const name = teamIndex.get(to)?.naam || "Je team";
  const base = `Nevobo heeft ${name} een nieuwe teamcode gegeven (was ${from}). `;
  toast(base + (groupMoved ? "Je favoriet en je groep zijn meeverhuisd." : hadGroup ? "Je favoriet is meeverhuisd; je groep staat nog bij de oude code." : "Je favoriet is meeverhuisd."));
}

// Staat het programma van dit team klaar, en zijn er komende wedstrijden? ok = false als het ophalen mislukte (geen 404): dat is iets anders dan leeg.
async function programOf(team) {
  try {
    const res = await fetch(`data/t/${team.key.replace(/\//g, "-")}.json`, { cache: "no-cache" });
    if (res.status === 404) return { ok: true, upcoming: false };
    if (!res.ok) return { ok: false };
    const j = await res.json();
    return { ok: true, upcoming: upcomingOf((j.m || []).filter((m) => !isNaN(parseDt(m.s)))).length > 0 };
  } catch { return { ok: false }; }
}

// Naar welk team moet `oldKey` ({ naam, club }) verhuizen? Alleen als alles klopt: precies één team met dezelfde naam, club en type dat komende
// wedstrijden heeft (en alle kandidaten konden geladen worden), en bij een groep: er is bij het doel nog geen groep en het groepsdocument noemt
// hetzelfde team. Bij twijfel doen we niets. { target } of { uncertain: true } (iets kon niet geladen worden) of {}.
async function resolveMove(oldKey, was) {
  if (state.noAdopt[oldKey]) return {};
  const cands = candidatesFor(teamList, { naam: was.n, club: was.c, type: keyType(oldKey) }, oldKey);
  if (!cands.length || cands.length > 5) return {};
  const programs = new Map(await Promise.all(cands.map(async (t) => [t.key, await programOf(t)])));
  const pick = pickTarget(cands, programs);
  if (!pick.target) return pick;
  const code = state.groups[oldKey];
  if (code) {
    if (!shared.enabled) return {}; // zonder Firebase kunnen we de groep niet bevestigen: niets doen
    if (state.groups[pick.target.key]) return {}; // het doel heeft hier al een groep: niets doen
    let info;
    try { info = await shared.groupInfo(code); } catch { return { uncertain: true }; }
    if (!groupConfirms(info, pick.target)) return {};
  }
  return pick;
}

// Sleutels die in migrateMissing niet te beoordelen waren (iets kon niet geladen worden): render() schrapt die favoriet dan niet.
const uncertainKeys = new Set();

// Is de sleutel van een favoriet of groep uit de teamlijst verdwenen? Zoek het team op naam en club (lokaal bewaard, anders uit het groepsdocument).
async function migrateMissing() {
  for (const old of [...new Set([...state.favs, ...(state.active ? [state.active] : []), ...Object.keys(state.groups)])]) {
    if (teamIndex.has(old)) continue;
    let was = state.names[old];
    if (!was && state.groups[old] && shared.enabled) { // naam niet bewaard op dit toestel: de groep weet het
      try {
        const info = await shared.groupInfo(state.groups[old]);
        if (info?.naam) was = { n: info.naam, c: info.club || "" };
      } catch { uncertainKeys.add(old); continue; }
    }
    if (!was) continue;
    const pick = await resolveMove(old, was);
    if (pick.uncertain) uncertainKeys.add(old);
    if (!pick.target) continue;
    movedToast(old, pick.target.key, moveTeam(old, pick.target.key));
  }
}

// Heeft dit team (dat geladen is en geen komende wedstrijden heeft) een dubbelganger met dezelfde naam, club en type die die wel heeft?
// Dan hing je favoriet aan een oude, lege sleutel (zoals bij Bernisse HS 2). Alleen het actieve team; zie resolveMove voor de voorwaarden.
async function adoptSibling(key) {
  const me = teamIndex.get(key);
  if (!me || !state.favs.includes(key) || state.active !== key) return;
  const pick = await resolveMove(key, { n: me.naam, c: me.club });
  if (!pick.target || state.active !== key || !state.favs.includes(key)) return; // intussen een ander team gekozen of de ster weggehaald
  movedToast(key, pick.target.key, moveTeam(key, pick.target.key));
  render();
}

function selectTeam(key, makeFav = true) {
  if (state.moved[key]) state.noAdopt[key] = true; // zelf gekozen, terwijl we het naar een nieuwe sleutel verhuisd hadden: niet steeds opnieuw verhuizen
  state.active = key;
  state.club = null;
  state.searching = false;
  state.query = "";
  state.tab = "programma";
  const added = makeFav && !state.favs.includes(key);
  if (added) state.favs.push(key); // gekozen team wordt je favoriet
  save();
  rememberNames();
  render();
  $("#team-name")?.focus({ preventScroll: true });
  if (added) toast("Opgeslagen als je team (ster). Tik op de ster om te verwijderen.");
  offerPendingJoin();
}

// Een teamlijst met minder teams dan dit beschouwen we als onvolledig (mislukte of afgekapte download): dan schrappen we niets.
const MIN_TEAMS = 500;

// Het team staat niet in de (mogelijk onvolledige) teamlijst en we kunnen niet zeker weten of het echt weg is: niets gewist, wel een uitleg.
function renderMissing(old) {
  const name = state.names[old]?.n || old, code = state.groups[old];
  view.innerHTML = `<section class="card">
    <h2>Team niet gevonden</h2>
    <p class="muted">${esc(name)} staat nu niet in de teamlijst, of de controle lukte niet. Je favoriet${code ? ` en je groep (${esc(showCode(code))})` : ""} zijn niet gewist.</p>
    <div class="row"><button class="primary" id="missing-retry">Opnieuw proberen</button><button id="missing-search">Zoek een team</button></div>
  </section>`;
  $("#missing-retry").addEventListener("click", () => location.reload());
  $("#missing-search").addEventListener("click", () => { state.searching = true; renderSearch(); });
}

function render() {
  if (state.active && !teamIndex.has(state.active)) { // sleutel bestaat niet in de teamlijst (nieuw seizoen of door Nevobo veranderd)
    const old = state.active;
    // Alleen schrappen als de lijst betrouwbaar is en migrateMissing de sleutel kon beoordelen. Anders blijven favoriet en groep staan.
    if (teamList.length < MIN_TEAMS || uncertainKeys.has(old)) return renderMissing(old);
    state.favs = state.favs.filter((k) => k !== old);
    state.active = state.favs[0] || null;
    save();
    const code = state.groups[old];
    toast(`${state.names[old] ? state.names[old].n : "Je team"} staat niet meer in de teamlijst. Zoek het team opnieuw${code ? `; je groepscode ${showCode(code)} blijft bewaard (plak hem op het zoekscherm)` : ""}.`);
  }
  if (state.searching || !state.active) return renderSearch();
  if (state.club) return renderClub();
  state.matches = null;
  state.results = [];
  state.poules = [];
  state.tables = null;
  state.error = "";
  resetShared();
  editing = null;
  entering = false;
  renderTeam();
  loadMatches();
}

async function main() {
  attendance.prune();
  view.innerHTML = `<p class="muted">Teams laden…</p>`;
  try { await loadTeams(); }
  catch {
    view.innerHTML = `<p class="notice">De teamlijst kon niet geladen worden. Controleer je verbinding en probeer het opnieuw.</p><button id="again" class="primary">Opnieuw proberen</button>`;
    $("#again").addEventListener("click", main);
    return;
  }
  await migrateMissing().catch(() => {});
  rememberNames();
  render();
  // Link met #groep=CODE&team=<sleutel>[&naam=<naam>][&van=<afzender>&a=<keuzes>]: kies dat team en open het deelnemen-blad
  // met de code (en bij een herstel-link je naam) al ingevuld. Meegestuurde keuzes neem je bij deelnemen over; zit je al in de
  // groep, dan vraagt een blad of je ze overneemt. Zonder team in de link (oudere links) vragen we je eerst een team te kiezen.
  if (shared.enabled && location.hash.startsWith("#groep=")) {
    const params = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    applyLink(params);
  }
}

// Een herstel- of uitnodigingslink verwerken, of hij nu in de adresbalk stond of in het plakveld op het zoekscherm is gezet.
function applyLink(params) {
  {
    const code = shared.cleanCode(params.get("groep") || "");
    const team = params.get("team") || "", name = (params.get("naam") || "").trim().slice(0, 30);
    if (shared.validCode(code)) {
      pendingCode = code;
      pendingName = name;
      pendingId = (params.get("id") || "").trim().slice(0, 128);
      pendingProposal = parseProposal(params.get("a"), params.get("van"));
      if (teamIndex.has(team)) { // de link hoort bij een team: dat team kiezen
        if (state.groups[team] === code && pendingProposal) { // al lid: alleen de keuzes nog
          pendingCode = "";
          if (state.active !== team || state.searching) selectTeam(team);
          matchesLoaded.then(offerProposal);
        } else if (state.groups[team]) { // al lid: de start_url van de geïnstalleerde app is zelf deze link, dus alleen melden bij een andere groep
          pendingCode = ""; pendingProposal = null;
          if (state.groups[team] !== code) toast("Je zit al in de groep van dit team.");
          else if (state.active !== team || state.searching) selectTeam(team);
        }
        else if (state.active === team && !state.searching) offerPendingJoin();
        else selectTeam(team);
      } else if (!state.active || state.searching) { // op het zoekscherm wacht de code tot je een team kiest
        toast("Kies eerst je team; daarna kun je deelnemen met de code.");
      } else offerPendingJoin();
    }
  }
}

// Tekst uit het plakveld: een hele link, alleen het deel na #, of een kale groepscode.
function parseLinkText(text) {
  const t = (text || "").trim();
  const i = t.indexOf("groep=");
  if (i >= 0) {
    // Tekst na de link (bijvoorbeeld "Groet, Piet") en leestekens direct erachter horen er niet bij.
    const params = new URLSearchParams(t.slice(i).split(/\s/)[0].replace(/[.,;:!?)\]}>"']+$/, ""));
    return shared.validCode(shared.cleanCode(params.get("groep") || "")) ? params : null;
  }
  return shared.validCode(shared.cleanCode(t)) ? new URLSearchParams({ groep: t }) : null;
}

// Terug in de app: de keuzes van teamgenoten verversen.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && state.active && !state.searching && !state.club && state.matches?.length) loadOthers(); });

// ---- Installeren als app (PWA) ----
// Android/Chrome: de browser geeft een beforeinstallprompt, die tonen we achter een knop.
// iPhone/iPad: Safari heeft geen prompt, daar leggen we de stappen uit.
const installBox = $("#install");
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
let installEvent = null;

function showInstall() {
  if (standalone) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const inGroup = Object.keys(state.groups).length > 0;
  if (installEvent) {
    installBox.innerHTML = `<button class="primary" id="do-install">📲 Zet op je beginscherm als app</button>${inGroup ? `<p class="muted hint">Als app blijven je groep en keuzes bewaard: de browser ruimt de opslag dan niet op.</p>` : ""}`;
    $("#do-install").addEventListener("click", async () => {
      installEvent.prompt();
      await installEvent.userChoice;
      installEvent = null;
      installBox.hidden = true;
    });
  } else if (ios) {
    installBox.innerHTML = `<p class="notice">📲 <b>Als app installeren:</b> tik in Safari op <b>Deel</b> (het vierkantje met pijl) en kies <b>Zet op beginscherm</b>.${inGroup ? " Safari wist gegevens van websites die je zeven dagen niet opent; als app blijven je groep en keuzes bewaard." : ""}</p>`;
  } else return;
  installBox.hidden = false;
}
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; showInstall(); });
addEventListener("appinstalled", () => { installBox.hidden = true; toast("Geïnstalleerd"); });
showInstall();
syncManifest();
persistStorage();

// Nieuwe versie van de app automatisch oppakken: zodra een nieuwe service worker het overneemt, laden we de pagina één keer opnieuw.
// (Niet bij de allereerste installatie: dan is er nog geen oude versie om te vervangen.)
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register("sw.js").then((reg) => {
    // Een geopende app (bijvoorbeeld vanaf het beginscherm) controleert op een nieuwe versie zodra je terugkomt.
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
}
main();
