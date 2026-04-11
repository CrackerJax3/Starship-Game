// ─── Sound manager — Web Audio API only ──────────────────────────────────────
// HTMLAudioElement.play() is unreliable across browsers for games.
// AudioBufferSourceNode is the correct approach: load once, play many times.

let _ctx = null;
const _buffers = {};

function _getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

async function _load(key, url, { volume = 1 } = {}) {
  try {
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    const ctx = _getCtx();
    const buf = await ctx.decodeAudioData(arr);
    _buffers[key] = { buf, volume };
  } catch (e) {
    console.warn(`Sound "${key}" failed to load:`, e);
  }
}

// Preload all sounds at startup
_load('explosion',   './sounds/explosion.wav',   { volume: 1.0  });
_load('starlink',    './sounds/starlink.wav',     { volume: 0.8  });
_load('victory',     './sounds/victory.wav',      { volume: 1.0  });
_load('worldrecord', './sounds/worldrecord.mp3',  { volume: 1.0  });
_load('thrust',      './sounds/thrust.mp3',       { volume: 1.0  });

// ─── Unlock — call once from any user-gesture handler ────────────────────────
let _unlocked = false;
export function unlockAudio() {
  if (_unlocked) return;
  _unlocked = true;
  const ctx = _getCtx();
  // Resume AudioContext suspended by browser autoplay policy
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

// ─── One-shot playback ────────────────────────────────────────────────────────
export function playSound(key) {
  const entry = _buffers[key];
  if (!entry) return;
  const ctx = _getCtx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const gain = ctx.createGain();
  gain.gain.value = entry.volume;
  gain.connect(ctx.destination);
  const src = ctx.createBufferSource();
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
    const entry = _buffers['thrust'];
    if (!entry) return;
    const ctx = _getCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    _thrustGain = ctx.createGain();
    _thrustGain.gain.value = THRUST_GAIN;
    _thrustGain.connect(ctx.destination);
    _thrustSource = ctx.createBufferSource();
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

export function stopAllExcept(key) {
  setThrust(false);
  // One-shot sounds stop themselves; nothing else to do
}
