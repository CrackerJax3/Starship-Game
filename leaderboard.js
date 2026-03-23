import { FIREBASE_API_KEY, FIREBASE_PROJECT_ID } from './firebase.js';

const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function configured() {
  return !FIREBASE_API_KEY.startsWith('REPLACE') && !FIREBASE_PROJECT_ID.startsWith('REPLACE');
}

export async function submitScore(name, timeMs) {
  if (!configured()) return;
  try {
    await fetch(`${BASE}/scores?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          name: { stringValue: name.trim().slice(0, 20) },
          time: { integerValue: String(Math.round(timeMs)) },
          createdAt: { integerValue: String(Date.now()) },
        },
      }),
    });
  } catch (e) {
    console.warn('Failed to submit score:', e);
  }
}

export async function getTopScores(n = 10) {
  if (!configured()) return [];
  try {
    const res = await fetch(`${BASE}:runQuery?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'scores' }],
          orderBy: [{ field: { fieldPath: 'time' }, direction: 'ASCENDING' }],
          limit: n,
        },
      }),
    });
    const data = await res.json();
    return data
      .filter((item) => item.document)
      .map((item) => ({
        name: item.document.fields.name.stringValue,
        time: parseInt(item.document.fields.time.integerValue, 10),
      }));
  } catch (e) {
    console.warn('Failed to fetch scores:', e);
    return [];
  }
}
