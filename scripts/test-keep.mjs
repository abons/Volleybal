// Tests voor scripts/keep.mjs: het vorige programma tijdelijk vasthouden bij een leeg antwoord van Nevobo.
// Draai met: node --test "scripts/test-*.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { decideKeep, stampOf } from "./keep.mjs";

const H = 3600e3;
const NOW = Date.parse("2026-10-08T12:00:00Z");
const FUT = { i: "a", s: "20261013T183000Z", t: "x" }; // komt nog
const PAST = { i: "b", s: "20260901T183000Z", t: "y" };
const GOT = [{ i: "c", s: "20261020T183000Z", t: "z" }];

test("stampOf: nu min 3 uur, in de vorm van de ics", () => {
  assert.equal(stampOf(NOW), "20261008T090000Z");
});

test("niet-leeg antwoord: gebruiken, en de reeks lege waarnemingen is voorbij (z weg)", () => {
  const r = decideKeep({ fetched: GOT, prev: { m: [FUT], z: NOW - H }, now: NOW });
  assert.deepEqual(r, { m: GOT, z: undefined, kept: false, expired: false });
});

test("eerste lege waarneming met komende wedstrijden: vasthouden en z = nu", () => {
  const r = decideKeep({ fetched: [], prev: { m: [FUT] }, now: NOW });
  assert.equal(r.kept, true);
  assert.deepEqual(r.m, [FUT]);
  assert.equal(r.z, NOW);
});

test("tweede lege waarneming binnen de grens: vasthouden, z ongewijzigd", () => {
  const z = NOW - 12 * H;
  const r = decideKeep({ fetched: [], prev: { m: [FUT], z }, now: NOW });
  assert.equal(r.kept, true);
  assert.equal(r.z, z);
});

test("lege waarneming op of na de grens: leeg publiceren, z weg", () => {
  const z = NOW - 24 * H;
  const r = decideKeep({ fetched: [], prev: { m: [FUT], z }, now: NOW });
  assert.deepEqual(r, { m: [], z: undefined, kept: false, expired: true });
  const exact = decideKeep({ fetched: [], prev: { m: [FUT], z: NOW - 20 * H }, now: NOW });
  assert.equal(exact.expired, true); // precies op de grens telt als verlopen
});

test("met cron van 12 uur: twee runs vasthouden, de derde publiceert leeg", () => {
  let prev = { m: [FUT] };
  const out = [];
  for (let run = 0; run < 3; run++) {
    const r = decideKeep({ fetched: [], prev, now: NOW + run * 12 * H });
    out.push(r.kept ? "kept" : "leeg");
    prev = { m: r.m, z: r.z };
  }
  assert.deepEqual(out, ["kept", "kept", "leeg"]);
});

test("na publiceren van leeg: volgende run zonder komende wedstrijden bewaart niets meer", () => {
  const r = decideKeep({ fetched: [], prev: { m: [] }, now: NOW });
  assert.deepEqual(r, { m: [], z: undefined, kept: false, expired: false });
});

test("mislukt verzoek: vorige programma en z ongemoeid, telt niet als lege waarneming", () => {
  const z = NOW - 5 * H;
  const r = decideKeep({ fetched: null, prev: { m: [FUT], z }, now: NOW });
  assert.deepEqual(r, { m: [FUT], z, kept: false, expired: false });
  const zonder = decideKeep({ fetched: null, prev: { m: [FUT] }, now: NOW });
  assert.equal(zonder.z, undefined);
  assert.deepEqual(decideKeep({ fetched: null, prev: null, now: NOW }).m, []);
});

test("leeg antwoord, vorige versie had alleen verlopen wedstrijden: niets vasthouden", () => {
  const r = decideKeep({ fetched: [], prev: { m: [PAST] }, now: NOW });
  assert.deepEqual(r, { m: [], z: undefined, kept: false, expired: false });
});

test("ontbrekend of kapot vorig bestand: leeg", () => {
  assert.deepEqual(decideKeep({ fetched: [], prev: null, now: NOW }).m, []);
  assert.deepEqual(decideKeep({ fetched: [], prev: { m: "kapot" }, now: NOW }).m, []);
});

test("z onleesbaar of in de toekomst: telt als nu (begint een nieuwe reeks)", () => {
  for (const z of ["x", NaN, NOW + 5 * H, -1, 0]) {
    const r = decideKeep({ fetched: [], prev: { m: [FUT], z }, now: NOW });
    assert.equal(r.kept, true);
    assert.equal(r.z, NOW);
  }
});

test("oud bestand zonder z werkt (eerste lege waarneming = nu)", () => {
  const r = decideKeep({ fetched: [], prev: { m: [FUT] }, now: NOW, maxHours: 20 });
  assert.equal(r.z, NOW);
});
