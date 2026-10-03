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

// Anoniem inloggen (eenmalig per toestel) en de sleutel ververs je vanzelf.
async function token() {
  if (session && session.exp > Date.now() + 60e3) return session.idToken;
  if (session?.refreshToken) {
    try {
      const j = await post(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE.apiKey}`, { grant_type: "refresh_token", refresh_token: session.refreshToken });
      keep({ idToken: j.id_token, refreshToken: j.refresh_token, uid: j.user_id, exp: Date.now() + Number(j.expires_in) * 1000 });
      return session.idToken;
    } catch { /* val terug op een nieuwe anonieme login */ }
  }
  const j = await post(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`, { returnSecureToken: true });
  keep({ idToken: j.idToken, refreshToken: j.refreshToken, uid: j.localId, exp: Date.now() + Number(j.expiresIn) * 1000 });
  return session.idToken;
}

export async function myUid() {
  await token();
  return session.uid;
}

async function call(path, init = {}) {
  const res = await fetch(DOCS + path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` } });
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

const writeMember = async (code, name) => {
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
  await writeMember(code, name);
}

export const rename = writeMember;

// Verlaat de groep: mijn lidmaatschap en mijn keuzes voor de opgegeven wedstrijden weghalen.
export async function leaveGroup(code, matchIds) {
  const uid = await myUid();
  const gone = (e) => { if (!/404/.test(e.message)) throw e; };
  await Promise.all(matchIds.map((m) => call(`/groups/${code}/rsvp/${san(m)}__${uid}`, { method: "DELETE" }).catch(gone)));
  await call(`/groups/${code}/members/${uid}`, { method: "DELETE" }).catch(gone);
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

// Alle keuzes in de groep, per wedstrijd: Map(match -> [{ uid, name, status }]).
export async function rsvps(code) {
  const out = new Map();
  for (const r of await listAll(`/groups/${code}/rsvp`)) {
    if (!r.match) continue;
    if (!out.has(r.match)) out.set(r.match, []);
    out.get(r.match).push({ uid: r.uid, name: r.name || "?", status: r.status });
  }
  return out;
}
