// ─── Sound manager — Web Audio API, context created on first user gesture ─────

// Pre-fetch raw audio bytes at module load (no AudioContext needed yet).
// By the time the user clicks Play, data is ready to decode immediately.
const _pending = [
  ['explosion',   './sounds/explosion.wav',   1.0],
  ['starlink',    './sounds/starlink.wav',     0.8],
  ['victory',     './sounds/victory.wav',      1.0],
  ['worldrecord', './sounds/worldrecord.mp3',  1.0],
  ['thrust',      './sounds/thrust.mp3',       1.0],
];

const _fetched = {}; // key → { arr: ArrayBuffer, volume }
for (const [key, url, volume] of _pending) {
  fetch(url)
    .then(r => r.arrayBuffer())
    .then(arr => { _fetched[key] = { arr, volume }; })
    .catch(e => console.warn(`Audio prefetch "${key}" failed:`, e));
}

// ─── AudioContext — created only from a user-gesture handler ─────────────────
let _ctx = null;
const _buffers = {}; // key → { buf: AudioBuffer, volume }

async function _decodeAll(ctx) {
  await Promise.all(
    Object.entries(_fetched).map(async ([key, { arr, volume }]) => {
      try {
        // slice() copies the buffer so decodeAudioData doesn't detach the original
        _buffers[key] = { buf: await ctx.decodeAudioData(arr.slice(0)), volume };
      } catch (e) {
        console.warn(`Audio decode "${key}" failed:`, e);
      }
    })
  );
}

// Call this exactly once from a click/touch handler.
// Creates the AudioContext in a user-gesture context so browsers allow it.
export async function unlockAudio() {
  if (_ctx) return;
  _ctx = new (window.AudioContext || window.webkitAudioContext)();
  // Decode whatever has been fetched so far; any late arrivals decode on demand.
  await _decodeAll(_ctx);
}

// ─── One-shot sound ───────────────────────────────────────────────────────────
export function playSound(key) {
  if (!_ctx) return;
  // If buffer not decoded yet (slow connection), decode on demand
  const entry = _buffers[key];
  if (!entry) {
    const fetched = _fetched[key];
    if (fetched) {
      _ctx.decodeAudioData(fetched.arr.slice(0))
        .then(buf => {
          _buffers[key] = { buf, volume: fetched.volume };
          _play(key);
        })
        .catch(() => {});
    }
    return;
  }
  _play(key);
}

function _play(key) {
  const entry = _buffers[key];
  if (!entry || !_ctx) return;
  const gain = _ctx.createGain();
  gain.gain.value = entry.volume;
  gain.connect(_ctx.destination);
  const src = _ctx.createBufferSource();
  src.buffer = entry.buf;
  src.connect(gain);
  src.start(0);
}

// ─── Looping thrust ───────────────────────────────────────────────────────────
const THRUST_GAIN = 4.0;
let _thrusting = false;
let _thrustSource = null;
let _thrustGain = null;

export function setThrust(active) {
  if (active === _thrusting) return;
  _thrusting = active;
  if (active) {
    if (!_ctx) return;
    const entry = _buffers['thrust'];
    if (!entry) return;
    _thrustGain = _ctx.createGain();
    _thrustGain.gain.value = THRUST_GAIN;
    _thrustGain.connect(_ctx.destination);
    _thrustSource = _ctx.createBufferSource();
    _thrustSource.buffer = entry.buf;
    _thrustSource.loop = true;
    _thrustSource.connect(_thrustGain);
    _thrustSource.start(0);
  } else {
    if (_thrustSource) {
      try { _thrustSource.stop(); } catch {}
      _thrustSource.disconnect();
      _thrustSource = null;
    }
    if (_thrustGain) {
      _thrustGain.disconnect();
      _thrustGain = null;
    }
  }
}

export function stopAllSounds() {
  setThrust(false);
}

export function stopAllExcept(_key) {
  setThrust(false);
}
