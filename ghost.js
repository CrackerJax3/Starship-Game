// Time-trial ghosts: record the player's flight, replay someone else's.
//
// A recording is a flat Int32 list of samples keyed by mission time:
//   [t, flags, fullX, fullY, fullRot, topX, topY, topRot, bottomX, bottomY, bottomRot]
// flags: 1 = full stack visible, 2 = Starship visible, 4 = Booster visible.
// Rotations are stored in tenths of a degree. Mission time rewinds on a
// checkpoint restart, so samples later than the current time are dropped; the
// saved path is therefore exactly the one the final time came from.

export const GHOST_VERSION = 1;
const SAMPLE_MS = 125;
const FIELDS = 11;
const MAX_SAMPLES = 2400; // 5 minutes; longer runs are not uploaded
const ENABLED_KEY = 'ghostsEnabled';
const LOCAL_KEY = 'bestGhost';

export const FLAG_FULL = 1;
export const FLAG_TOP = 2;
export const FLAG_BOTTOM = 4;

// ── Setting ─────────────────────────────────────────────────────────────────
export function ghostsEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) !== 'false'; } catch { return true; }
}
export function setGhostsEnabled(on) {
  try { localStorage.setItem(ENABLED_KEY, on ? 'true' : 'false'); } catch { /* ignore */ }
}

// ── Encoding ────────────────────────────────────────────────────────────────
export function encodeSamples(int32) {
  const bytes = new Uint8Array(int32.buffer, int32.byteOffset, int32.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function decodeSamples(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  if (bytes.length % (4 * FIELDS) !== 0) throw new Error('bad ghost length');
  return new Int32Array(bytes.buffer);
}

// ── Recording ───────────────────────────────────────────────────────────────
export class GhostRecorder {
  constructor() { this.reset(); }

  reset() {
    this.samples = [];
    this.splits = {};
    this.overflow = false;
  }

  // Drop anything recorded after mission time t (checkpoint rewind).
  rewindTo(t) {
    while (this.samples.length && this.samples[this.samples.length - 1][0] > t) this.samples.pop();
    Object.keys(this.splits).forEach((k) => { if (this.splits[k] > t) delete this.splits[k]; });
  }

  sample(game, force = false) {
    const t = Math.round(game.missionTime);
    const last = this.samples[this.samples.length - 1];
    if (last && t < last[0]) this.rewindTo(t);
    const prev = this.samples[this.samples.length - 1];
    if (!force && prev && t - prev[0] < SAMPLE_MS) return;
    if (this.samples.length >= MAX_SAMPLES) { this.overflow = true; return; }
    const full = game.ship === game.shipFull;
    const flags = full ? FLAG_FULL : FLAG_TOP | FLAG_BOTTOM;
    const p = (s) => [Math.round(s.x), Math.round(s.y), Math.round(s.rotation * 10)];
    this.samples.push([
      t, flags,
      ...(full ? p(game.shipFull) : [0, 0, 0]),
      ...(full ? [0, 0, 0] : p(game.shipTop)),
      ...(full ? [0, 0, 0] : p(game.shipBottom)),
    ]);
  }

  split(stage, missionTime) {
    this.splits[stage] = Math.round(missionTime);
  }

  // Finished recording ready to store, or null if unusable.
  finish(game) {
    this.sample(game, true);
    if (this.overflow || this.samples.length < 8) return null;
    const flat = new Int32Array(this.samples.length * FIELDS);
    this.samples.forEach((s, i) => flat.set(s, i * FIELDS));
    return { v: GHOST_VERSION, data: encodeSamples(flat), splits: { ...this.splits } };
  }
}

// ── Playback ────────────────────────────────────────────────────────────────
// Turn a stored ghost ({ name, time, v, data, splits }) into a playable one.
export function loadGhost(stored, source) {
  if (!stored || stored.v !== GHOST_VERSION || typeof stored.data !== 'string') return null;
  try {
    const samples = decodeSamples(stored.data);
    return {
      name: stored.name,
      time: stored.time,
      splits: stored.splits || {},
      samples,
      count: samples.length / FIELDS,
      source,
    };
  } catch {
    return null;
  }
}

function lerpAngle(a, b, f) {
  const d = ((((b - a) % 3600) + 5400) % 3600) - 1800;
  return (a + d * f) / 10;
}

// Interpolated pose at mission time t: { flags, full, top, bottom } or null
// once the ghost has finished (it then rests at its final pose).
export function ghostPose(ghost, t) {
  const s = ghost.samples;
  const n = ghost.count;
  if (!n) return null;
  // Binary search for the last sample with time <= t.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1; // eslint-disable-line no-bitwise
    if (s[mid * FIELDS] <= t) lo = mid; else hi = mid - 1;
  }
  const a = lo * FIELDS;
  const b = Math.min(lo + 1, n - 1) * FIELDS;
  const span = s[b] - s[a];
  // Don't blend across a stage change (flags differ): snap instead.
  const f = span > 0 && s[a + 1] === s[b + 1] ? Math.min(Math.max((t - s[a]) / span, 0), 1) : 0;
  const part = (o) => ({
    x: s[a + o] + (s[b + o] - s[a + o]) * f,
    y: s[a + o + 1] + (s[b + o + 1] - s[a + o + 1]) * f,
    rotation: lerpAngle(s[a + o + 2], s[b + o + 2], f),
  });
  return {
    flags: s[a + 1],
    full: part(2),
    top: part(5),
    bottom: part(8),
  };
}

// ── Choosing who to race ────────────────────────────────────────────────────
// Leaderboard entries to try, best match first: the player one place ahead of
// you; yourself if you are #1; #10 (the spot to break into) if you are not on
// the board. Older scores have no ghost, so later entries are fallbacks.
export function ghostCandidates(scores, playerName) {
  if (!scores?.length) return [];
  const me = String(playerName || '').toLowerCase();
  const idx = scores.findIndex((e) => e.name.toLowerCase() === me);
  let start;
  if (idx === 0) start = 0;
  else if (idx > 0) start = idx - 1;
  else start = scores.length - 1;
  const order = [];
  for (let i = start; i >= 0; i -= 1) order.push(scores[i]);
  return order.filter((e) => e.id).slice(0, 4);
}

// ── Local copy of your own best ─────────────────────────────────────────────
export function saveLocalGhost(stored) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(stored)); } catch { /* quota: ignore */ }
}
export function localGhost() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); } catch { return null; }
}
