import { FIREBASE_API_KEY, FIREBASE_PROJECT_ID } from './firebase.js';

const ROOT = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// Keep these in sync with firestore.rules
export const MIN_TIME_MS = 10000; // anything faster is treated as impossible
export const MAX_TIME_MS = 3600000;
const NAME_MAX = 20;

// Pull more rows than we display so one player with many fast runs
// can't push everyone else off the board after de-duplication.
const FETCH_LIMIT = 100;
const CACHE_MS = 20000;

let cache = null; // { n, at, scores }

function configured() {
  return !FIREBASE_API_KEY.startsWith('REPLACE') && !FIREBASE_PROJECT_ID.startsWith('REPLACE');
}

export function cleanName(name) {
  // eslint-disable-next-line no-control-regex
  return String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX);
}

const docId = (doc) => String(doc?.name || '').split('/').pop() || null;

// Returns the new score's document ID (truthy) on success, otherwise false.
export async function submitScore(name, timeMs) {
  if (!configured()) return false;
  const cleaned = cleanName(name);
  const time = Math.round(timeMs);
  if (!cleaned || !Number.isFinite(time) || time < MIN_TIME_MS || time > MAX_TIME_MS) {
    return false;
  }
  try {
    const res = await fetch(`${ROOT}/scores?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          name: { stringValue: cleaned },
          time: { integerValue: String(time) },
          createdAt: { integerValue: String(Date.now()) },
        },
      }),
    });
    cache = null; // force a fresh read next time
    if (!res.ok) return false;
    const doc = await res.json().catch(() => null);
    return docId(doc) || true;
  } catch (e) {
    console.warn('Failed to submit score:', e);
    return false;
  }
}

// Count how many runs a player has submitted (their "flights").
async function countFlights(name) {
  try {
    const res = await fetch(`${ROOT}:runAggregationQuery?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredAggregationQuery: {
          aggregations: [{ count: {}, alias: 'c' }],
          structuredQuery: {
            from: [{ collectionId: 'scores' }],
            where: {
              fieldFilter: {
                field: { fieldPath: 'name' },
                op: 'EQUAL',
                value: { stringValue: name },
              },
            },
          },
        },
      }),
    });
    const data = await res.json();
    const raw = data?.[0]?.result?.aggregateFields?.c?.integerValue;
    return raw ? parseInt(raw, 10) : 1;
  } catch {
    return 1;
  }
}

export async function getTopScores(n = 10) {
  if (!configured()) return [];
  if (cache && cache.n === n && Date.now() - cache.at < CACHE_MS) return cache.scores;

  try {
    // Server-side ordering: always returns the true fastest times,
    // no matter how many scores have been submitted.
    const res = await fetch(`${ROOT}:runQuery?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'scores' }],
          orderBy: [{ field: { fieldPath: 'time' }, direction: 'ASCENDING' }],
          limit: FETCH_LIMIT,
        },
      }),
    });
    const rows = await res.json();
    if (!Array.isArray(rows)) return cache?.scores ?? [];

    // Keep each player's best time (rows arrive fastest-first)
    const best = new Map();
    for (const row of rows) {
      const f = row.document?.fields;
      if (!f?.name || !f?.time) continue; // eslint-disable-line no-continue
      const entry = {
        id: docId(row.document),
        name: cleanName(f.name.stringValue),
        time: parseInt(f.time.integerValue, 10),
      };
      const key = entry.name.toLowerCase();
      if (entry.name && !best.has(key)) best.set(key, entry);
    }
    const top = Array.from(best.values()).slice(0, n);

    const flights = await Promise.all(top.map((e) => countFlights(e.name)));
    const scores = top.map((e, i) => ({ ...e, flights: flights[i] }));
    cache = { n, at: Date.now(), scores };
    return scores;
  } catch (e) {
    console.warn('Failed to fetch scores:', e);
    return cache?.scores ?? [];
  }
}

// ── Ghosts ──────────────────────────────────────────────────────────────────
// A ghost is stored under the same document ID as the score it belongs to, and
// firestore.rules only accept it if that score exists with the same name and
// time. Kept out of the scores documents so leaderboard reads stay small.
export const GHOST_MAX_CHARS = 200000; // keep in sync with firestore.rules

export async function submitGhost(scoreId, name, timeMs, ghost) {
  if (!configured() || typeof scoreId !== 'string' || !ghost) return false;
  if (ghost.data.length > GHOST_MAX_CHARS) return false;
  try {
    const res = await fetch(`${ROOT}/ghosts?documentId=${encodeURIComponent(scoreId)}&key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          name: { stringValue: cleanName(name) },
          time: { integerValue: String(Math.round(timeMs)) },
          v: { integerValue: String(ghost.v) },
          data: { stringValue: ghost.data },
          splits: { stringValue: JSON.stringify(ghost.splits || {}) },
          createdAt: { integerValue: String(Date.now()) },
        },
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn('Failed to submit ghost:', e);
    return false;
  }
}

const ghostCache = new Map(); // scoreId -> stored ghost or null (none)

export async function fetchGhost(scoreId) {
  if (!configured() || !scoreId) return null;
  if (ghostCache.has(scoreId)) return ghostCache.get(scoreId);
  try {
    const res = await fetch(`${ROOT}/ghosts/${encodeURIComponent(scoreId)}?key=${FIREBASE_API_KEY}`);
    if (res.status === 404) { ghostCache.set(scoreId, null); return null; }
    if (!res.ok) return null; // transient: don't cache
    const f = (await res.json())?.fields;
    let splits = {};
    try { splits = JSON.parse(f?.splits?.stringValue || '{}'); } catch { /* ignore */ }
    const ghost = f ? {
      name: cleanName(f.name?.stringValue),
      time: parseInt(f.time?.integerValue, 10),
      v: parseInt(f.v?.integerValue, 10),
      data: f.data?.stringValue,
      splits,
    } : null;
    ghostCache.set(scoreId, ghost);
    return ghost;
  } catch {
    return null;
  }
}
