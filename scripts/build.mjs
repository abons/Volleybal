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
  await pool(rest, async (p) => {
    got.set(p, JSON.parse(await get(`${path}?page=${p}`, "application/ld+json"))["hydra:member"]);
  });
  for (const p of rest) members.push(...(got.get(p) || []));
  return members;
}

const fileFor = (key) => key.replace(/\//g, "-") + ".json"; // ckm1h25/dames/1 -> ckm1h25-dames-1.json

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

  await rm(`${DATA}/t.new`, { recursive: true, force: true });
  await mkdir(`${DATA}/t.new`, { recursive: true });
  let done = 0, failed = 0, empty = 0;
  console.log("Programma's ophalen…");
  await pool(teams, async ([key]) => {
    const [code, type, nr] = key.split("/");
    const file = `${DATA}/t.new/${fileFor(key)}`;
    try {
      const ics = await get(`/export/team/${code.toUpperCase()}/${type}/${nr}/programma.ics`, "text/calendar");
      const m = ics ? parseIcs(ics) : [];
      if (!m.length) empty++;
      await writeFile(file, JSON.stringify({ m }));
    } catch (err) {
      failed++;
      const old = `${DATA}/t/${fileFor(key)}`; // val terug op de vorige versie
      if (existsSync(old)) await cp(old, file);
      if (failed <= 10) console.warn("  mislukt:", err.message);
    }
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
  if (process.env.FORCE || !existsSync(`${DATA}/teams.json`) || !existsSync(`${DATA}/t`)) return false;
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

// Nieuwe buildstempel in de service worker, zodat telefoons de nieuwe versie van de app oppakken.
const stamp = process.env.GITHUB_SHA?.slice(0, 7) || String(Date.now());
const sw = (await readFile(`${OUT}/sw.js`, "utf8")).replace("__BUILD__", stamp);
await writeFile(`${OUT}/sw.js`, sw);
console.log(`Site gebouwd in ${OUT}/ (${(await readdir(`${OUT}/data/t`)).length} teambestanden, build ${stamp})`);
