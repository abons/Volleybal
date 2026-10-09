// Beslist wat er in het teambestand komt als Nevobo een leeg programma geeft: het vorige programma tijdelijk vasthouden, maar niet
// onbegrensd. Zo is een hapering van de export (leeg antwoord) onzichtbaar, en blijft een echt verdwenen of verhuisd team niet weken
// met een bevroren programma staan (de app ziet dan geen wedstrijden en kan verhuizen).
//
// z = tijdstip (ms sinds 1970) van de eerste lege waarneming in de lopende reeks. Het veld staat alleen in het teambestand zolang we
// vasthouden; de app leest het niet.

// nowStamp: "20261008T143000Z"-vorm van (nu - 3 uur), zelfde marge als de app. Starttijden zijn UTC-strings; zonder Z is het een lokale
// tijd, dus maximaal een paar uur scheef, en de marge van 3 uur dekt dat.
export const stampOf = (ms) => new Date(ms - 3 * 3600e3).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

// fetched: geparste wedstrijden, of null als het verzoek mislukte. prev: { m, z } van de vorige run, of null.
// Geeft { m, z, kept, expired }; z is undefined als het veld niet in het bestand hoeft.
export function decideKeep({ fetched, prev, now, maxHours = 20 }) {
  const prevM = Array.isArray(prev?.m) ? prev.m : [];
  const prevZ = Number.isFinite(prev?.z) && prev.z > 0 && prev.z <= now ? prev.z : undefined; // onleesbaar of in de toekomst: telt niet
  if (fetched === null) return { m: prevM, z: prevZ, kept: false, expired: false }; // mislukt verzoek: niets veranderen, geen lege waarneming
  if (fetched.length) return { m: fetched, z: undefined, kept: false, expired: false }; // weer wedstrijden: reeks voorbij
  const stamp = stampOf(now);
  if (!prevM.some((x) => x.s >= stamp)) return { m: [], z: undefined, kept: false, expired: false }; // niets om vast te houden
  const z = prevZ ?? now;
  if (now - z < maxHours * 3600e3) return { m: prevM, z, kept: true, expired: false };
  return { m: [], z: undefined, kept: false, expired: true }; // te lang leeg: publiceer het lege programma
}
