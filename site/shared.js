// Aanwezigheid delen via Firebase (anonieme login + Firestore), zonder SDK: alleen de REST-API's.
// Zonder instellingen in firebase-config.js is `enabled` false en blijft alles lokaal.
import { FIREBASE } from "./firebase-config.js";

export const enabled = !!(FIREBASE.apiKey && FIREBASE.projectId);

const AUTH = "volleybal.auth";
const DOCS = enabled ? `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents` : "";
const san = (s) => s.replace(/[^A-Za-z0-9_-]/g, "_");

let session = null; // { idToken, refreshToken, uid, exp }
try { session = JSON.parse(localStorage.getItem(AUTH)); } catch { /* geen opslag */ }

function keep(s) {
  session = s;
  try { localStorage.setItem(AUTH, JSON.stringify(s)); } catch { /* privémodus */ }
}

async function post(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Anoniem inloggen (eenmalig per toestel); de sleutel ververs je vanzelf.
// Alleen bij een ongeldig of verlopen refresh-token (HTTP 400) maken we een nieuwe anonieme gebruiker: bij een
// netwerkfout of serverfout geven we de fout door, anders raak je ongemerkt je groep kwijt.
let pending = null; // lopende inlog of verversing, zodat gelijktijdige aanroepen één uid delen

async function login() {
  if (session?.refreshToken) {
    try {
      const j = await post(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE.apiKey}`, { grant_type: "refresh_token", refresh_token: session.refreshToken });
      keep({ idToken: j.id_token, refreshToken: j.refresh_token, uid: j.user_id, exp: Date.now() + Number(j.expires_in) * 1000 });
      return;
    } catch (e) {
      if (e.message !== "HTTP 400") throw e;
    }
  }
  const j = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`, { returnSecureToken: true });
  keep({ idToken: j.idToken, refreshToken: j.refreshToken, uid: j.localId, exp: Date.now() + Number(j.expiresIn) * 1000 });
}

async function token() {
  if (session && session.exp > Date.now() + 60e3) return session.idToken;
  pending ||= login().finally(() => { pending = null; });
  await pending;
  return session.idToken;
}

export async function myUid() {
  await token();
  return session.uid;
}

async function call(path, init = {}, retried = false) {
  const res = await fetch(DOCS + path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` } });
  if (res.status === 401 && !retried) { // token afgewezen: één keer verversen en opnieuw proberen
    if (session) session.exp = 0;
    return call(path, init, true);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const str = (v) => ({ stringValue: v });
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, str(v)]));
const plain = (d) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, v.stringValue]));

// ---- Groepen: de code is de enige beveiliging ----
// 10 tekens uit 32 (zonder I en O, 0 en 1): ongeveer 50 bit, niet te raden en niet op te sommen.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 10;
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join("");
}
export const cleanCode = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
export const validCode = (c) => c.length === CODE_LENGTH && [...c].every((ch) => ALPHABET.includes(ch));

// Lid-document schrijven of herstellen (bijvoorbeeld nadat een teamgenoot je als "spook" heeft verwijderd).
export const writeMember = async (code, name) => {
  const uid = await myUid();
  return call(`/groups/${code}/members/${uid}`, { method: "PATCH", body: JSON.stringify({ fields: fields({ uid, name }) }) });
};

export async function createGroup(code, name) {
  const uid = await myUid();
  await call(`/groups/${code}`, { method: "PATCH", body: JSON.stringify({ fields: fields({ by: uid, created: new Date().toISOString() }) }) });
  await writeMember(code, name);
}

// Gooit Error("notfound") als de code niet bestaat.
export async function joinGroup(code, name) {
  try { await call(`/groups/${code}`); }
  catch (e) { throw /404/.test(e.message) ? new Error("notfound") : e; }
  if (name) await writeMember(code, name); // zonder naam kijk je alleen mee
}

// Query binnen een groep: Map-achtige lijst van velden.
async function query(code, where) {
  const rows = await call(`/groups/${code}:runQuery`, { method: "POST", body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "rsvp" }], where, limit: 1000 } }) });
  return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split("/").pop(), ...plain(r.document) }));
}
const gone = (e) => { if (!/404/.test(e.message)) throw e; };
const ofUid = (code, uid) => query(code, { fieldFilter: { field: { fieldPath: "uid" }, op: "EQUAL", value: str(uid) } });
const mine = async (code) => ofUid(code, await myUid());

// Naam wijzigen: lid-document en al mijn keuzes in de groep krijgen de nieuwe naam.
export async function rename(code, name) {
  await writeMember(code, name);
  await Promise.all((await mine(code)).map((r) => call(`/groups/${code}/rsvp/${r.id}`, { method: "PATCH", body: JSON.stringify({ fields: fields({ uid: r.uid, match: r.match, start: r.start, name, status: r.status }) }) })));
}

// Een lid met zijn keuzes uit de groep halen: eerst het lid-document (faalt dat, dan blijft alles zoals het was), daarna de keuzes.
// Voor een ander lid moet firestore.rules dat toestaan; bedoeld voor "spoken" van toestellen die hun opslag kwijt zijn.
// Alle keuzes van één speler in de groep (voor het overnemen na verlies van opslag).
export const rsvpsOf = (code, uid) => ofUid(code, uid);

export async function removeMember(code, uid) {
  await call(`/groups/${code}/members/${uid}`, { method: "DELETE" }).catch(gone);
  await Promise.all((await ofUid(code, uid)).map((r) => call(`/groups/${code}/rsvp/${r.id}`, { method: "DELETE" }).catch(gone)));
}

// Verlaat de groep: eerst mijn lidmaatschap (faalt dat, dan blijft alles zoals het was), daarna mijn keuzes opruimen.
export async function leaveGroup(code) {
  const uid = await myUid();
  await call(`/groups/${code}/members/${uid}`, { method: "DELETE" }).catch(gone);
  try { await Promise.all((await ofUid(code, uid)).map((r) => call(`/groups/${code}/rsvp/${r.id}`, { method: "DELETE" }).catch(gone))); } catch { /* best effort */ }
}

async function listAll(path) {
  const out = [];
  let page = "";
  do {
    const j = await call(`${path}?pageSize=300${page ? "&pageToken=" + encodeURIComponent(page) : ""}`);
    out.push(...(j.documents || []));
    page = j.nextPageToken || "";
  } while (page);
  return out.map(plain);
}

export const members = (code) => listAll(`/groups/${code}/members`);

// Mijn keuze voor een wedstrijd opslaan (status null = verwijderen).
export async function put({ code, match, start, name, status }) {
  const uid = await myUid();
  const path = `/groups/${code}/rsvp/${san(match)}__${uid}`;
  if (!status) return call(path, { method: "DELETE" }).catch((e) => { if (!/404/.test(e.message)) throw e; });
  return call(path, { method: "PATCH", body: JSON.stringify({ fields: fields({ uid, match, start, name, status }) }) });
}

// Keuzes in de groep voor aankomende wedstrijden (start >= gisteren), per wedstrijd: Map(match -> [{ uid, name, status, start }]).
// `start` is de starttijd waarop de keuze is gegeven; vergelijk hem met de huidige start van de wedstrijd (fresh.js).
export async function rsvps(code) {
  const d = new Date(Date.now() - 864e5);
  const from = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const out = new Map();
  for (const r of await query(code, { fieldFilter: { field: { fieldPath: "start" }, op: "GREATER_THAN_OR_EQUAL", value: str(from) } })) {
    if (!r.match) continue;
    if (!out.has(r.match)) out.set(r.match, []);
    out.get(r.match).push({ uid: r.uid, name: r.name || "?", status: r.status, start: r.start });
  }
  return out;
}

// Teamgenoot toevoegen: een nieuwe anonieme gebruiker (eigen uid en token, alleen in het geheugen) schrijft zijn eigen lid-document en
// keuzes, precies zoals zijn eigen toestel dat zou doen; firestore.rules hoeft dus niet te veranderen. Met zijn herstel-link
// (`&naam=…&id=<uid>`) neemt die teamgenoot later dat lid over. picks: [{ match, start, status }]. Geeft het uid terug.
export async function addProxyMember(code, name, picks) {
  const j = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`, { returnSecureToken: true });
  const uid = j.localId;
  const write = async (path, f) => {
    const res = await fetch(DOCS + path, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${j.idToken}` }, body: JSON.stringify({ fields: fields(f) }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  };
  await write(`/groups/${code}/members/${uid}`, { uid, name });
  await Promise.all(picks.map((p) => write(`/groups/${code}/rsvp/${san(p.match)}__${uid}`, { uid, match: p.match, start: p.start, name, status: p.status })));
  return uid;
}
