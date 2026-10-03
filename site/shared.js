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

// Mijn keuze voor een wedstrijd opslaan (status null = verwijderen).
export async function put({ team, match, start, name, status }) {
  const uid = await myUid();
  const path = `/rsvp/${san(match)}__${uid}`;
  if (!status) return call(path, { method: "DELETE" }).catch((e) => { if (!/404/.test(e.message)) throw e; });
  return call(path, { method: "PATCH", body: JSON.stringify({ fields: { uid: str(uid), team: str(team), match: str(match), start: str(start), name: str(name), status: str(status) } }) });
}

// Alle keuzes van een team, gegroepeerd per wedstrijd: Map(match -> [{ uid, name, status }]).
export async function team(key) {
  const rows = await call(":runQuery", { method: "POST", body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "rsvp" }], where: { fieldFilter: { field: { fieldPath: "team" }, op: "EQUAL", value: str(key) } } } }) });
  const out = new Map();
  for (const r of rows) {
    const f = r.document?.fields;
    if (!f) continue;
    const m = f.match?.stringValue;
    if (!m) continue;
    if (!out.has(m)) out.set(m, []);
    out.get(m).push({ uid: f.uid?.stringValue, name: f.name?.stringValue || "?", status: f.status?.stringValue });
  }
  return out;
}
