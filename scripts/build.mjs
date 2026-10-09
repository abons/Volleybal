// Haalt teams en wedstrijdprogramma's bij Nevobo op en bouwt de statische site in ./_site.
// De browser mag api.nevobo.nl zelf niet aanroepen (geen CORS), daarom gebeurt dat hier, op de server.
//
//   node scripts/build.mjs            hergebruik _data als die jonger is dan MAX_AGE_H uur
//   FORCE=1 node scripts/build.mjs    altijd opnieuw ophalen
//   LIMIT=50 node scripts/build.mjs   alleen de eerste 50 teams (om snel te testen)

import { mkdir, readFile, writeFile, rm, cp, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseIcs } from "./ics.mjs";
import { decideKeep, stampOf } from "./keep.mjs";

const API = "https://api.nevobo.nl";
const DATA = "_data";
const OUT = "_site";
const MAX_AGE_H = Number(process.env.MAX_AGE_H || 10);
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const KEEP_HOURS = Number(process.env.KEEP_HOURS || 20); // zo lang houden we het vorige programma vast bij een leeg antwoord (twee runs van 12 uur)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, accept, tries = 5) {
  for (let n = 1; ; n++) {
    let wait = 1000 * 2 ** (n - 1); // 1, 2, 4, 8 seconden
    try {
      const res = await fetch(API + url, { headers: { Accept: accept, "User-Agent": "Volleybal-PWA (https://github.com/abons/Volleybal)" }, signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status === 503) {
        const ra = Number(res.headers.get("retry-after"));
        if (ra > 0) wait = Math.min(ra, 30) * 1000;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (n >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(wait);
    }
  }
}

async function pool(items, worker, size = CONCURRENCY) {
  let next = 0;
  const run = async () => { while (next < items.length) { const i = next++; await worker(items[i], i); } };
  await Promise.all(Array.from({ length: size }, run));
}

// Een Hydra-collectie heeft maximaal 30 items per pagina; lees alle pagina's.
// Verschuift de lijst tijdens het lezen, dan ontdubbelen we op @id en vergelijken we met totalItems.
async function collection(path) {
  const sep = path.includes("?") ? "&" : "?";
  for (let attempt = 1; ; attempt++) {
    const first = JSON.parse(await get(path, "application/ld+json"));
    const last = first["hydra:view"]?.["hydra:last"];
    const pages = Number(last?.match(/[?&]page=(\d+)/)?.[1] || 1);
    const pageItems = new Map([[1, first["hydra:member"]]]);
    await pool(Array.from({ length: pages - 1 }, (_, i) => i + 2), async (p) => {
      pageItems.set(p, JSON.parse(await get(`${path}${sep}page=${p}`, "application/ld+json"))["hydra:member"]);
    });
    const byId = new Map();
    for (let p = 1; p <= pages; p++) for (const m of pageItems.get(p) || []) byId.set(m["@id"] ?? `${p}:${byId.size}`, m);
    const total = first["hydra:totalItems"] ?? byId.size;
    if (byId.size >= total * 0.97) return [...byId.values()];
    if (attempt >= 3) throw new Error(`${path}: slechts ${byId.size} van ${total} items ontvangen`);
    console.warn(`  ${path}: ${byId.size} van ${total} items, nieuwe poging`);
  }
}

const fileFor = (key) => key.replace(/\//g, "-") + ".json"; // ckm1h25/dames/1 -> ckm1h25-dames-1.json
const pouleSlug = (iri) => iri.replace("/competitie/poules/", "").replace(/\//g, "__");
const teamKey = (iri) => iri?.replace("/competitie/teams/", "") || null;
const isCup = (iri) => iri.includes("bekertoernooi");

// Standen en uitslagen komen uit twee grote lijsten; die lezen we één keer en verdelen we over de teams.
async function fetchCompetition() {
  console.log("Poules ophalen…");
  const pouleNames = new Map();
  for (const p of await collection("/competitie/poules")) pouleNames.set(p["@id"], p.omschrijving || p.afkorting || "");
  console.log(`  ${pouleNames.size} poules`);

  console.log("Standen ophalen…");
  const indeling = new Map(); // pouleindeling-IRI -> { key, naam }
  const rows = new Map(); // poule-IRI -> rijen
  const poulesOfTeam = new Map(); // team-key -> Set(poule-IRI)
  for (const e of await collection("/competitie/pouleindelingen")) {
    const key = teamKey(e.team);
    if (!key || !e.poule) continue;
    indeling.set(e["@id"], { key, naam: e.omschrijving || "" });
    if (!rows.has(e.poule)) rows.set(e.poule, []);
    // [positie, team, naam, gespeeld, punten, setsVoor, setsTegen, gewonnen, verloren]
    rows.get(e.poule).push([e.positie || 0, key, e.omschrijving || "", e.gespeeld || 0, e.punten || 0, e.setsVoor || 0, e.setsTegen || 0, e.wedstrijdenWinst || 0, e.wedstrijdenVerlies || 0]);
    if (!poulesOfTeam.has(key)) poulesOfTeam.set(key, new Set());
    poulesOfTeam.get(key).add(e.poule);
  }
  console.log(`  ${indeling.size} teamplaatsen in ${rows.size} poules`);
  if (indeling.size < 1000) throw new Error("Verdacht weinig standen, ik stop.");

  // Poules waar nog niets gespeeld is (bijvoorbeeld promotiewedstrijden) laten we weg.
  const shown = new Set();
  await rm(`${DATA}/p.new`, { recursive: true, force: true });
  await mkdir(`${DATA}/p.new`, { recursive: true });
  for (const [iri, list] of rows) {
    if (!list.some((r) => r[3] > 0)) continue;
    list.sort((x, y) => (x[0] || 99) - (y[0] || 99));
    shown.add(iri);
    await writeFile(`${DATA}/p.new/${pouleSlug(iri)}.json`, JSON.stringify({ n: pouleNames.get(iri) || "", cup: isCup(iri), r: list }));
  }

  console.log("Uitslagen ophalen…");
  const results = new Map(); // team-key -> uitslagen
  let n = 0;
  const seen = new Set();
  for (const w of await collection("/competitie/wedstrijden?status=gespeeld&order%5Bbegintijd%5D=asc")) {
    if (seen.has(w["@id"])) continue;
    seen.add(w["@id"]);
    const [a, b] = (w.teams || []).map((t) => indeling.get(t));
    if (!a || !b || !w.eindstand) continue;
    const r = {
      s: w.tijdstip || w.datum,
      t: [a.naam, b.naam],
      k: [a.key, b.key],
      e: w.eindstand,
      z: (w.setstanden || []).map((x) => [x.puntenA, x.puntenB]),
      ...(w.poule && isCup(w.poule) && { c: "Beker" }),
    };
    for (const k of [a.key, b.key]) {
      if (!results.has(k)) results.set(k, []);
      results.get(k).push(r);
    }
    n++;
  }
  console.log(`  ${n} uitslagen`);
  if (n < 500) throw new Error("Verdacht weinig uitslagen, ik stop.");
  for (const list of results.values()) list.sort((x, y) => y.s.localeCompare(x.s));

  // Hoofdcompetitie eerst, beker daarna.
  const poulesFor = (key) =>
    [...(poulesOfTeam.get(key) || [])].filter((iri) => shown.has(iri)).sort((x, y) => Number(isCup(x)) - Number(isCup(y))).map(pouleSlug);
  return { results, poulesFor };
}

let runStats = ""; // diagnose van deze run (leeg als de data hergebruikt werd)

async function fetchData() {
  console.log("Verenigingen ophalen…");
  const clubs = new Map();
  for (const v of await collection("/relatiebeheer/verenigingen")) {
    clubs.set(v["@id"], { naam: v.naam, plaats: v.vestigingsplaats || "" });
  }
  console.log(`  ${clubs.size} verenigingen`);

  console.log("Teams ophalen…");
  let teams = (await collection("/competitie/teams")).map((t) => {
    const key = t["@id"].replace("/competitie/teams/", "");
    const club = clubs.get(t.vereniging) || {};
    return [key, t.naam, club.naam || "", club.plaats || "", t.standpositietekst || ""];
  });
  console.log(`  ${teams.length} teams`);
  if (LIMIT) teams = teams.slice(0, LIMIT);

  const { results, poulesFor } = await fetchCompetition();

  await rm(`${DATA}/t.new`, { recursive: true, force: true });
  await mkdir(`${DATA}/t.new`, { recursive: true });
  let done = 0, failed = 0, empty = 0, kept = 0, expired = 0, rawEmpty = 0, lost = 0, shown = 0;
  const nowStamp = stampOf(Date.now());
  console.log("Programma's ophalen…");
  await pool(teams, async ([key]) => {
    const [code, type, nr] = key.split("/");
    const file = `${DATA}/t.new/${fileFor(key)}`;
    const old = `${DATA}/t/${fileFor(key)}`; // vorige versie, als terugval
    const prev = existsSync(old) ? await readFile(old, "utf8").then(JSON.parse).catch(() => null) : null; // ontbrekend of kapot bestand: geen vorige versie
    let fetched, ics;
    try {
      ics = await get(`/export/team/${code.toUpperCase()}/${type}/${nr}/programma.ics`, "text/calendar");
      fetched = ics ? parseIcs(ics) : [];
    } catch (err) {
      failed++;
      if (failed <= 10) console.warn("  mislukt:", err.message);
      fetched = null; // mislukt is iets anders dan leeg: zie keep.mjs
    }
    // Antwoordt Nevobo met een leeg programma terwijl we vorige keer nog komende wedstrijden hadden, dan houden we de vorige versie
    // tijdelijk vast (maximaal KEEP_HOURS); daarna publiceren we het lege programma, zodat een verdwenen of verhuisd team zichtbaar wordt.
    const d = decideKeep({ fetched, prev, now: Date.now(), maxHours: KEEP_HOURS });
    // Diagnose: wat gaf Nevobo bij een leeg antwoord (de eerste 10 teams; geen volledige inhoud, alleen status, lengte en het begin)?
    if (fetched?.length === 0) {
      rawEmpty++;
      if (shown++ < 10) console.log(`  leeg antwoord: ${key} ${ics === null ? "404" : `200, ${ics.length} tekens: ${JSON.stringify(ics.slice(0, 80))}`}${d.kept ? " (vorige versie behouden)" : ""}`);
    }
    if (prev?.m?.some((x) => x.s >= nowStamp) && !d.m.some((x) => x.s >= nowStamp)) lost++; // vorige run wel komende wedstrijden, nu niet (na het vangnet)
    if (d.kept) kept++;
    if (d.expired) expired++;
    if (!d.m.length) empty++;
    await writeFile(file, JSON.stringify({ m: d.m, r: results.get(key) || [], p: poulesFor(key), ...(d.z && { z: d.z }) }));
    if (++done % 1000 === 0) console.log(`  ${done}/${teams.length}`);
  });
  console.log(`  klaar: ${done - failed} gelukt, ${failed} mislukt, ${empty} zonder wedstrijden, ${kept} leeg antwoord met vorige versie behouden, ${expired} daarvan na ${KEEP_HOURS} uur alsnog leeg gepubliceerd`);
  console.log(`  diagnose: ${rawEmpty} leeg antwoord, ${kept} behouden, ${lost} van 'wel' naar 'geen' komende wedstrijden`);
  // Alleen een waarschuwing in de Actions-log (de build blijft slagen): een plotselinge stijging is meestal een hapering of wijziging bij Nevobo.
  const warnAt = Math.max(20, Math.ceil(teams.length * 0.02));
  if (kept > warnAt || lost > warnAt) console.log(`::warning::Veel teams met een leeg antwoord van Nevobo: ${rawEmpty} leeg, ${kept} behouden, ${lost} van wel naar geen komende wedstrijden (drempel ${warnAt}).`);
  runStats = ` · leeg antwoord ${rawEmpty}, behouden ${kept}, wel→geen ${lost}`;
  if (failed > teams.length * 0.05) throw new Error("Te veel mislukte verzoeken, ik publiceer niets nieuws.");

  // Vergelijk met de vorige run: een export die plotseling massaal leeg is, publiceren we niet.
  const countWith = async (dir) => {
    if (!existsSync(dir)) return 0;
    let n = 0;
    for (const f of await readdir(dir)) if ((await readFile(`${dir}/${f}`, "utf8").then(JSON.parse).catch(() => null))?.m?.length) n++; // een kapot bestand telt niet mee
    return n;
  };
  const before = LIMIT ? 0 : await countWith(`${DATA}/t`);
  const after = await countWith(`${DATA}/t.new`);
  console.log(`  teams met komende wedstrijden: ${after} (vorige run ${before})`);
  // ALLOW_DROP=1 (handmatige run met "allow_drop") is de noodknop voor een echte seizoenswissel, waarin Nevobo alle programma's leegt.
  if (before > 500 && after < before * 0.5 && !process.env.ALLOW_DROP) throw new Error("Veel minder programma's dan de vorige run, ik publiceer niets nieuws. Is dit een seizoenswissel? Start de workflow handmatig met allow_drop.");

  await rm(`${DATA}/t`, { recursive: true, force: true });
  await cp(`${DATA}/t.new`, `${DATA}/t`, { recursive: true });
  await rm(`${DATA}/t.new`, { recursive: true, force: true });
  await rm(`${DATA}/p`, { recursive: true, force: true });
  await cp(`${DATA}/p.new`, `${DATA}/p`, { recursive: true });
  await rm(`${DATA}/p.new`, { recursive: true, force: true });
  await writeFile(`${DATA}/teams.json`, JSON.stringify({ updated: new Date().toISOString(), teams }));
}

async function fresh() {
  if (process.env.FORCE || !existsSync(`${DATA}/teams.json`) || !existsSync(`${DATA}/t`) || !existsSync(`${DATA}/p`)) return false;
  const { updated } = JSON.parse(await readFile(`${DATA}/teams.json`, "utf8"));
  return Date.now() - new Date(updated) < MAX_AGE_H * 3600e3;
}

if (await fresh()) console.log("Data in _data is nog vers genoeg, ophalen overgeslagen.");
else await fetchData();

await rm(OUT, { recursive: true, force: true });
await cp("site", OUT, { recursive: true });
await mkdir(`${OUT}/data`, { recursive: true });
await cp(`${DATA}/teams.json`, `${OUT}/data/teams.json`);
await cp(`${DATA}/t`, `${OUT}/data/t`, { recursive: true });
if (existsSync(`${DATA}/p`)) await cp(`${DATA}/p`, `${OUT}/data/p`, { recursive: true });

// Nieuwe buildstempel in de service worker, zodat telefoons de nieuwe versie van de app oppakken.
const stamp = process.env.GITHUB_SHA?.slice(0, 7) || String(Date.now());
const sw = (await readFile(`${OUT}/sw.js`, "utf8")).replace("__BUILD__", stamp);
await writeFile(`${OUT}/sw.js`, sw);
const nT = (await readdir(`${OUT}/data/t`)).length;
const nP = existsSync(`${OUT}/data/p`) ? (await readdir(`${OUT}/data/p`)).length : 0;
let withResults = 0, withStand = 0, withMatches = 0;
for (const f of await readdir(`${OUT}/data/t`)) {
  const j = JSON.parse(await readFile(`${OUT}/data/t/${f}`, "utf8"));
  if (j.r?.length) withResults++;
  if (j.p?.length) withStand++;
  if (j.m?.length) withMatches++;
}
const summary = `SAMENVATTING build ${stamp}: ${nT} teams, ${nP} standen; teams met programma ${withMatches}, uitslagen ${withResults}, stand ${withStand}${runStats}`;
console.log(summary);
await writeFile(`${DATA}/summary.txt`, summary + "\n");
