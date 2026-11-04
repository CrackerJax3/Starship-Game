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
    return res.ok;
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
