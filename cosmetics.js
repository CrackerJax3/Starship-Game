import { isOwned } from './inapppurchase.js';
import { COSMETICS_BUNDLE } from './products.js';
import { track } from './analytics.js';

// Cosmetics change only how things look, never how they fly, so leaderboard
// times stay comparable.
//
// A variant either recolours the base sprite (`palette`: the base sprite's
// brightness is mapped from `dark` to `light`) or, once real art exists, points
// at its own image (`src`, same size and orientation as the base sprite).
// `product` is the catalog ID in products.js; free variants have none.

export const SLOTS = [
  { id: 'starship', name: 'Starship' },
  { id: 'booster', name: 'Booster' },
  { id: 'starlink', name: 'Payload' },
];

export const VARIANTS = [
  { id: 'starship_default', slot: 'starship', name: 'Factory' },
  { id: 'starship_stainless', slot: 'starship', name: 'Stainless', product: 'skin_starship_stainless', palette: { dark: '#7c8288', light: '#ffffff' } },
  { id: 'starship_gold', slot: 'starship', name: 'Gold Foil', product: 'skin_starship_gold', palette: { dark: '#a87400', light: '#fff2b0' } },
  { id: 'starship_mars', slot: 'starship', name: 'Mars Red', product: 'skin_starship_mars', palette: { dark: '#8a1c0c', light: '#ffc2a8' } },

  { id: 'booster_default', slot: 'booster', name: 'Factory' },
  { id: 'booster_gold', slot: 'booster', name: 'Gold Foil', product: 'skin_booster_gold', palette: { dark: '#3d2a00', light: '#ffd65c' } },
  { id: 'booster_midnight', slot: 'booster', name: 'Midnight', product: 'skin_booster_midnight', palette: { dark: '#04060c', light: '#45577d' } },

  { id: 'starlink_default', slot: 'starlink', name: 'Standard' },
  { id: 'starlink_gold', slot: 'starlink', name: 'Gold', product: 'skin_starlink_gold', palette: { dark: '#6b4a00', light: '#ffe27a' } },
  { id: 'starlink_neon', slot: 'starlink', name: 'Neon', product: 'skin_starlink_neon', palette: { dark: '#00a0c8', light: '#b8fbff' }, glow: '#3cf2ff' },
];

const EQUIP_KEY = 'equippedCosmetics';
// In the full-stack sprite the booster is on the left (x < 259), Starship on the right.
const FULLSTACK_SPLIT_X = 259;

export function variant(id) {
  return VARIANTS.find((v) => v.id === id) || null;
}

export function variantsFor(slot) {
  return VARIANTS.filter((v) => v.slot === slot);
}

function defaultFor(slot) {
  return VARIANTS.find((v) => v.slot === slot && !v.product);
}

export function isUnlocked(v) {
  return Boolean(v) && (!v.product || isOwned(v.product) || isOwned(COSMETICS_BUNDLE));
}

// ── Equip state ──────────────────────────────────────────────────────────────
let _equipped = {};
try { _equipped = JSON.parse(localStorage.getItem(EQUIP_KEY) || '{}') || {}; } catch { _equipped = {}; }

// The variant actually in use: the saved choice if still unlocked (a refund
// quietly reverts to the default), otherwise the slot default.
export function equipped(slot) {
  const v = variant(_equipped[slot]);
  return v && v.slot === slot && isUnlocked(v) ? v : defaultFor(slot);
}

const _listeners = new Set();
export function onCosmeticsChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
export function notifyCosmeticsChanged() {
  _listeners.forEach((cb) => { try { cb(); } catch (e) { console.warn(e); } });
}

export function equip(id) {
  const v = variant(id);
  if (!isUnlocked(v)) return false;
  _equipped[v.slot] = v.id;
  try { localStorage.setItem(EQUIP_KEY, JSON.stringify(_equipped)); } catch { /* ignore */ }
  track('cosmetic_equip', { item: v.id, slot: v.slot });
  notifyCosmeticsChanged();
  return true;
}

// ── Sprite building ──────────────────────────────────────────────────────────
let _base = null; // { ship, shipTop, shipBottom, starlink } Image elements
const _cache = new Map();
const _art = new Map(); // src -> Image for variants with their own art

function loaded(img) {
  return img && img.complete && img.naturalWidth > 0;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; // eslint-disable-line no-bitwise
}

// Recolour pixels of `ctx` inside [x0, x1) using the palette.
function recolour(ctx, w, h, x0, x1, palette) {
  const data = ctx.getImageData(x0, 0, x1 - x0, h);
  const px = data.data;
  const d = hexToRgb(palette.dark);
  const l = hexToRgb(palette.light);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue; // eslint-disable-line no-continue
    const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    px[i] = d[0] + (l[0] - d[0]) * lum;
    px[i + 1] = d[1] + (l[1] - d[1]) * lum;
    px[i + 2] = d[2] + (l[2] - d[2]) * lum;
  }
  ctx.putImageData(data, x0, 0);
}

function canvasFrom(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

function artFor(v) {
  if (!v?.src) return null;
  if (!_art.has(v.src)) {
    const img = new Image();
    img.onload = () => { _cache.clear(); notifyCosmeticsChanged(); };
    img.src = v.src;
    _art.set(v.src, img);
  }
  const img = _art.get(v.src);
  return loaded(img) ? img : null;
}

// Apply a variant to a single sprite. Returns the base image when nothing to do.
function skin(base, v) {
  if (!v || (!v.palette && !v.src) || !loaded(base)) return base;
  const art = artFor(v);
  if (art) return art;
  if (!v.palette) return base;
  try {
    const c = canvasFrom(base);
    recolour(c.getContext('2d'), c.width, c.height, 0, c.width, v.palette);
    return v.glow ? withGlow(c, v.glow) : c;
  } catch (e) {
    console.warn('Cosmetic recolour failed:', e); // e.g. tainted canvas
    return base;
  }
}

// Bake a soft glow into a padded canvas. GameObject draws images centred, so
// padding evenly on all sides keeps the sprite in the same place.
function withGlow(src, colour) {
  const pad = 6;
  const c = document.createElement('canvas');
  c.width = src.width + pad * 2;
  c.height = src.height + pad * 2;
  const ctx = c.getContext('2d');
  ctx.shadowColor = colour;
  ctx.shadowBlur = pad;
  ctx.drawImage(src, pad, pad);
  ctx.shadowBlur = 0;
  ctx.drawImage(src, pad, pad);
  return c;
}

// The stacked vehicle uses the booster variant on its left part and the
// Starship variant on its right part, so the two halves always match.
function skinFullStack(base, shipV, boosterV) {
  if (!loaded(base) || (!shipV?.palette && !boosterV?.palette)) return base;
  try {
    const c = canvasFrom(base);
    const ctx = c.getContext('2d');
    if (boosterV?.palette) recolour(ctx, c.width, c.height, 0, FULLSTACK_SPLIT_X, boosterV.palette);
    if (shipV?.palette) recolour(ctx, c.width, c.height, FULLSTACK_SPLIT_X, c.width, shipV.palette);
    return c;
  } catch (e) {
    console.warn('Cosmetic recolour failed:', e);
    return base;
  }
}

function cached(key, build) {
  if (!_cache.has(key)) {
    const result = build();
    // Don't cache a fallback to an unloaded base; try again next time.
    if (result instanceof HTMLImageElement && !loaded(result)) return result;
    _cache.set(key, result);
  }
  return _cache.get(key);
}

// Register the base sprites. Rebuilds once each finishes loading.
export function initCosmetics(baseImages) {
  _base = baseImages;
  Object.values(baseImages).forEach((img) => {
    if (!loaded(img)) img.addEventListener('load', () => { _cache.clear(); notifyCosmeticsChanged(); }, { once: true });
  });
}

// Sprite for one of the game's vehicle parts, given explicit variants (used by
// the hangar preview) or the equipped ones.
export function sprite(part, choice = {}) {
  if (!_base) return null;
  const shipV = choice.starship || equipped('starship');
  const boosterV = choice.booster || equipped('booster');
  const starlinkV = choice.starlink || equipped('starlink');
  switch (part) {
    case 'ship':
      return cached(`ship:${shipV.id}:${boosterV.id}`, () => skinFullStack(_base.ship, shipV, boosterV));
    case 'shipTop':
      return cached(`top:${shipV.id}`, () => skin(_base.shipTop, shipV));
    case 'shipBottom':
      return cached(`bottom:${boosterV.id}`, () => skin(_base.shipBottom, boosterV));
    case 'starlink':
      return cached(`starlink:${starlinkV.id}`, () => skin(_base.starlink, starlinkV));
    default:
      return null;
  }
}
