// Tests voor scripts/ics.mjs: het nep-programma van Nevobo herkennen.
// Draai met: node --test "scripts/test-*.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { parseIcs, isPlaceholder, isPlaceholderProgram, stripPlaceholders } from "./ics.mjs";

const cal = (summary, start, end) =>
  `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:${start}\r\n${end ? `DTEND:${end}\r\n` : ""}SUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const match = (s, e, t = "A HS 1 - B HS 1") => ({ i: s, s, e, t });

test("isPlaceholder: de nep-wedstrijd 'Actie vereist' van Nevobo", () => {
  const m = parseIcs(cal("Actie vereist: voeg een nieuwe wedstrijdagenda toe", "20260901T000000"));
  assert.equal(m.length, 1);
  assert.ok(isPlaceholder(m[0]));
});

test("isPlaceholder: een gewone wedstrijd niet", () => {
  const m = parseIcs(cal("Bernisse HS 2 - OKK '70 HS 4", "20261121T154500Z"));
  assert.ok(!isPlaceholder(m[0]));
  assert.ok(!isPlaceholder(undefined));
});

test("isPlaceholderProgram: het nep-programma zoals Nevobo het geeft", () => {
  assert.ok(isPlaceholderProgram(parseIcs(cal("Actie vereist: voeg een nieuwe wedstrijdagenda toe", "20260901T000000", "20270831T000000"))));
});

test("isPlaceholderProgram: andere tekst, één event van een heel seizoen", () => {
  assert.ok(isPlaceholderProgram(parseIcs(cal("Let op: nieuwe agenda", "20260901T000000", "20270831T000000"))));
});

test("isPlaceholderProgram: echte programma's niet, ook geen toernooidag of -weekend", () => {
  assert.ok(!isPlaceholderProgram([match("20261107T154500Z", "20261107T174500Z")]));
  assert.ok(!isPlaceholderProgram([match("20261107T080000Z", "20261108T180000Z", "Beachtoernooi")]));
  assert.ok(!isPlaceholderProgram([match("20261107T154500Z", undefined)]));
  assert.ok(!isPlaceholderProgram([]));
  assert.ok(!isPlaceholderProgram(null));
  // Lang event naast echte wedstrijden: geen nep-programma (de regel vraagt precies één event).
  assert.ok(!isPlaceholderProgram([match("20260901T000000", "20270831T000000", "Seizoen"), match("20261107T154500Z", "20261107T174500Z")]));
});

test("stripPlaceholders: haalt nep-events weg, laat wedstrijden staan", () => {
  const real = match("20261107T154500Z", "20261107T174500Z");
  assert.deepEqual(stripPlaceholders([match("20260901T000000", "20270831T000000", "Actie vereist: x"), real]), [real]);
  assert.deepEqual(stripPlaceholders([match("20260901T000000", "20270831T000000", "Iets anders")]), []);
});
