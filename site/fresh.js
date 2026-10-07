// Geldt een keuze nog voor de wedstrijd? Een keuze hoort bij het Nevobo-UID, maar ook bij de starttijd waarop hij is gegeven.
// Verzet Nevobo een wedstrijd (zelfde UID, andere start), dan is de keuze verouderd en telt hij niet meer mee.
// Pure functies, zonder DOM of opslag, zodat `node --test` ze kan draaien.

// Starttijden zijn de ics-DTSTART-string (UTC, bijvoorbeeld 20270306T160000Z), exact vergeleken.
// Ontbreekt een van beide, dan valt er niets te vergelijken en laten we de keuze gelden.
export const sameStart = (a, b) => !a || !b || a === b;

// Keuzes uit de groep voor wedstrijd m ([{ uid, name, status, start }]) die nog gelden.
export const currentFor = (list, m) => (list || []).filter((o) => sameStart(o.start, m.s));

// Eigen lokale keuzes (state.att: id -> [status, start]) die verouderd zijn voor de gegeven wedstrijden.
// Alleen wedstrijden uit `matches` tellen mee: andere teams en verdwenen wedstrijden laten we met rust.
export function staleIds(att, matches) {
  const out = [];
  for (const m of matches || []) {
    const v = att?.[m.i];
    if (Array.isArray(v) && !sameStart(v[1], m.s)) out.push(m.i);
  }
  return out;
}

// Moet reconcile mijn keuze in de groep (r, kan ontbreken) opnieuw schrijven voor wedstrijd m?
// Een document met een nieuwere start dan ons programma overschrijven we niet: dan loopt dit toestel achter.
export function shouldPush(r, m, mine, name) {
  if (!mine) return false;
  if (!r) return true;
  if (r.start && m.s && r.start > m.s) return false;
  return r.status !== mine || r.name !== name || !sameStart(r.start, m.s);
}

// Moet reconcile mijn document in de groep verwijderen omdat ik voor wedstrijd m niets (meer) gekozen heb?
export const shouldDrop = (r, m, mine) => !mine && !!r && !(r.start && m.s && r.start > m.s);

// Waarschuwing "nog niet ingevuld": alleen als er al veel is ingevuld (minstens 3, en minstens de helft) en er een paar ontbreken.
// Wie nog niets of weinig heeft ingevuld, ziet geen waarschuwing; die weet dat hij nog moet beginnen.
// Geeft de ontbrekende wedstrijden terug, of [] als er niets te waarschuwen valt.
export function missingChoices(upcoming, filled) {
  const missing = (upcoming || []).filter((m) => !filled(m));
  const done = (upcoming || []).length - missing.length;
  return missing.length && done >= 3 && missing.length <= done ? missing : [];
}

// ---- Wijzigingen in de aanwezigheid van teamgenoten ----
// Een volleybalteam heeft minstens 6 spelers nodig; zakt een wedstrijd daaronder, dan willen we dat meteen zien.
export const ENOUGH = 6;

// Momentopname van de keuzes van teamgenoten bij één wedstrijd: { uid: [status, naam] }.
export const snapshotOf = (list) => Object.fromEntries((list || []).map((o) => [o.uid, [o.status, o.name]]));

// Verschil tussen de vorige momentopname (base) en nu (cur) voor één wedstrijd. `mine` is 1 als ik zelf ja zeg:
// ik tel mee voor "genoeg", maar mijn eigen keuze is geen wijziging.
// Geeft { changes: [{ name, from, to }], before, now, dropped } terug; dropped = er waren genoeg spelers en nu niet meer.
export function presenceDiff(base, cur, mine = 0) {
  const changes = [];
  // Een lid dat zijn keuzes via een herstel-link overneemt, heeft een nieuw uid maar dezelfde naam: dat is dezelfde persoon.
  const byName = new Map(Object.entries(cur).map(([uid, v]) => [v[1], uid]));
  base = Object.fromEntries(Object.entries(base).map(([uid, v]) => {
    const to = byName.get(v[1]);
    return [!(uid in cur) && to && !(to in base) ? to : uid, v];
  }));
  const yes = (s) => Object.values(s).filter((v) => v[0] === "yes").length + mine;
  for (const uid of new Set([...Object.keys(base), ...Object.keys(cur)])) {
    const from = base[uid]?.[0] || null, to = cur[uid]?.[0] || null;
    if (from !== to) changes.push({ name: (cur[uid] || base[uid])[1], from, to });
  }
  const before = yes(base), now = yes(cur);
  return { changes, before, now, dropped: before >= ENOUGH && now < ENOUGH };
}
