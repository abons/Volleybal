// Welke teams hebben een groep? Leest het veld `team` van alle groepsdocumenten in Firestore, met een service-account
// (GitHub-secret FIREBASE_SA, de JSON-sleutel; rol "Cloud Datastore Viewer" is genoeg). Een service-account gaat langs de
// Firestore-regels heen, dus de groepen hoeven daar niet op te sommen te zijn. Alleen de teamsleutels verlaten deze functie.
//
//   GROUP_TEAMS=ckl9q5y/heren/1,ckm1h25/dames/2   vaste lijst in plaats van Firestore (om lokaal te testen)

import { createSign } from "node:crypto";

const b64url = (s) => Buffer.from(s).toString("base64url");

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: sa.token_uri || "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(sa.private_key, "base64url");
  const res = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }),
  });
  if (!res.ok) throw new Error(`token: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

// Geeft { keys: Set(teamsleutel), groups: aantal groepen, withoutTeam: aantal groepen zonder teamveld } of null zonder bron.
export async function groupTeams() {
  if (process.env.GROUP_TEAMS) {
    const keys = new Set(process.env.GROUP_TEAMS.split(",").map((s) => s.trim()).filter(Boolean));
    return { keys, groups: keys.size, withoutTeam: 0 };
  }
  if (!process.env.FIREBASE_SA) return null;
  const sa = JSON.parse(process.env.FIREBASE_SA);
  const token = await accessToken(sa);
  const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "groups" }], select: { fields: [{ fieldPath: "team" }] }, limit: 5000 } }),
  });
  if (!res.ok) throw new Error(`Firestore: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const keys = new Set();
  let groups = 0, withoutTeam = 0;
  for (const row of await res.json()) {
    if (!row.document) continue;
    groups++;
    const team = row.document.fields?.team?.stringValue;
    if (team) keys.add(team);
    else withoutTeam++;
  }
  return { keys, groups, withoutTeam };
}
