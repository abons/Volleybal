// Minimale iCalendar-parser voor de programma.ics-exports van Nevobo.

const unescapeText = (s) => s.replace(/\\([,;nN\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));

export function parseIcs(text) {
  // Regels die met een spatie of tab beginnen zijn een voortzetting van de vorige regel.
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT") { if (ev) events.push(ev); ev = null; }
    else if (ev) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const name = line.slice(0, i).split(";")[0].toUpperCase();
      ev[name] = line.slice(i + 1);
    }
  }
  return events
    // Alleen "20261008T190000Z"-tijden; hele dagen (VALUE=DATE) en TZID-tijden laten we weg in plaats van fout te tonen.
    .filter((e) => e.UID && /^\d{8}T\d{6}Z?$/.test(e.DTSTART || "") && e.SUMMARY && e.STATUS !== "CANCELLED")
    .map((e) => ({
      i: e.UID,
      s: e.DTSTART,
      ...(e.DTEND && { e: e.DTEND }),
      t: unescapeText(e.SUMMARY),
      ...(e.LOCATION && { l: unescapeText(e.LOCATION) }),
      ...(e.GEO && { g: e.GEO }),
      ...(e.URL && { u: e.URL }),
    }))
    .sort((a, b) => a.s.localeCompare(b.s));
}

// Sinds 6-11 geeft Nevobo vanaf GitHub voor ~400 teams per run in plaats van het programma één nep-wedstrijd "Actie vereist: voeg een
// nieuwe wedstrijdagenda toe" (1-9 t/m 31-8); lokaal krijgt hetzelfde verzoek het echte programma. Geen antwoord, dus als mislukt behandelen.
export const isPlaceholder = (m) => /^Actie vereist/i.test(m?.t || "");

// Tweede vangnet, voor als Nevobo die tekst verandert: een agenda met precies één event van meer dan 30 dagen. Gemeten 7-11 op 13.836
// live teambestanden (112.932 events): echte wedstrijden duren max. 2 uur, de regel trof 362/362 nep-programma's en 0 echte.
const msOf = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13));
const isLong = (m) => !!m?.e && msOf(m.e) - msOf(m.s) > 30 * 24 * 3600e3;
export const isPlaceholderProgram = (ms) => Array.isArray(ms) && (ms.some(isPlaceholder) || (ms.length === 1 && isLong(ms[0])));
// Zelfde regel als hierboven: een lang event naast echte wedstrijden blijft staan.
export const stripPlaceholders = (ms) => (ms.length === 1 && isLong(ms[0]) ? [] : ms.filter((m) => !isPlaceholder(m)));
