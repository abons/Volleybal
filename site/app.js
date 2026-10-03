// Volleybal-PWA: team zoeken, favoriet lokaal bewaren, wedstrijden naar je agenda.

import * as shared from "./shared.js";

const NEVOBO = "api.nevobo.nl";
const TZ = "Europe/Amsterdam";
const STORE = "volleybal.v1";

const $ = (sel) => document.querySelector(sel);
const view = $("#view");
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
};

// ---- Opslag: alleen op dit toestel (localStorage) ----
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ favs: state.favs, active: state.active, att: state.att, name: state.name, groups: state.groups })); } catch { /* privémodus */ }
}
const state = { favs: [], active: null, att: {}, name: "", groups: {}, ...load(), searching: false, club: null, query: "", matches: null, results: [], poules: [], tables: null, tab: "programma", error: "" };
if (!Array.isArray(state.favs)) state.favs = [];

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
// ---- Groep per team: de code is de enige beveiliging ----
let others = null; // wedstrijd -> keuzes van groepsleden [{ uid, name, status }]
let memberCount = 0;
let myUid = "";
const groupOf = () => (shared.enabled && state.groups[state.active]) || null;
const showCode = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;
const upcomingMine = () => upcomingOf(state.matches || []).filter((m) => attendance.get(m.i));

async function pushMine(m) {
  const code = groupOf();
  if (!code || !state.name) return;
  await shared.put({ code, match: m.i, start: m.s, name: state.name, status: attendance.get(m.i) });
}

let othersSeq = 0;
function resetShared() { others = null; memberCount = 0; state.shareError = false; othersSeq++; }

// Alleen de aanwezigheidsblokken en de groepsregel verversen, zodat de focus en een openstaande keuze blijven staan.
function refreshShared() {
  if (state.searching || state.club || state.tab !== "programma") return;
  const root = $("#matches");
  if (!root) return;
  const active = document.activeElement;
  const focusBox = active?.classList?.contains("att-now") ? active.closest("[data-box]")?.dataset.box : null;
  const focusLine = active?.id === "g-open";
  for (const box of root.querySelectorAll("[data-box]")) {
    if (box.dataset.box === editing) continue;
    const m = (state.matches || []).find((x) => x.i === box.dataset.box);
    if (m) box.innerHTML = attInner(m);
    if (box.dataset.box === focusBox) box.querySelector(".att-now")?.focus();
  }
  const line = root.querySelector(".share");
  if (line) line.outerHTML = groupLine();
  if (focusLine) $("#g-open")?.focus();
}

// Jouw keuzes die in de groep ontbreken of afwijken (bijvoorbeeld na een mislukte push) opnieuw delen.
async function reconcile(code, list) {
  const remote = new Map((list || []).map((o) => [o.match, o]));
  const jobs = [];
  for (const m of upcomingOf(state.matches || [])) {
    const mineNow = attendance.get(m.i), r = remote.get(m.i);
    if (mineNow && (!r || r.status !== mineNow || r.name !== state.name)) jobs.push(pushMine(m));
    else if (!mineNow && r) jobs.push(shared.put({ code, match: m.i, start: m.s, name: state.name, status: null }));
  }
  await Promise.all(jobs);
}

async function loadOthers() {
  const code = groupOf();
  const key = state.active;
  if (!code) { others = null; return; }
  const seq = ++othersSeq;
  const stale = () => seq !== othersSeq || state.active !== key || groupOf() !== code;
  try {
    myUid = await shared.myUid();
    const [map, list] = await Promise.all([shared.rsvps(code), shared.members(code)]);
    if (stale()) return;
    others = map;
    memberCount = list.length;
    state.shareError = false;
    // eigen keuzes die in de groep ontbreken of afwijken, gelijktrekken (op de achtergrond)
    const mineRemote = [...map.entries()].flatMap(([match, l]) => l.filter((o) => o.uid === myUid).map((o) => ({ ...o, match })));
    reconcile(code, mineRemote).catch(() => {});
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
function veventFor(m) {
  const start = parseDt(m.s);
  const end = m.e ? parseDt(m.e) : new Date(start.getTime() + 2 * 3600e3);
  const dt = (raw, d) => (raw.endsWith("Z") ? utc(d) : raw);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${m.i}`, // zelfde UID als Nevobo: opnieuw toevoegen werkt dan een bestaande afspraak bij
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${dt(m.s, start)}`,
    `DTEND:${m.e ? dt(m.e, end) : utc(end)}`,
    `SUMMARY:${icsText(m.t)}`,
  ];
  if (m.l) lines.push(`LOCATION:${icsText(m.l)}`);
  if (m.g) lines.push(`GEO:${m.g}`);
  if (m.u) lines.push(`URL:${m.u}`);
  lines.push("END:VEVENT");
  return lines.map(fold).join("\r\n");
}
function calendar(name, matches) {
  const head = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Volleybal PWA//NL", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(name)}`];
  return [...head, ...matches.map(veventFor), "END:VCALENDAR"].join("\r\n") + "\r\n";
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
    </section>`;
  const q = $("#q");
  q.addEventListener("input", () => { state.query = q.value; updateResults(); });
  $("#results").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-key]");
    if (b) selectTeam(b.dataset.key);
  });
  $("#back")?.addEventListener("click", () => { state.searching = false; render(); $("#change")?.focus(); });
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

function matchRow(m, team) {
  const [home, away] = m.t.split(" - ");
  const me = norm(team.naam);
  const isHome = norm(home || "") === me;
  const isAway = norm(away || "") === me;
  const opp = isHome ? away : isAway ? home : null;
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

// Wie komt er? Teamgenoten (zonder jezelf) plus jouw eigen keuze met je naam, compact: "✓ Anouk, Bo  ? Dewi  ✕ Eline".
const GLYPH = { yes: "✓", maybe: "?", no: "✕" };
function whoHtml(m) {
  if (!shared.enabled || !others) return "";
  const list = (others.get(m.i) || []).filter((o) => o.uid !== myUid);
  const mine = attendance.get(m.i);
  if (mine && state.name) list.push({ name: state.name, status: mine });
  return STATUS.map(([k, label]) => {
    const names = list.filter((o) => o.status === k).map((o) => o.name).sort((a, b) => a.localeCompare(b, "nl"));
    return names.length ? `<span class="who-${k}"><span aria-hidden="true">${GLYPH[k]}</span><span class="sr-only">${label}: </span> ${names.map(esc).join(", ")}</span>` : "";
  }).filter(Boolean).join(" ");
}

// Standaard een rustige regel met je keuze; tik erop en dezelfde plek wordt Ja / Misschien / Nee.
let editing = null; // id van de wedstrijd waarvan de keuzeknoppen openstaan
let entering = false; // "Geef door"-modus: bij alle wedstrijden staan de keuzeknoppen open

function attInner(m) {
  const cur = attendance.get(m.i);
  if (entering || editing === m.i) {
    const who = entering ? whoHtml(m) : "";
    return `<div class="att" role="group" aria-label="Aanwezig bij ${esc(m.t)}?">${STATUS.map(([k, name, long]) =>
      `<button class="att-${k}" data-att="${k}" data-for="${esc(m.i)}" aria-pressed="${cur === k}" aria-label="${esc(long)}">${name}</button>`).join("")}</div>${who ? `<div class="who" aria-live="polite">${who}</div>` : ""}`;
  }
  const text = { yes: "Je komt", maybe: "Misschien", no: "Je komt niet" }[cur];
  const line = cur
    ? `<span class="dot att-${cur}" aria-hidden="true">${GLYPH[cur]}</span>${text}`
    : `Aanwezig? <span class="cta">Geef door</span>`;
  const aria = cur ? `Aanwezigheid: ${esc(text.toLowerCase())}. Tik om te wijzigen` : `Aanwezigheid doorgeven voor ${esc(m.t)}`;
  const who = whoHtml(m);
  return `<button class="att-now${cur ? " set" : ""}" data-edit="${esc(m.i)}" aria-label="${aria}">${line}</button>${who ? `<div class="who" aria-live="polite">${who}</div>` : ""}`;
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
          <button class="star" id="fav" aria-pressed="${isFav}" aria-label="Mijn team" title="${isFav ? "Verwijder uit mijn teams" : "Bewaar als mijn team"}">${ico.star(isFav)}</button>
        </div>
      </div>
      <div class="actions">
        <div class="main-action">
          <button class="btn primary" id="agenda-open" aria-haspopup="dialog">${ico.cal} In je agenda</button>
          <button class="link" id="change">${ico.swap} Ander team</button>
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
          ${ico.download}<span><b>Eenmalig downloaden</b><span class="muted">Alleen de komende wedstrijden, zonder updates.</span></span>
        </button>
      </dialog>
    </section>
    <div class="tabs" role="group" aria-label="Wat wil je zien?">
      ${[["programma", "Programma"], ["uitslagen", "Uitslagen"], ["stand", "Stand"]].map(([k, l]) => `<button data-tab="${k}" aria-pressed="${state.tab === k}">${l}</button>`).join("")}
    </div>
    <div id="matches"></div>
    <dialog class="sheet" id="group-dlg" aria-labelledby="group-title"></dialog>`;
  $("#group-dlg").addEventListener("click", onGroupClick);
  $("#group-dlg").addEventListener("keydown", (e) => { // Enter verstuurt het blad
    if (e.key !== "Enter" || !e.target.matches("input")) return;
    e.preventDefault();
    const dlg = e.currentTarget;
    const go = e.target.id === "g-code" || $("#g-code")?.value.trim() ? "#g-join" : $("#g-rename") ? "#g-rename" : "#g-create";
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
    download(`${slug(team.naam)}.ics`, calendar(`Wedstrijden ${team.naam}`, up));
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
      pushMine(am).then(loadOthers, () => toast("Delen met je team is niet gelukt. Je keuze staat wel op dit toestel."));
      return;
    }
    if (e.target.closest("#g-open")) { openGroupDialog(); return; }
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
    download(`${slug(m.t)}-${m.s.slice(0, 8)}.ics`, calendar(m.t, [m]));
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
  return `<div class="modebar">${shared.enabled ? groupLine() : ""}<button class="small${entering ? " on" : ""}" id="att-mode" aria-pressed="${entering}" title="Aanwezigheid bij alle wedstrijden doorgeven">${entering ? "Klaar" : "Geef door"}</button></div>`;
}

function groupLine() {
  const code = groupOf();
  if (!code) return `<p class="muted share">Zie wie er komt: <button class="link inline" id="g-open">maak een groep of neem deel</button></p>`;
  return `<p class="muted share">${state.shareError ? "Groepsleden laden lukt nu niet. " : ""}Groep <b>${esc(showCode(code))}</b>${memberCount ? ` · ${memberCount} ${memberCount === 1 ? "lid" : "leden"}` : ""} · <button class="link inline" id="g-open">beheer</button></p>`;
}

function groupDialogHtml(prefill = "") {
  const code = groupOf();
  const nameField = `<label class="field">Je naam<input id="g-name" type="text" maxlength="30" autocomplete="given-name" value="${esc(state.name)}" placeholder="Bijvoorbeeld Axel"></label>`;
  const head = `<div class="sheet-head"><h3 id="group-title">${code ? "Je groep" : "Aanwezigheid delen"}</h3><button class="star" id="g-close" aria-label="Sluiten">${ico.close}</button></div>`;
  if (code) return `${head}
    <p class="muted">Deel deze code met je teamgenoten. Iedereen die de code heeft, kan de groep zien en meedoen.</p>
    <p class="code" aria-label="Groepscode">${esc(showCode(code))}</p>
    <div class="row2"><button id="g-copy">${ico.link} Kopieer code</button><button id="g-link">${ico.link} Kopieer link</button></div>
    ${nameField}<button id="g-rename">Naam opslaan</button>
    <p id="g-err" class="notice" role="alert" hidden></p>
    <button class="link" id="g-leave">Groep verlaten</button>`;
  if (prefill) return `<div class="sheet-head"><h3 id="group-title">Deelnemen aan de groep</h3><button class="star" id="g-close" aria-label="Sluiten">${ico.close}</button></div>
    <p class="muted">Je bent uitgenodigd voor een groep. Vul je naam in: teamgenoten zien die bij je keuze.</p>
    ${nameField}
    <label class="field">Groepscode<input id="g-code" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(prefill)}"></label>
    <button class="btn primary" id="g-join">Deelnemen</button>
    <p id="g-err" class="notice" role="alert" hidden></p>`;
  return `${head}
    <p class="muted">Je keuzes zijn dan zichtbaar voor je teamgenoten. Er is geen account; de code van de groep is de enige beveiliging.</p>
    ${nameField}
    <button class="btn primary" id="g-create">Nieuwe groep maken</button>
    <label class="field">Of neem deel met een code<input id="g-code" type="text" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="XXXXX-XXXXX"></label>
    <button id="g-join">Deelnemen</button>
    <p id="g-err" class="notice" role="alert" hidden></p>`;
}

function openGroupDialog(prefill = "") {
  const dlg = $("#group-dlg");
  if (!dlg) return;
  dlg.innerHTML = groupDialogHtml(prefill);
  if (!dlg.open) (dlg.showModal ? dlg.showModal() : dlg.setAttribute("open", ""));
  if (prefill) $("#g-name")?.focus(); // alleen je naam ontbreekt nog
}

// Na maken, deelnemen of wijzigen: blad sluiten en meteen de nieuwe stand tonen; delen gebeurt op de achtergrond.
function afterGroupChange(reopen = false, enter = false) {
  $("#group-dlg")?.close?.();
  resetShared();
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
  err.hidden = true;
  btn.disabled = true;
  try { await fn(name); }
  catch (e) {
    err.textContent = e.message === "notfound" ? "Die code bestaat niet. Controleer hem en probeer opnieuw." : e.message === "name" ? "Vul eerst je naam in." : e.message === "code" ? "Een code heeft 10 tekens (letters en cijfers)." : "Het is niet gelukt. Controleer je verbinding en probeer het opnieuw.";
    err.hidden = false;
  } finally { btn.disabled = false; }
}

function onGroupClick(e) {
  const dlg = e.currentTarget;
  if (e.target === dlg || e.target.closest("#g-close")) return dlg.close();
  const btn = e.target.closest("button");
  const id = btn?.id;
  if (id === "g-create") groupAction(btn, async (name) => {
    if (!name) throw new Error("name");
    const code = shared.newCode();
    await shared.createGroup(code, name);
    state.name = name; state.groups[state.active] = code; save();
    toast("Groep gemaakt. Deel de code met je team.");
    afterGroupChange(true, true);
  });
  else if (id === "g-join") groupAction(btn, async (name) => {
    const code = shared.cleanCode($("#g-code").value);
    if (!name) throw new Error("name");
    if (!shared.validCode(code)) throw new Error("code");
    await shared.joinGroup(code, name);
    state.name = name; state.groups[state.active] = code; save();
    toast("Je doet mee met de groep. Geef je aanwezigheid door.");
    afterGroupChange(false, true);
  });
  else if (id === "g-rename") groupAction(btn, async (name) => {
    if (!name) throw new Error("name");
    await shared.rename(groupOf(), name);
    state.name = name; save();
    toast("Naam opgeslagen.");
    afterGroupChange();
  });
  else if (id === "g-copy" || id === "g-link") {
    const code = groupOf();
    const text = id === "g-copy" ? showCode(code) : `${location.origin}${location.pathname}#groep=${code}&team=${encodeURIComponent(state.active)}`;
    navigator.clipboard.writeText(text).then(() => toast(id === "g-copy" ? "Code gekopieerd." : "Link gekopieerd."), () => prompt("Kopieer:", text));
  } else if (id === "g-leave") groupAction(btn, async () => {
    if (!confirm("Groep verlaten? Je keuzes verdwijnen uit de groep; op dit toestel blijven ze staan.")) return;
    const code = groupOf();
    await shared.leaveGroup(code);
    delete state.groups[state.active]; save();
    resetShared();
    dlg.close();
    refreshShared();
    $("#g-open")?.focus();
  });
}

function programHtml(team) {
  const upcoming = upcomingOf(state.matches || []);
  return `<section class="card">
    <h3 class="sr-only">Komende wedstrijden</h3>
    ${problem()}${loading()}
    ${state.matches && !upcoming.length ? `<p class="muted">Geen komende wedstrijden. Het programma volgt later.</p>` : ""}
    ${upcoming.length ? modeBar() : shared.enabled ? groupLine() : ""}
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

async function loadMatches() {
  state.matches = null;
  state.error = "";
  const key = state.active;
  if (!state.searching) renderMatches();
  try {
    const res = await fetch(`data/t/${key.replace(/\//g, "-")}.json`);
    if (res.status === 404) state.matches = [];
    else if (!res.ok) throw new Error();
    else {
      const j = await res.json();
      if (state.active !== key) return; // ondertussen een ander team gekozen
      // Een kapot item (zonder geldige datum) mag niet de hele lijst laten crashen.
      state.matches = (j.m || []).filter((m) => !isNaN(parseDt(m.s)));
      state.results = (j.r || []).filter((r) => !isNaN(new Date(r.s)));
      state.poules = j.p || [];
    }
  } catch {
    state.error = "Geen internet, en dit team heb je nog niet eerder geopend. Probeer het opnieuw zodra je weer verbinding hebt.";
  }
  if (state.active === key && !state.searching) renderMatches();
  if (state.matches?.length) loadOthers();
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
      const res = await fetch(`data/t/${t.key.replace(/\//g, "-")}.json`);
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

function offerPendingJoin() {
  if (!pendingCode || !shared.enabled || !state.active || state.searching) return;
  const code = pendingCode;
  pendingCode = "";
  if (groupOf()) return toast("Je zit al in een groep voor dit team.");
  openGroupDialog(showCode(code));
}

function selectTeam(key, makeFav = true) {
  state.active = key;
  state.club = null;
  state.searching = false;
  state.query = "";
  state.tab = "programma";
  const added = makeFav && !state.favs.includes(key);
  if (added) state.favs.push(key); // gekozen team wordt je favoriet
  save();
  render();
  $("#team-name")?.focus({ preventScroll: true });
  if (added) toast("Opgeslagen als je team (ster). Tik op de ster om te verwijderen.");
  offerPendingJoin();
}

function render() {
  if (state.active && !teamIndex.has(state.active)) { // team bestaat niet meer (nieuw seizoen)
    state.favs = state.favs.filter((k) => k !== state.active);
    state.active = state.favs[0] || null;
    save();
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
  render();
  // Link met #groep=CODE&team=<sleutel>: kies dat team en open het deelnemen-blad met de code al ingevuld.
  // Zonder team in de link (oudere links) vragen we je eerst een team te kiezen.
  const hash = shared.enabled && /^#groep=([A-Za-z0-9]+)(?:&team=([^&]+))?$/.exec(location.hash);
  if (hash) {
    history.replaceState(null, "", location.pathname + location.search);
    const code = shared.cleanCode(hash[1]);
    let team = "";
    try { team = decodeURIComponent(hash[2] || ""); } catch { /* ongeldige link */ }
    if (shared.validCode(code)) {
      pendingCode = code;
      if (teamIndex.has(team) && !state.groups[team]) {
        if (state.active === team && !state.searching) offerPendingJoin();
        else selectTeam(team);
      } else if (!state.active) {
        toast("Kies eerst je team; daarna kun je deelnemen met de code.");
      } else offerPendingJoin();
    }
  }
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
  if (installEvent) {
    installBox.innerHTML = `<button class="primary" id="do-install">📲 Zet op je beginscherm als app</button>`;
    $("#do-install").addEventListener("click", async () => {
      installEvent.prompt();
      await installEvent.userChoice;
      installEvent = null;
      installBox.hidden = true;
    });
  } else if (ios) {
    installBox.innerHTML = `<p class="notice">📲 <b>Als app installeren:</b> tik in Safari op <b>Deel</b> (het vierkantje met pijl) en kies <b>Zet op beginscherm</b>.</p>`;
  } else return;
  installBox.hidden = false;
}
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; showInstall(); });
addEventListener("appinstalled", () => { installBox.hidden = true; toast("Geïnstalleerd"); });
showInstall();

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
