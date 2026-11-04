import { Capacitor } from '@capacitor/core';
import { track } from './analytics.js';
import { PRODUCTS, REMOVE_ADS } from './products.js';

export const REMOVE_ADS_PRODUCT_ID = REMOVE_ADS;

const OWNED_KEY = 'ownedProducts';
const LEGACY_ADS_KEY = 'adsRemoved'; // pre-catalog cache; still read and written

// Friendly text shown to players. Technical detail goes to the console and
// to analytics, never to the player.
const MSG = {
  web: 'Purchases are only available in the mobile app for now.',
  storeDown: 'The store isn\'t available right now. Check your connection and try again in a moment.',
  notAvailable: 'This purchase isn\'t available right now. Please try again later.',
  failed: 'Something went wrong with the purchase. Please try again.',
  restored: 'Purchases restored.',
};

const NATIVE = Capacitor.isNativePlatform();
const PLATFORM = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

// Store ID for a catalog ID on this platform, or null if not sold here.
function storeIdFor(id) {
  return PRODUCTS[id]?.store?.[PLATFORM] || null;
}
// Reverse lookup: store ID -> catalog ID.
function catalogIdFor(storeId) {
  return Object.keys(PRODUCTS).find((id) => storeIdFor(id) === storeId) || null;
}

// ── Ownership ────────────────────────────────────────────────────────────────
// The store is the source of truth. localStorage is only a fast-start cache so
// paying players never see an ad or lose their skin while the store is still
// loading. The cache is reconciled against the store after it initialises, so
// a refund or a hand-edited value is corrected, and a reinstall is restored
// automatically from the player's store account.
const _owned = new Set();
if (NATIVE) {
  try {
    const cached = JSON.parse(localStorage.getItem(OWNED_KEY) || '[]');
    if (Array.isArray(cached)) cached.filter((id) => PRODUCTS[id]).forEach((id) => _owned.add(id));
    if (localStorage.getItem(LEGACY_ADS_KEY) === 'true') _owned.add(REMOVE_ADS);
  } catch { /* ignore */ }
}

export function isOwned(id) {
  return _owned.has(id);
}

export function ownedProducts() {
  return [..._owned];
}

export function isAdsRemoved() {
  return _owned.has(REMOVE_ADS);
}

const _listeners = new Set();

// Called with no arguments whenever any ownership changes.
export function onOwnershipChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

function saveCache() {
  try {
    localStorage.setItem(OWNED_KEY, JSON.stringify([..._owned]));
    if (_owned.has(REMOVE_ADS)) localStorage.setItem(LEGACY_ADS_KEY, 'true');
    else localStorage.removeItem(LEGACY_ADS_KEY);
  } catch { /* ignore */ }
}

function setOwned(id, value) {
  if (_owned.has(id) === value) return;
  if (value) _owned.add(id); else _owned.delete(id);
  saveCache();
  _listeners.forEach((cb) => { try { cb(); } catch (e) { console.warn(e); } });
}

// ── Store state (diagnostics only; never shown to players) ──────────────────
let _store = null;
let _storePlatform = null; // CdvPurchase.Platform value for this device
let _storeInitialized = false;
let _storeInitError = null;
const _loaded = new Map(); // catalog ID -> CdvPurchase product

function productOwned(product) {
  if (!product) return false;
  return Boolean(product.owned || _store?.owned?.(product));
}

function storeProduct(id) {
  const storeId = storeIdFor(id);
  if (!_store || !storeId) return null;
  return _store.get(storeId, _storePlatform) || null;
}

// Compare cached ownership with what the store says.
// `final` is true once the store has had time to load receipts: only then do we
// revoke, and only for products the store knows and clearly reports as not owned.
function reconcile(final = false) {
  if (!_store) return;
  Object.keys(PRODUCTS).forEach((id) => {
    const product = storeProduct(id);
    if (!product) return;
    if (productOwned(product)) setOwned(id, true);
    else if (final && _storeInitialized && product.offers?.length) setOwned(id, false);
  });
}

// Localised price string from the store (e.g. "$0.99", "0,99 €"), or null if
// not loaded yet. Never hard-code prices in the UI: they vary by country.
export function getPrice(id) {
  const product = _loaded.get(id) || storeProduct(id);
  return product?.pricing?.price || product?.offers?.[0]?.pricingPhases?.[0]?.price || null;
}

export function purchasesSupported() {
  return NATIVE;
}

export function initPurchases(onStatusChange) {
  if (onStatusChange) onOwnershipChange(onStatusChange);
  if (!NATIVE) return;

  const init = () => {
    if (!window.CdvPurchase) {
      console.warn('cordova-plugin-purchase not available — IAP disabled');
      return;
    }
    const { store, ProductType, Platform } = window.CdvPurchase;
    _store = store;
    _storePlatform = PLATFORM === 'ios' ? Platform.APPLE_APPSTORE : Platform.GOOGLE_PLAY;

    const toRegister = Object.keys(PRODUCTS)
      .map(storeIdFor)
      .filter(Boolean)
      .map((storeId) => ({ id: storeId, type: ProductType.NON_CONSUMABLE, platform: _storePlatform }));
    store.register(toRegister);

    const when = store.when();
    when
      .productUpdated((product) => {
        const id = catalogIdFor(product.id);
        if (!id) return;
        _loaded.set(id, product);
        if (productOwned(product)) setOwned(id, true);
        _listeners.forEach((cb) => { try { cb(); } catch { /* ignore */ } }); // price may have loaded
      })
      .approved((transaction) => transaction.verify())
      .verified((receipt) => receipt.finish())
      .finished((transaction) => {
        transaction.products.forEach((p) => {
          const id = catalogIdFor(p.id);
          if (!id) return;
          const firstTime = !_owned.has(id);
          setOwned(id, true);
          if (firstTime) track('iap_complete', { product: id });
        });
      })
      .error((err) => {
        _storeInitError = `[${err.code}] ${err.message}`;
        console.warn('IAP store error:', err.code, err.message);
      });

    // Once receipts are loaded, make the cache match the store.
    when.receiptsReady?.(() => setTimeout(() => reconcile(true), 1500));

    store.initialize([_storePlatform])
      .then(() => {
        _storeInitialized = true;
        Object.keys(PRODUCTS).forEach((id) => {
          const p = storeProduct(id);
          if (p && !_loaded.has(id)) _loaded.set(id, p);
        });
        reconcile(false);
        // Fallback in case receiptsReady never fires on this plugin version.
        setTimeout(() => reconcile(true), 8000);
      })
      .catch((e) => {
        _storeInitError = String(e);
        console.warn('IAP store init failed:', e);
      });
  };

  if (window.CdvPurchase) {
    init();
  } else {
    document.addEventListener('deviceready', init, { once: true });
  }
}

// Wait for a product to load (short so a button never feels stuck).
function waitForProduct(id, ms = 8000) {
  return new Promise((resolve) => {
    const ready = () => _loaded.get(id)?.offers?.length;
    if (ready()) { resolve(_loaded.get(id)); return; }
    const deadline = Date.now() + ms;
    const check = setInterval(() => {
      if (ready() || Date.now() >= deadline) {
        clearInterval(check);
        resolve(_loaded.get(id) || storeProduct(id));
      }
    }, 250);
  });
}

// Buy a catalog product. Returns null when there is nothing to tell the player
// (success, or they simply cancelled), otherwise a short friendly message.
export async function purchase(id) {
  if (!PRODUCTS[id]) return MSG.notAvailable;
  if (!NATIVE) return MSG.web;
  if (!storeIdFor(id)) {
    track('iap_fail', { product: id, reason: 'not_on_platform' });
    return MSG.notAvailable;
  }
  if (!window.CdvPurchase || !_store) {
    track('iap_fail', { product: id, reason: 'plugin_missing' });
    return MSG.storeDown;
  }

  track('iap_start', { product: id });
  const product = await waitForProduct(id);

  // Already owned (e.g. restored just now): nothing to buy.
  if (productOwned(product)) {
    setOwned(id, true);
    return null;
  }

  if (!product?.offers?.length) {
    const reason = _storeInitError
      || (!_storeInitialized ? 'store_not_initialized' : `product_unavailable_state_${product?.state ?? 'none'}`);
    console.warn('IAP unavailable:', id, reason);
    track('iap_fail', { product: id, reason: String(reason).slice(0, 90) });
    return _storeInitialized ? MSG.notAvailable : MSG.storeDown;
  }

  try {
    const err = await _store.order(product.offers[0]);
    if (err) {
      if (err.code === window.CdvPurchase.ErrorCode?.PAYMENT_CANCELLED) {
        track('iap_cancel', { product: id });
        return null; // player backed out on purpose; say nothing
      }
      console.warn('IAP order error:', err.code, err.message);
      track('iap_fail', { product: id, reason: `order_${err.code}` });
      return MSG.failed;
    }
    return null;
  } catch (e) {
    console.warn('IAP order exception:', e);
    track('iap_fail', { product: id, reason: 'order_exception' });
    return MSG.failed;
  }
}

export function purchaseRemoveAds() {
  return purchase(REMOVE_ADS);
}

// Explicit restore. Google Play restores automatically; the App Store requires
// a visible "Restore Purchases" button, so the UI offers one on every platform.
export async function restorePurchases() {
  if (!NATIVE) return MSG.web;
  if (!_store) return MSG.storeDown;
  track('iap_restore');
  try {
    const err = await _store.restorePurchases?.();
    if (err) {
      console.warn('IAP restore error:', err.code, err.message);
      return MSG.failed;
    }
    reconcile(false);
    return MSG.restored;
  } catch (e) {
    console.warn('IAP restore exception:', e);
    return MSG.failed;
  }
}
