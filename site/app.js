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
const state = { favs: [], active: null, ...load(), searching: false, query: "", matches: null, results: [], poules: [], tables: null, tab: "programma", error: "" };
if (!Array.isArray(state.favs)) state.favs = [];

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
    <div class="match ${d < Date.now() - 3 * 3600e3 ? "past" : ""}">
      <div class="when"><div class="d">${esc(fDay.format(d))}</div><div class="t">${esc(fTime.format(d))}</div></div>
      <div class="what">
        <div class="vs">${opp ? `<span class="tag ${isHome ? "home" : "away"}">${isHome ? "thuis" : "uit"}</span>${esc(opp)}` : esc(m.t)}</div>
        ${place}
      </div>
      <button class="small" data-add="${esc(m.i)}" aria-label="Zet ${esc(m.t)} in je agenda">+ Agenda</button>
    </div>`;
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
          <p class="muted">${esc(team.club)}${team.plaats ? ", " + esc(team.plaats) : ""}${team.stand ? " · " + esc(team.stand) : ""}</p>
        </div>
        <button class="star" id="fav" aria-pressed="${isFav}" aria-label="${isFav ? "Verwijder uit mijn teams" : "Bewaar als mijn team"}">${isFav ? "★" : "☆"}</button>
      </div>
      <div class="actions">
        <a class="btn primary" id="subscribe" href="${esc(teamUrls(state.active).web)}"><span aria-hidden="true">📅</span> Alle wedstrijden in je agenda</a>
        <p class="muted hint">Nieuwe en gewijzigde wedstrijden komen vanzelf mee.</p>
        <details class="more">
          <summary>Meer opties</summary>
          <div class="row">
            <button id="all">Download komende wedstrijden</button>
            <button id="copy">Kopieer link voor je agenda</button>
          </div>
        </details>
      </div>
      <button class="link" id="change">Ander team kiezen ›</button>
    </section>
    <div class="tabs" role="group" aria-label="Wat wil je zien?">
      ${[["programma", "Programma"], ["uitslagen", "Uitslagen"], ["stand", "Stand"]].map(([k, l]) => `<button data-tab="${k}" aria-pressed="${state.tab === k}">${l}</button>`).join("")}
    </div>
    <div id="matches"></div>`;

  $("#fav").addEventListener("click", () => {
    state.favs = isFav ? state.favs.filter((k) => k !== state.active) : [...state.favs, state.active];
    save();
    renderTeam();
    $("#fav").focus();
    toast(isFav ? "Verwijderd uit je teams" : "Team bewaard op dit toestel");
  });
  $("#change").addEventListener("click", () => { state.searching = true; state.query = ""; render(); });
  $("#all").addEventListener("click", () => {
    const up = upcomingOf(state.matches || []);
    download(`${slug(team.naam)}.ics`, calendar(`Wedstrijden ${team.naam}`, up));
    toast(`${up.length} komende wedstrijden. Open het bestand om ze toe te voegen.`);
  });
  $("#copy").addEventListener("click", async () => {
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

function programHtml(team) {
  const upcoming = upcomingOf(state.matches || []);
  return `<section class="card">
    <h3>Komende wedstrijden</h3>
    ${problem()}${loading()}
    ${state.matches && !upcoming.length ? `<p class="muted">Geen komende wedstrijden. Het programma volgt later.</p>` : ""}
    ${upcoming.map((m) => matchRow(m, team)).join("")}
  </section>`;
}

// Uitslagen vanuit het eigen team bekeken: tegenstander als hoofdregel, eigen score eerst.
function resultRow(r, team) {
  const me = norm(team.naam);
  const idx = r.k ? r.k.indexOf(state.active) : -1; // liefst op team-sleutel, anders op naam
  const isHome = idx >= 0 ? idx === 0 : norm(r.t[0]) === me;
  const isAway = idx >= 0 ? idx === 1 : norm(r.t[1]) === me;
  const day = new Date(r.s);
  const when = `<div class="when"><div class="d">${esc(fDay.format(day))}</div>${r.c ? `<div class="t">${esc(r.c)}</div>` : ""}</div>`;
  if (!isHome && !isAway) { // zou niet moeten voorkomen: toon dan de ruwe uitslag
    return `<div class="match">${when}<div class="what"><div class="vs">${esc(r.t.join(" – "))}</div></div><div class="score"><div class="sc">${Number(r.e[0])}–${Number(r.e[1])}</div></div></div>`;
  }
  const mine = Number(r.e[isHome ? 0 : 1]), theirs = Number(r.e[isHome ? 1 : 0]);
  const won = mine > theirs;
  const opp = r.t[isHome ? 1 : 0];
  const sets = r.z.map(([x, y]) => (isHome ? `${Number(x)}-${Number(y)}` : `${Number(y)}-${Number(x)}`)).join(", ");
  return `
    <div class="match ${won ? "win" : "loss"}">
      ${when}
      <div class="what">
        <div class="vs"><span class="tag ${isHome ? "home" : "away"}">${isHome ? "thuis" : "uit"}</span>${esc(opp)}</div>
        <div class="where sets">${esc(sets)}</div>
      </div>
      <div class="score ${won ? "win" : "loss"}">
        <div class="sc">${mine}–${theirs}</div>
        <div class="wl">${won ? "winst" : "verlies"}</div>
      </div>
    </div>`;
}

function resultsHtml(team) {
  return `<section class="card">
    <h3 class="sr-only">Uitslagen</h3>
    ${problem()}${loading()}
    ${state.matches && !state.results.length ? `<p class="muted">Nog geen uitslagen dit seizoen.</p>` : ""}
    ${state.results.map((r) => resultRow(r, team)).join("")}
  </section>`;
}

function standHtml(team) {
  if (state.matches === null && !state.error) return `<section class="card"><p class="muted">Laden…</p></section>`;
  if (state.error) return `<section class="card">${problem()}</section>`;
  if (!state.poules.length) return `<section class="card"><p class="muted">Er is nog geen stand voor dit team.</p></section>`;
  if (state.tables === null) return `<section class="card"><p class="muted">Stand laden…</p></section>`;
  return state.tables.filter(Boolean).map((t) => `
    <section class="card">
      <h3>${t.cup && !/^beker/i.test(t.n) ? "Beker · " : ""}${esc(t.n)}</h3>
      <div class="table-wrap">
        <table class="stand">
          <caption class="sr-only">Stand ${esc(t.n)}</caption>
          <thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col"><abbr title="Gespeeld">Gesp.</abbr></th><th scope="col"><abbr title="Punten">Pnt</abbr></th><th scope="col">Sets</th></tr></thead>
          <tbody>${t.r.map(([pos, key, naam, gs, pt, sv, st]) => `<tr${key === state.active ? ' class="me" aria-current="true"' : ""}><td>${Number(pos) || "–"}</td><td>${esc(naam)}</td><td>${Number(gs)}</td><td>${Number(pt)}</td><td>${Number(sv)}-${Number(st)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
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
    state.error = "Geen verbinding, en dit team is nog niet eerder bekeken.";
  }
  if (state.active === key && !state.searching) renderMatches();
}

function selectTeam(key, makeFav = true) {
  state.active = key;
  state.searching = false;
  state.query = "";
  state.tab = "programma";
  if (makeFav && !state.favs.includes(key)) state.favs.push(key); // gekozen team wordt je favoriet
  save();
  render();
  $("#team-name")?.focus({ preventScroll: true });
}

function render() {
  if (state.active && !teamIndex.has(state.active)) { // team bestaat niet meer (nieuw seizoen)
    state.favs = state.favs.filter((k) => k !== state.active);
    state.active = state.favs[0] || null;
    save();
  }
  if (state.searching || !state.active) return renderSearch();
  state.matches = null;
  state.results = [];
  state.poules = [];
  state.tables = null;
  state.error = "";
  renderTeam();
  loadMatches();
}

async function main() {
  view.innerHTML = `<p class="muted">Teams laden…</p>`;
  try { await loadTeams(); }
  catch {
    view.innerHTML = `<p class="notice">De teamlijst kon niet geladen worden. Controleer je verbinding en probeer het opnieuw.</p><button id="again" class="primary">Opnieuw proberen</button>`;
    $("#again").addEventListener("click", main);
    return;
  }
  render();
}

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

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
main();
