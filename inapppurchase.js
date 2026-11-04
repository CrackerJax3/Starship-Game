import { Capacitor } from '@capacitor/core';
import { track } from './analytics.js';

export const REMOVE_ADS_PRODUCT_ID = 'remove_ads';
const STORAGE_KEY = 'adsRemoved';

// Friendly text shown to players. Technical detail goes to the console and
// to analytics, never to the player.
const MSG = {
  web: 'Purchases are only available in the Android app for now.',
  storeDown: 'The store isn\'t available right now. Check your connection and try again in a moment.',
  notAvailable: 'This purchase isn\'t available right now. Please try again later.',
  failed: 'Something went wrong with the purchase. Please try again.',
};

// ── Ownership ────────────────────────────────────────────────────────────────
// The Play Store is the source of truth. localStorage is only a fast-start
// cache so paying players never see an ad while the store is still loading.
// The cache is reconciled against the store after it initialises, so a
// refund or a hand-edited value is corrected, and a reinstall is restored
// automatically from the player's Google account.
let _owned = false;
if (Capacitor.isNativePlatform()) {
  try { _owned = localStorage.getItem(STORAGE_KEY) === 'true'; } catch { /* ignore */ }
}

export function isAdsRemoved() {
  return _owned;
}

let _onChange = null;

function setOwned(value) {
  if (_owned === value) return;
  _owned = value;
  try {
    if (value) localStorage.setItem(STORAGE_KEY, 'true');
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  _onChange?.();
}

// ── Store state (diagnostics only; never shown to players) ──────────────────
let _storeRef = null;
let _platformRef = null;
let _storeInitialized = false;
let _storeInitError = null;
let _loadedProduct = null;

function productOwned(product) {
  if (!product) return false;
  return Boolean(product.owned || _storeRef?.owned?.(product));
}

// Compare the cached flag with what the store says.
// `final` is true once the store has had time to load receipts: only then do we
// revoke, and only if the product is known and clearly not owned.
function reconcile(final = false) {
  if (!_storeRef) return;
  const product = _storeRef.get(REMOVE_ADS_PRODUCT_ID, _platformRef.GOOGLE_PLAY);
  if (productOwned(product)) {
    setOwned(true);
  } else if (final && _storeInitialized && product?.offers?.length) {
    setOwned(false);
  }
}

export function initPurchases(onStatusChange) {
  _onChange = onStatusChange;
  if (!Capacitor.isNativePlatform()) return;

  const init = () => {
    if (!window.CdvPurchase) {
      console.warn('cordova-plugin-purchase not available — IAP disabled');
      return;
    }
    const { store, ProductType, Platform } = window.CdvPurchase;
    _storeRef = store;
    _platformRef = Platform;

    store.register([{
      id: REMOVE_ADS_PRODUCT_ID,
      type: ProductType.NON_CONSUMABLE,
      platform: Platform.GOOGLE_PLAY,
    }]);

    const when = store.when();
    when
      .productUpdated((product) => {
        if (product.id !== REMOVE_ADS_PRODUCT_ID) return;
        _loadedProduct = product;
        if (productOwned(product)) setOwned(true);
      })
      .approved((transaction) => transaction.verify())
      .verified((receipt) => receipt.finish())
      .finished((transaction) => {
        if (transaction.products.some((p) => p.id === REMOVE_ADS_PRODUCT_ID)) {
          const firstTime = !_owned;
          setOwned(true);
          if (firstTime) track('iap_complete', { product: REMOVE_ADS_PRODUCT_ID });
        }
      })
      .error((err) => {
        _storeInitError = `[${err.code}] ${err.message}`;
        console.warn('IAP store error:', err.code, err.message);
      });

    // Once receipts are loaded, make the cached flag match the store.
    when.receiptsReady?.(() => setTimeout(() => reconcile(true), 1500));

    store.initialize([Platform.GOOGLE_PLAY])
      .then(() => {
        _storeInitialized = true;
        const p = store.get(REMOVE_ADS_PRODUCT_ID, Platform.GOOGLE_PLAY);
        if (p && !_loadedProduct) _loadedProduct = p;
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

// Wait for the product to load (shorter than before so the button never feels stuck)
function waitForProduct(ms = 8000) {
  return new Promise((resolve) => {
    if (_loadedProduct?.offers?.length) { resolve(_loadedProduct); return; }
    const deadline = Date.now() + ms;
    const check = setInterval(() => {
      if (_loadedProduct?.offers?.length || Date.now() >= deadline) {
        clearInterval(check);
        resolve(_loadedProduct);
      }
    }, 250);
  });
}

// Returns null when there is nothing to tell the player (success, or they
// simply cancelled), otherwise a short friendly message.
export async function purchaseRemoveAds() {
  if (!Capacitor.isNativePlatform()) return MSG.web;
  if (!window.CdvPurchase || !_storeRef) {
    track('iap_fail', { reason: 'plugin_missing' });
    return MSG.storeDown;
  }

  track('iap_start', { product: REMOVE_ADS_PRODUCT_ID });
  const product = await waitForProduct();

  // Already owned (e.g. restored just now): nothing to buy.
  if (productOwned(product)) {
    setOwned(true);
    return null;
  }

  if (!product?.offers?.length) {
    const reason = _storeInitError
      || (!_storeInitialized ? 'store_not_initialized' : `product_unavailable_state_${product?.state ?? 'none'}`);
    console.warn('IAP unavailable:', reason);
    track('iap_fail', { reason: String(reason).slice(0, 90) });
    return _storeInitialized ? MSG.notAvailable : MSG.storeDown;
  }

  try {
    const err = await _storeRef.order(product.offers[0]);
    if (err) {
      if (err.code === window.CdvPurchase.ErrorCode?.PAYMENT_CANCELLED) {
        track('iap_cancel', { product: REMOVE_ADS_PRODUCT_ID });
        return null; // player backed out on purpose; say nothing
      }
      console.warn('IAP order error:', err.code, err.message);
      track('iap_fail', { reason: `order_${err.code}` });
      return MSG.failed;
    }
    return null;
  } catch (e) {
    console.warn('IAP order exception:', e);
    track('iap_fail', { reason: 'order_exception' });
    return MSG.failed;
  }
}
