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
    // Fetch up to 200 docs, sort client-side — avoids needing a Firestore index
    const res = await fetch(`${BASE}/scores?key=${FIREBASE_API_KEY}&pageSize=200`);
    const data = await res.json();
    if (!data.documents) return [];
    const allScores = data.documents.map((doc) => ({
      name: doc.fields.name.stringValue,
      time: parseInt(doc.fields.time.integerValue, 10),
    }));
    // Keep only each player's best (lowest) time
    const best = new Map();
    for (const entry of allScores) {
      const key = entry.name.toLowerCase();
      if (!best.has(key) || entry.time < best.get(key).time) {
        best.set(key, entry);
      }
    }
    return Array.from(best.values())
      .sort((a, b) => a.time - b.time)
      .slice(0, n);
  } catch (e) {
    console.warn('Failed to fetch scores:', e);
    return [];
  }
}
