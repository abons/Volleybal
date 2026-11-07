// Tests voor scripts/ics.mjs: het nep-programma van Nevobo herkennen.
// Draai met: node --test "scripts/test-*.mjs"
import test from "node:test";
import assert from "node:assert/strict";
import { parseIcs, isPlaceholder } from "./ics.mjs";

const cal = (summary, start) =>
  `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART:${start}\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

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
