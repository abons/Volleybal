// Tests voor site/fresh.js: keuzes die bij een verzette wedstrijd hangen tellen niet meer mee.
// Draai met: node --test "scripts/test-*.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { sameStart, currentFor, staleIds, shouldPush, shouldDrop, missingChoices } from "../site/fresh.js";

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
