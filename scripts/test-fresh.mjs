// Tests voor site/fresh.js: keuzes die bij een verzette wedstrijd hangen tellen niet meer mee.
// Draai met: node --test "scripts/test-*.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { sameStart, currentFor, staleIds, shouldPush, shouldDrop, missingChoices, presenceDiff, normName, keyType, candidatesFor, pickTarget, groupConfirms } from "../site/fresh.js";

const MOVED = { i: "083045eb753448140d4b3dd92f504d76", s: "20270306T160000Z" }; // was 27 feb
const SAME = { i: "0d90975dd78f15c1a77ae665b61bf283", s: "20261114T170000Z" };
const names = ["Jitse", "Casper", "Ronald", "Sven", "Niek", "Chris", "Tim", "Jochem"];
const group = (start) => names.map((name, k) => ({ uid: `u${k}`, name, status: "yes", start }));

test("sameStart: exact gelijk, of niets om te vergelijken", () => {
  assert.equal(sameStart("20270306T160000Z", "20270306T160000Z"), true);
  assert.equal(sameStart("20270227T160000Z", "20270306T160000Z"), false);
  assert.equal(sameStart(undefined, "20270306T160000Z"), true);
  assert.equal(sameStart("", "20270306T160000Z"), true);
  assert.equal(sameStart("20270306T160000Z", undefined), true);
});

test("verzette wedstrijd: keuzes met de oorspronkelijke datum tellen niet mee", () => {
  assert.deepEqual(currentFor(group("20270227T160000Z"), MOVED), []);
});

test("alleen de tijd verschuift (16:00 naar 18:00): ook verouderd", () => {
  const m = { i: "x", s: "20270306T180000Z" };
  assert.deepEqual(currentFor(group("20270306T160000Z"), m), []);
});

test("ongewijzigde wedstrijd: alle keuzes blijven tellen", () => {
  assert.equal(currentFor(group(SAME.s), SAME).length, 8);
});

test("gemengd: alleen de keuzes met de huidige start blijven over", () => {
  const list = [{ uid: "a", name: "Oud", status: "yes", start: "20270227T160000Z" }, { uid: "b", name: "Nieuw", status: "no", start: MOVED.s }];
  assert.deepEqual(currentFor(list, MOVED).map((o) => o.name), ["Nieuw"]);
});

test("openNames-gedrag: wie niet in de gefilterde lijst staat, komt bij 'nog niet gereageerd'", () => {
  const members = names.map((name, k) => ({ uid: `u${k}`, name }));
  const done = new Set(currentFor(group("20270227T160000Z"), MOVED).map((o) => o.uid));
  assert.equal(members.filter((o) => !done.has(o.uid)).length, 8);
});

test("currentFor met ontbrekende lijst", () => {
  assert.deepEqual(currentFor(undefined, MOVED), []);
});

test("staleIds: eigen verouderde keuze, alleen voor wedstrijden van het geladen programma", () => {
  const att = { [MOVED.i]: ["yes", "20270227T160000Z"], [SAME.i]: ["maybe", SAME.s], elders: ["no", "20270101T100000Z"], leeg: ["yes"] };
  assert.deepEqual(staleIds(att, [MOVED, SAME, { i: "leeg", s: "20270102T100000Z" }]), [MOVED.i]);
  assert.deepEqual(staleIds(att, null), []);
});

test("shouldPush: nieuwe keuze, afwijkende status of start, maar niet over een nieuwer document heen", () => {
  const r = (o) => ({ status: "yes", name: "Axel", start: MOVED.s, ...o });
  assert.equal(shouldPush(null, MOVED, "yes", "Axel"), true);
  assert.equal(shouldPush(r(), MOVED, "yes", "Axel"), false);
  assert.equal(shouldPush(r({ status: "no" }), MOVED, "yes", "Axel"), true);
  assert.equal(shouldPush(r({ name: "A" }), MOVED, "yes", "Axel"), true);
  assert.equal(shouldPush(r({ start: "20270227T160000Z" }), MOVED, "yes", "Axel"), true); // document verouderd: bijwerken
  assert.equal(shouldPush(r({ start: "20270313T160000Z" }), MOVED, "yes", "Axel"), false); // dit toestel loopt achter
  assert.equal(shouldPush(r(), MOVED, null, "Axel"), false);
});

test("shouldDrop: eigen document zonder lokale keuze weg, behalve bij een nieuwer document", () => {
  const doc = { status: "yes", start: "20270227T160000Z" };
  assert.equal(shouldDrop(doc, MOVED, null), true);
  assert.equal(shouldDrop({ ...doc, start: "20270313T160000Z" }, MOVED, null), false);
  assert.equal(shouldDrop(doc, MOVED, "yes"), false);
  assert.equal(shouldDrop(undefined, MOVED, null), false);
});

test("missingChoices: waarschuwt alleen als er veel is ingevuld en een paar ontbreken", () => {
  const ms = (n) => Array.from({ length: n }, (_, k) => ({ i: `m${k}`, s: "x" }));
  const filledFirst = (n) => (m) => Number(m.i.slice(1)) < n;
  assert.deepEqual(missingChoices(ms(10), filledFirst(8)).map((m) => m.i), ["m8", "m9"]);
  assert.deepEqual(missingChoices(ms(10), filledFirst(10)), []); // alles ingevuld
  assert.deepEqual(missingChoices(ms(10), filledFirst(0)), []); // nog niets ingevuld: geen waarschuwing
  assert.deepEqual(missingChoices(ms(10), filledFirst(2)), []); // te weinig ingevuld
  assert.deepEqual(missingChoices(ms(10), filledFirst(4)), []); // meer dan de helft ontbreekt
  assert.equal(missingChoices(ms(6), filledFirst(3)).length, 3); // precies de helft telt nog mee
  assert.deepEqual(missingChoices(undefined, filledFirst(3)), []);
});

test("presenceDiff: genoeg spelers, nu niet meer", () => {
  const base = Object.fromEntries(names.slice(0, 6).map((n, k) => [`u${k}`, ["yes", n]]));
  const cur = { ...base, u2: ["no", "Ronald"] };
  const d = presenceDiff(base, cur);
  assert.deepEqual(d.changes, [{ name: "Ronald", from: "yes", to: "no" }]);
  assert.equal(d.before, 6); assert.equal(d.now, 5); assert.equal(d.dropped, true);
  assert.equal(presenceDiff(base, cur, 1).dropped, false); // ik tel zelf ook mee
});

test("presenceDiff: onveranderd, verdwenen keuze en nooit genoeg", () => {
  const base = { u1: ["yes", "Jitse"], u2: ["maybe", "Casper"] };
  assert.deepEqual(presenceDiff(base, base).changes, []);
  assert.deepEqual(presenceDiff(base, { u1: ["yes", "Jitse"] }).changes, [{ name: "Casper", from: "maybe", to: null }]);
  assert.equal(presenceDiff({ u1: ["yes", "Jitse"] }, {}).dropped, false); // er waren er nooit genoeg
});

test("presenceDiff: herstel-link (nieuw uid, zelfde naam) is geen wijziging", () => {
  assert.deepEqual(presenceDiff({ old: ["yes", "Casper"] }, { new: ["yes", "Casper"] }).changes, []);
  assert.deepEqual(presenceDiff({ old: ["yes", "Casper"] }, { new: ["no", "Casper"] }).changes, [{ name: "Casper", from: "yes", to: "no" }]);
});

// ---- Team verhuizen als Nevobo de teamsleutel verandert ----
const TEAMS = [
  { key: "old/heren/2", naam: "Bernisse HS 2", club: "Bernisse" },
  { key: "new/heren/2", naam: "Bernisse HS 2", club: "Bernisse" },
  { key: "new/dames/2", naam: "Bernisse HS 2", club: "Bernisse" }, // ander type
  { key: "x/heren/2", naam: "Bernisse HS 2", club: "Ander" }, // andere club
  { key: "y/heren/1", naam: "Bernisse HS 1", club: "Bernisse" }, // andere naam
];

test("normName: spaties, hoofdletters, accenten en leestekens tellen niet, fuzzy matching ook niet", () => {
  assert.equal(normName("Bernisse HS 2"), normName("bernisse  h s 2"));
  assert.equal(normName("OKK '70 HS 4"), normName("okk 70 hs 4"));
  assert.equal(normName("Café"), normName("cafe"));
  assert.notEqual(normName("Bernisse HS 2"), normName("Bernisse HS 3"));
  assert.equal(normName(undefined), "");
});

test("keyType: het type uit club/type/nr", () => {
  assert.equal(keyType("ckm1b6p/heren/2"), "heren");
  assert.equal(keyType(""), "");
});

test("candidatesFor: zelfde naam, club en type; niet de sleutel zelf", () => {
  const c = candidatesFor(TEAMS, { naam: "Bernisse HS 2", club: "Bernisse", type: "heren" }, "old/heren/2");
  assert.deepEqual(c.map((t) => t.key), ["new/heren/2"]);
  assert.deepEqual(candidatesFor(TEAMS, { naam: "", club: "Bernisse", type: "heren" }, "old/heren/2"), []);
  assert.deepEqual(candidatesFor(null, { naam: "x", club: "y", type: "z" }, "k"), []);
});

const prog = (o) => new Map(Object.entries(o));

test("pickTarget: precies één kandidaat met komende wedstrijden", () => {
  const cands = TEAMS.slice(1, 2);
  assert.equal(pickTarget(cands, prog({ "new/heren/2": { ok: true, upcoming: true } })).target.key, "new/heren/2");
});

test("pickTarget: kandidaat zonder programma, of meerdere met programma: niets doen", () => {
  const two = [TEAMS[0], TEAMS[1]];
  assert.deepEqual(pickTarget([TEAMS[1]], prog({ "new/heren/2": { ok: true, upcoming: false } })), {});
  assert.deepEqual(pickTarget(two, prog({ "old/heren/2": { ok: true, upcoming: true }, "new/heren/2": { ok: true, upcoming: true } })), {});
  assert.deepEqual(pickTarget([], prog({})), {});
});

test("pickTarget: een mislukt geladen programma is geen leeg programma (onzeker)", () => {
  const two = [TEAMS[0], TEAMS[1]];
  assert.deepEqual(pickTarget(two, prog({ "old/heren/2": { ok: false }, "new/heren/2": { ok: true, upcoming: true } })), { uncertain: true });
  assert.deepEqual(pickTarget([TEAMS[1]], prog({})), { uncertain: true }); // ontbreekt helemaal
});

test("groupConfirms: het groepsdocument moet hetzelfde team noemen", () => {
  const to = TEAMS[1];
  assert.equal(groupConfirms({ naam: "bernisse hs 2", club: "Bernisse" }, to), true);
  assert.equal(groupConfirms({ naam: "Bernisse HS 1", club: "Bernisse" }, to), false);
  assert.equal(groupConfirms({ naam: "Bernisse HS 2", club: "Ander" }, to), false);
  assert.equal(groupConfirms({}, to), false); // groep zonder teamnaam: niets bevestigd
  assert.equal(groupConfirms(null, to), false);
});
