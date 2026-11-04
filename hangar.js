import {
  SLOTS, variantsFor, equipped, equip, isUnlocked, sprite, onCosmeticsChange,
} from './cosmetics.js';
import {
  purchase, restorePurchases, getPrice, isOwned, onOwnershipChange, purchasesSupported,
} from './inapppurchase.js';
import { COSMETICS_BUNDLE } from './products.js';
import { track } from './analytics.js';

// Hangar: the cosmetics store. Pick a slot, tap a variant to preview it, then
// Equip (if owned) or Buy. Works without a store (web): purchases show a
// friendly message and free variants can still be equipped.

let els = null;
let slot = 'starship';
let selected = null; // variant being previewed
let busy = false;
let toast = (msg) => console.log(msg);
let onClose = null;

function $(id) { return document.getElementById(id); }

function priceLabel(productId) {
  return getPrice(productId) || (purchasesSupported() ? '…' : 'App only');
}

// Draw a sprite onto a canvas, rotated upright for vehicles, scaled to fit.
function drawSprite(canvas, img, upright) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const w = img?.naturalWidth || img?.width;
  const h = img?.naturalHeight || img?.height;
  if (!w || !h) return;
  const [dw, dh] = upright ? [h, w] : [w, h];
  const scale = Math.min((cssW * 0.9) / dw, (cssH * 0.9) / dh, upright ? 4 : 6);
  ctx.translate(cssW / 2, cssH / 2);
  if (upright) ctx.rotate(-Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = !(scale > 2 && !upright);
  ctx.drawImage(img, -w / 2, -h / 2);
}

function previewImage(v) {
  if (v.slot === 'starship') return sprite('shipTop', { starship: v });
  if (v.slot === 'booster') return sprite('shipBottom', { booster: v });
  return sprite('starlink', { starlink: v });
}

function renderTabs() {
  els.tabs.replaceChildren(...SLOTS.map((s) => {
    const b = document.createElement('button');
    b.className = `hangar-tab${s.id === slot ? ' active' : ''}`;
    b.textContent = s.name;
    b.addEventListener('click', () => {
      slot = s.id;
      selected = equipped(slot);
      render();
    });
    return b;
  }));
}

function renderGrid() {
  const current = equipped(slot);
  els.grid.replaceChildren(...variantsFor(slot).map((v) => {
    const card = document.createElement('button');
    card.className = 'hangar-card';
    if (v.id === selected?.id) card.classList.add('selected');
    const thumb = document.createElement('canvas');
    thumb.className = 'hangar-thumb';
    const name = document.createElement('span');
    name.className = 'hangar-card-name';
    name.textContent = v.name;
    const status = document.createElement('span');
    status.className = 'hangar-card-status';
    if (v.id === current.id) status.textContent = 'Equipped';
    else if (isUnlocked(v)) status.textContent = 'Owned';
    else status.textContent = priceLabel(v.product);
    card.append(thumb, name, status);
    card.addEventListener('click', () => {
      selected = v;
      track('cosmetic_preview', { item: v.id, slot: v.slot });
      render();
    });
    // Draw after insertion so clientWidth is known.
    requestAnimationFrame(() => drawSprite(thumb, previewImage(v), v.slot !== 'starlink'));
    return card;
  }));
}

function renderAction() {
  const v = selected;
  const btn = els.action;
  btn.disabled = busy;
  if (!v) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  if (v.id === equipped(v.slot).id) {
    btn.textContent = 'Equipped';
    btn.disabled = true;
  } else if (isUnlocked(v)) {
    btn.textContent = 'Equip';
  } else {
    if (busy) btn.textContent = 'Loading…';
    else if (!purchasesSupported()) btn.textContent = 'Available in the app';
    else btn.textContent = `Buy ${priceLabel(v.product)}`;
  }
}

function renderBundle() {
  const owned = isOwned(COSMETICS_BUNDLE);
  els.bundle.disabled = owned || busy;
  els.bundle.textContent = owned
    ? 'All liveries unlocked'
    : `Unlock all liveries ${purchasesSupported() ? priceLabel(COSMETICS_BUNDLE) : '(app only)'}`;
}

function render() {
  if (!els || els.overlay.style.display === 'none') return;
  renderTabs();
  renderGrid();
  renderAction();
  renderBundle();
  if (selected) drawSprite(els.preview, previewImage(selected), selected.slot !== 'starlink');
}

async function buy(productId) {
  if (busy) return;
  busy = true;
  render();
  const message = await purchase(productId);
  busy = false;
  if (message) toast(message, 5000);
  // On success, ownership changes and the listener re-renders; this covers failure.
  render();
}

async function onAction() {
  const v = selected;
  if (!v || busy) return;
  if (isUnlocked(v)) {
    equip(v.id);
    render();
  } else {
    await buy(v.product);
    if (isUnlocked(v)) equip(v.id); // equip what they just bought
  }
}

export function openHangar(source = 'menu') {
  if (!els) return;
  track('store_open', { source });
  selected = equipped(slot);
  els.overlay.style.display = 'flex';
  render();
}

export function closeHangar() {
  if (!els) return;
  els.overlay.style.display = 'none';
  onClose?.();
}

export function initHangar({ showToast, onClose: closeCb } = {}) {
  if (showToast) toast = showToast;
  if (closeCb) onClose = closeCb;
  els = {
    overlay: $('overlay-hangar'),
    tabs: $('hangar-tabs'),
    grid: $('hangar-grid'),
    preview: $('hangar-preview'),
    action: $('hangar-action-btn'),
    bundle: $('hangar-bundle-btn'),
    restore: $('hangar-restore-btn'),
    close: $('hangar-close-btn'),
  };
  els.action.addEventListener('click', onAction);
  els.bundle.addEventListener('click', async () => {
    await buy(COSMETICS_BUNDLE);
    if (selected && isUnlocked(selected)) equip(selected.id);
  });
  els.restore.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    render();
    const message = await restorePurchases();
    busy = false;
    if (message) toast(message, 4000);
    render();
  });
  els.close.addEventListener('click', closeHangar);
  onOwnershipChange(render);
  onCosmeticsChange(render);
}
