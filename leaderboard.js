import { FIREBASE_API_KEY, FIREBASE_PROJECT_ID } from './firebase.js';

const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function configured() {
  return !FIREBASE_API_KEY.startsWith('REPLACE') && !FIREBASE_PROJECT_ID.startsWith('REPLACE');
}

export async function submitScore(name, timeMs) {
  if (!configured()) return;
  try {
    // Only submit if this is a new best for this username (case-insensitive)
    const res = await fetch(`${BASE}/scores?key=${FIREBASE_API_KEY}&pageSize=200`);
    const data = await res.json();
    if (data.documents) {
      const trimmedName = name.trim().slice(0, 20).toLowerCase();
      const existing = data.documents
        .filter((doc) => doc.fields.name.stringValue.toLowerCase() === trimmedName)
        .map((doc) => parseInt(doc.fields.time.integerValue, 10));
      if (existing.length > 0 && Math.min(...existing) <= Math.round(timeMs)) return;
    }
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
    return data.documents
      .map((doc) => ({
        name: doc.fields.name.stringValue,
        time: parseInt(doc.fields.time.integerValue, 10),
      }))
      .reduce((acc, entry) => {
        // Keep only the best time per username (case-insensitive)
        const key = entry.name.toLowerCase();
        const existing = acc.find((e) => e.name.toLowerCase() === key);
        if (!existing || entry.time < existing.time) {
          return [...acc.filter((e) => e.name.toLowerCase() !== key), entry];
        }
        return acc;
      }, [])
      .sort((a, b) => a.time - b.time)
      .slice(0, n);
  } catch (e) {
    console.warn('Failed to fetch scores:', e);
    return [];
  }
}
