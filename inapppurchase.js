import { Capacitor } from '@capacitor/core';

// Product ID — must match exactly what you create in Play Console:
// Play Console → Monetize → In-app products → Create product
// Type: One-time product (non-consumable), Price: $1.99
export const REMOVE_ADS_PRODUCT_ID = 'remove_ads';

const STORAGE_KEY = 'adsRemoved';

// ─── Public helpers ───────────────────────────────────────────────────────────

export function isAdsRemoved() {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

// Holds the product object once it's loaded from Google Play
let _loadedProduct = null;
let _storeInitError = null;

// Call once on app start. onStatusChange fires whenever purchase state changes.
export function initPurchases(onStatusChange) {
  if (!Capacitor.isNativePlatform()) return;

  const init = () => {
    if (!window.CdvPurchase) {
      console.warn('cordova-plugin-purchase not available — IAP disabled');
      return;
    }
    const { store, ProductType, Platform } = window.CdvPurchase;

    store.register([{
      id: REMOVE_ADS_PRODUCT_ID,
      type: ProductType.NON_CONSUMABLE,
      platform: Platform.GOOGLE_PLAY,
    }]);

    store.when()
      .productUpdated(product => {
        if (product.id === REMOVE_ADS_PRODUCT_ID && product.offers?.length) {
          _loadedProduct = product;
        }
      })
      .approved(transaction => transaction.verify())
      .verified(receipt => receipt.finish())
      .finished(transaction => {
        if (transaction.products.some(p => p.id === REMOVE_ADS_PRODUCT_ID)) {
          localStorage.setItem(STORAGE_KEY, 'true');
          onStatusChange?.();
        }
      })
      .error(err => {
        _storeInitError = `${err.code}: ${err.message}`;
        console.warn('IAP store error:', err.code, err.message);
      });

    store.initialize([Platform.GOOGLE_PLAY])
      .then(() => console.log('IAP store initialized'))
      .catch(e => {
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

// Wait up to `ms` ms for the product to appear via productUpdated callback.
function waitForProduct(ms = 10000) {
  return new Promise(resolve => {
    if (_loadedProduct) { resolve(_loadedProduct); return; }
    const deadline = Date.now() + ms;
    const check = setInterval(() => {
      if (_loadedProduct || Date.now() >= deadline) {
        clearInterval(check);
        resolve(_loadedProduct);
      }
    }, 250);
  });
}

// Trigger the Google Play purchase sheet for remove_ads.
// Returns a string describing the outcome (for UI feedback), or null on success.
export async function purchaseRemoveAds() {
  if (!Capacitor.isNativePlatform()) {
    return 'In-app purchases are only available in the Android app.';
  }
  if (!window.CdvPurchase) {
    return 'Purchase plugin not available. Try reinstalling the app.';
  }

  const product = await waitForProduct();

  if (!product) {
    const detail = _storeInitError ? ` (${_storeInitError})` : '';
    return `Product not available${detail}. Make sure the app is installed from the Play Store and try again.`;
  }

  try {
    const { store } = window.CdvPurchase;
    const err = await store.order(product.offers[0]);
    if (err) return `Purchase failed: ${err.message || err.code}`;
    return null; // null = success (outcome handled by store.when() callbacks)
  } catch (e) {
    return `Purchase error: ${e.message}`;
  }
}
