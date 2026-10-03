// Volleybal-PWA: team zoeken, favoriet lokaal bewaren, wedstrijden naar je agenda.

const NEVOBO = "api.nevobo.nl";
const TZ = "Europe/Amsterdam";
const STORE = "volleybal.v1";

const $ = (sel) => document.querySelector(sel);
const view = $("#view");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- Opslag: alleen op dit toestel (localStorage) ----
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ favs: state.favs, active: state.active })); } catch { /* privémodus */ }
}
const state = { favs: [], active: null, ...load(), searching: false, query: "", matches: null, error: "" };
if (!Array.isArray(state.favs)) state.favs = [];

// ---- Teamlijst ----
let teamIndex = null; // key -> team
let teamList = [];
let updated = "";

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function loadTeams() {
  if (teamIndex) return;
  const res = await fetch("data/teams.json");
  if (!res.ok) throw new Error("teams");
  const data = await res.json();
  updated = data.updated;
  teamList = data.teams.map(([key, naam, club, plaats, stand]) => {
    const [, type, nr] = key.split("/");
    const soort = type === "dames" ? "dames ds" : type === "heren" ? "heren hs" : type;
    return { key, naam, club, plaats, stand, hay: norm(`${naam} ${club} ${plaats} ${stand} ${soort} ${nr}`) };
  });
  teamIndex = new Map(teamList.map((t) => [t.key, t]));
  $("#updated").textContent = "Gegevens van " + new Date(updated).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: TZ });
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
const fTime = fmt({ hour: "2-digit", minute: "2-digit" });

// ---- iCalendar maken ----
const icsText = (s) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
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
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function teamUrls(key) {
  const [code, type, nr] = key.split("/");
  const path = `${NEVOBO}/export/team/${code.toUpperCase()}/${type}/${nr}/programma.ics`;
  return { web: `webcal://${path}`, https: `https://${path}` };
}

function renderSearch() {
  const results = state.query.trim().length >= 2 ? search(state.query) : [];
  const shown = results.slice(0, 40);
  view.innerHTML = `
    <section class="card">
      <h2>${state.active ? "Ander team kiezen" : "Zoek je team"}</h2>
      <p class="muted">Typ de naam van je vereniging of team, bijvoorbeeld “Volley2B DS 1” of “heren 2 Rotterdam”.</p>
      <input id="q" type="search" placeholder="Teamnaam, club of plaats" value="${esc(state.query)}" autocomplete="off" autocapitalize="off" enterkeyhint="search" aria-label="Zoek een team">
      <ul class="results" id="results">
        ${shown.map((t) => `<li><button data-key="${esc(t.key)}"><b>${esc(t.naam)}</b><span class="muted">${esc(t.club)}${t.plaats ? ", " + esc(t.plaats) : ""}${t.stand ? " · " + esc(t.stand) : ""}</span></button></li>`).join("")}
      </ul>
      ${state.query.trim().length >= 2 && !results.length ? `<p class="notice">Geen team gevonden. Probeer een deel van de naam.</p>` : ""}
      ${results.length > shown.length ? `<p class="muted">${results.length} teams gevonden, de eerste ${shown.length} staan hierboven. Typ iets specifieker.</p>` : ""}
      ${state.active ? `<button id="back">Terug naar mijn team</button>` : ""}
    </section>`;
  const q = $("#q");
  q.addEventListener("input", () => {
    state.query = q.value;
    const pos = q.selectionStart;
    renderSearch();
    const n = $("#q");
    n.focus();
    n.setSelectionRange(pos, pos);
  });
  $("#results").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-key]");
    if (b) selectTeam(b.dataset.key);
  });
  $("#back")?.addEventListener("click", () => { state.searching = false; render(); });
  if (!state.query) q.focus({ preventScroll: true });
}

function matchRow(m, team) {
  const [home, away] = m.t.split(" - ");
  const me = norm(team.naam);
  const isHome = norm(home || "") === me;
  const isAway = norm(away || "") === me;
  const d = parseDt(m.s);
  const label = (n, mine) => (mine ? `<span class="me">${esc(n)}</span>` : esc(n));
  const where = m.l ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(m.l)}" target="_blank" rel="noopener">${esc(m.l)}</a>` : "";
  return `
    <div class="match ${d < Date.now() - 3 * 3600e3 ? "past" : ""}">
      <div class="when"><div class="d">${esc(fDay.format(d))}</div><div class="t">${esc(fTime.format(d))}</div></div>
      <div>
        <div class="vs">${isHome ? '<span class="tag home">thuis</span>' : isAway ? '<span class="tag away">uit</span>' : ""}${away ? `${label(home, isHome)} – ${label(away, isAway)}` : esc(m.t)}</div>
        ${where ? `<div class="where">${where}</div>` : ""}
      </div>
      <button class="small" data-add="${esc(m.i)}" aria-label="Zet ${esc(m.t)} in je agenda">+ Agenda</button>
    </div>`;
}

function renderTeam() {
  const team = teamIndex.get(state.active);
  const { web, https } = teamUrls(state.active);
  const isFav = state.favs.includes(state.active);
  const now = Date.now() - 3 * 3600e3;
  const all = state.matches || [];
  const upcoming = all.filter((m) => parseDt(m.s) >= now);
  const past = all.filter((m) => parseDt(m.s) < now).reverse();

  view.innerHTML = `
    ${state.favs.length > 1 ? `<div class="chips" role="group" aria-label="Mijn teams">${state.favs.map((k) => `<button class="chip" data-switch="${esc(k)}" aria-pressed="${k === state.active}">${esc(teamIndex.get(k)?.naam || k)}</button>`).join("")}</div>` : ""}
    <section class="card">
      <div class="team-head">
        <div>
          <h2>${esc(team.naam)}</h2>
          <p class="muted">${esc(team.club)}${team.plaats ? ", " + esc(team.plaats) : ""}</p>
          ${team.stand ? `<p class="muted">${esc(team.stand)}</p>` : ""}
        </div>
        <button class="star" id="fav" aria-pressed="${isFav}" aria-label="${isFav ? "Verwijder uit favorieten" : "Maak favoriet"}">${isFav ? "★" : "☆"}</button>
      </div>
      <div class="actions">
        <a class="btn primary" id="subscribe" href="${esc(web)}">📅 Team abonneren in agenda</a>
        <div class="row">
          <button id="all" ${all.length ? "" : "disabled"}>⬇ Alles als .ics</button>
          <button id="copy">Kopieer agenda-link</button>
          <button id="change">Ander team</button>
        </div>
      </div>
    </section>
    <section class="card">
      ${state.error ? `<p class="notice">${esc(state.error)}</p>` : ""}
      ${state.matches === null && !state.error ? `<p class="muted">Wedstrijden laden…</p>` : ""}
      ${state.matches && !upcoming.length ? `<p class="muted">Geen komende wedstrijden gevonden.</p>` : ""}
      ${upcoming.map((m) => matchRow(m, team)).join("")}
    </section>
    ${past.length ? `<details class="card"><summary>Gespeelde wedstrijden (${past.length})</summary>${past.map((m) => matchRow(m, team)).join("")}</details>` : ""}`;

  $("#fav").addEventListener("click", () => {
    state.favs = isFav ? state.favs.filter((k) => k !== state.active) : [...state.favs, state.active];
    save();
    renderTeam();
    toast(isFav ? "Verwijderd uit favorieten" : "Opgeslagen als favoriet op dit toestel");
  });
  $("#change").addEventListener("click", () => { state.searching = true; state.query = ""; render(); });
  $("#all").addEventListener("click", () => {
    download(`${slug(team.naam)}.ics`, calendar(`Wedstrijden ${team.naam}`, upcoming));
    toast(`${upcoming.length} komende wedstrijden`);
  });
  $("#copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(https); toast("Link gekopieerd. Plak hem in je agenda-app als abonnement."); }
    catch { prompt("Kopieer deze link en voeg hem toe als agenda-abonnement:", https); }
  });
  view.querySelectorAll("[data-switch]").forEach((b) => b.addEventListener("click", () => selectTeam(b.dataset.switch, false)));
  view.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
    const m = all.find((x) => x.i === b.dataset.add);
    if (m) download(`${slug(m.t)}-${m.s.slice(0, 8)}.ics`, calendar(m.t, [m]));
  }));
}

async function loadMatches() {
  state.matches = null;
  state.error = "";
  const key = state.active;
  try {
    const res = await fetch(`data/t/${key.replace(/\//g, "-")}.json`);
    if (res.status === 404) state.matches = [];
    else if (!res.ok) throw new Error();
    else state.matches = (await res.json()).m;
  } catch {
    state.error = "Wedstrijden konden niet geladen worden. Ben je offline en heb je dit team nog niet eerder bekeken?";
  }
  if (state.active === key && !state.searching) renderTeam();
}

function selectTeam(key, makeFav = true) {
  state.active = key;
  state.searching = false;
  state.query = "";
  if (makeFav && !state.favs.includes(key)) state.favs.push(key); // gekozen team wordt je favoriet
  save();
  render();
}

function render() {
  if (state.searching || !state.active || !teamIndex?.has(state.active)) {
    if (state.active && !teamIndex.has(state.active)) { state.favs = state.favs.filter((k) => k !== state.active); state.active = state.favs[0] || null; save(); }
    if (state.active && !state.searching) return render();
    return renderSearch();
  }
  state.matches = null;
  state.error = "";
  renderTeam();
  loadMatches();
}

async function main() {
  view.innerHTML = `<p class="muted">Teams laden…</p>`;
  try { await loadTeams(); }
  catch { view.innerHTML = `<p class="notice">De teamlijst kon niet geladen worden. Controleer je verbinding en probeer het opnieuw.</p>`; return; }
  render();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
main();
