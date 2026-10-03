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
    .filter((e) => e.UID && e.DTSTART && e.SUMMARY && e.STATUS !== "CANCELLED")
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
