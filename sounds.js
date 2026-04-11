// ─── Sound manager ────────────────────────────────────────────────────────────

function load(src, { loop = false, volume = 1 } = {}) {
  const audio = new Audio(src);
  audio.preload = 'auto';
  audio.loop = loop;
  audio.volume = volume;
  return audio;
}

const SFX = {
  explosion:   load('./sounds/explosion.wav',    { volume: 1.0 }),
  starlink:    load('./sounds/starlink.wav',      { volume: 0.8 }),
  victory:     load('./sounds/victory.wav',       { volume: 1.0 }),
  worldrecord: load('./sounds/worldrecord.mp3',  { volume: 1.0 }),
};

// ─── Thrust — Web Audio API so gain can exceed 1.0 ────────────────────────────
let _audioCtx = null;
let _thrustSource = null;
let _thrustGain = null;
let _thrustBuffer = null;
const THRUST_GAIN = 12.0;

function _getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

fetch('./sounds/thrust.mp3')
  .then(r => r.arrayBuffer())
  .then(buf => _getAudioCtx().decodeAudioData(buf))
  .then(decoded => { _thrustBuffer = decoded; })
  .catch(() => {});

// ─── Audio unlock — must be called from a user-gesture handler ────────────────
let _unlocked = false;
export function unlockAudio() {
  if (_unlocked) return;
  _unlocked = true;
  const ctx = _getAudioCtx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  // Prime each HTML Audio element with a silent play so the browser allows
  // future play() calls outside of gesture handlers
  Object.values(SFX).forEach(s => {
    const vol = s.volume;
    s.volume = 0;
    s.play().then(() => { s.pause(); s.currentTime = 0; }).catch(() => {}).finally(() => { s.volume = vol; });
  });
}

// One-shot: rewind and play
export function playSound(key) {
  const s = SFX[key];
  if (!s) return;
  s.currentTime = 0;
  s.play().catch(() => {});
}

// Looping thrust — Web Audio loop with gain > 1.0
let _thrusting = false;

export function setThrust(active) {
  if (active === _thrusting) return;
  _thrusting = active;
  if (active) {
    if (!_thrustBuffer) return;
    const ctx = _getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    _thrustGain = ctx.createGain();
    _thrustGain.gain.value = THRUST_GAIN;
    _thrustGain.connect(ctx.destination);
    _thrustSource = ctx.createBufferSource();
    _thrustSource.buffer = _thrustBuffer;
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

// Stop all sounds except the one with the given key (e.g. keep explosion audible on crash)
export function stopAllExcept(key) {
  setThrust(false);
  Object.entries(SFX).forEach(([k, s]) => {
    if (k !== key) { s.pause(); s.currentTime = 0; }
  });
}

// Stop everything (e.g. on win or reset)
export function stopAllSounds() {
  setThrust(false);
  Object.values(SFX).forEach(s => { s.pause(); s.currentTime = 0; });
}
