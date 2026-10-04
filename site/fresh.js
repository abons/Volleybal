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
