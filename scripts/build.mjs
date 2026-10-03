// Haalt teams en wedstrijdprogramma's bij Nevobo op en bouwt de statische site in ./_site.
// De browser mag api.nevobo.nl zelf niet aanroepen (geen CORS), daarom gebeurt dat hier, op de server.
//
//   node scripts/build.mjs            hergebruik _data als die jonger is dan MAX_AGE_H uur
//   FORCE=1 node scripts/build.mjs    altijd opnieuw ophalen
//   LIMIT=50 node scripts/build.mjs   alleen de eerste 50 teams (om snel te testen)

import { mkdir, readFile, writeFile, rm, cp, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseIcs } from "./ics.mjs";

const API = "https://api.nevobo.nl";
const DATA = "_data";
const OUT = "_site";
const MAX_AGE_H = Number(process.env.MAX_AGE_H || 10);
const LIMIT = Number(process.env.LIMIT || 0);
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, accept, tries = 4) {
  for (let n = 1; ; n++) {
    try {
      const res = await fetch(API + url, { headers: { Accept: accept }, signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (n >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(500 * 2 ** n);
    }
  }
}

async function pool(items, worker, size = CONCURRENCY) {
  let next = 0;
  const run = async () => { while (next < items.length) { const i = next++; await worker(items[i], i); } };
  await Promise.all(Array.from({ length: size }, run));
}

// Een Hydra-collectie heeft maximaal 30 items per pagina; volg hydra:next tot het einde.
async function collection(path) {
  const first = JSON.parse(await get(path, "application/ld+json"));
  const last = first["hydra:view"]?.["hydra:last"];
  const pages = Number(last?.match(/[?&]page=(\d+)/)?.[1] || 1);
  const members = [...first["hydra:member"]];
  const rest = Array.from({ length: pages - 1 }, (_, i) => i + 2);
  const got = new Map();
  const sep = path.includes("?") ? "&" : "?";
  await pool(rest, async (p) => {
    got.set(p, JSON.parse(await get(`${path}${sep}page=${p}`, "application/ld+json"))["hydra:member"]);
  });
  for (const p of rest) members.push(...(got.get(p) || []));
  return members;
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
  await rm(`${DATA}/p`, { recursive: true, force: true });
  await mkdir(`${DATA}/p`, { recursive: true });
  for (const [iri, list] of rows) {
    if (!list.some((r) => r[3] > 0)) continue;
    list.sort((x, y) => (x[0] || 99) - (y[0] || 99));
    shown.add(iri);
    await writeFile(`${DATA}/p/${pouleSlug(iri)}.json`, JSON.stringify({ n: pouleNames.get(iri) || "", cup: isCup(iri), r: list }));
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
  let done = 0, failed = 0, empty = 0;
  console.log("Programma's ophalen…");
  await pool(teams, async ([key]) => {
    const [code, type, nr] = key.split("/");
    const file = `${DATA}/t.new/${fileFor(key)}`;
    const old = `${DATA}/t/${fileFor(key)}`; // vorige versie, als terugval
    let m;
    try {
      const ics = await get(`/export/team/${code.toUpperCase()}/${type}/${nr}/programma.ics`, "text/calendar");
      m = ics ? parseIcs(ics) : [];
    } catch (err) {
      failed++;
      if (failed <= 10) console.warn("  mislukt:", err.message);
      m = existsSync(old) ? JSON.parse(await readFile(old, "utf8")).m || [] : [];
    }
    if (!m.length) empty++;
    await writeFile(file, JSON.stringify({ m, r: results.get(key) || [], p: poulesFor(key) }));
    if (++done % 1000 === 0) console.log(`  ${done}/${teams.length}`);
  });
  console.log(`  klaar: ${done - failed} gelukt, ${failed} mislukt, ${empty} zonder wedstrijden`);
  if (failed > teams.length * 0.05) throw new Error("Te veel mislukte verzoeken, ik publiceer niets nieuws.");

  await rm(`${DATA}/t`, { recursive: true, force: true });
  await cp(`${DATA}/t.new`, `${DATA}/t`, { recursive: true });
  await rm(`${DATA}/t.new`, { recursive: true, force: true });
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
const summary = `SAMENVATTING build ${stamp}: ${nT} teams, ${nP} standen; teams met programma ${withMatches}, uitslagen ${withResults}, stand ${withStand}`;
console.log(summary);
await writeFile(`${DATA}/summary.txt`, summary + "\n");
