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

// Exposed so the button handler can check product readiness
let _productReady = false;
export function isProductReady() { return _productReady; }

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
        if (product.id === REMOVE_ADS_PRODUCT_ID) {
          _productReady = true;
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
        console.warn('IAP store error:', err.code, err.message);
      });

    // initialize() silently restores any existing purchase from the user's
    // Google account — no separate restore button needed.
    store.initialize([Platform.GOOGLE_PLAY])
      .then(() => console.log('IAP store initialized'))
      .catch(e => console.warn('IAP store init failed:', e));
  };

  if (window.CdvPurchase) {
    init();
  } else {
    document.addEventListener('deviceready', init, { once: true });
  }
}

// Poll until the product is loaded (store.initialize is async and can take a few seconds).
async function waitForProduct(store, Platform, ms = 8000) {
  return new Promise(resolve => {
    const product = store.get(REMOVE_ADS_PRODUCT_ID, Platform.GOOGLE_PLAY);
    if (product?.offers?.length) { resolve(product); return; }
    const deadline = Date.now() + ms;
    const check = setInterval(() => {
      const p = store.get(REMOVE_ADS_PRODUCT_ID, Platform.GOOGLE_PLAY);
      if (p?.offers?.length || Date.now() >= deadline) {
        clearInterval(check);
        resolve(p?.offers?.length ? p : null);
      }
    }, 300);
  });
}

// Trigger the Google Play purchase sheet for remove_ads.
// Returns a string describing the outcome (for UI feedback).
export async function purchaseRemoveAds() {
  if (!Capacitor.isNativePlatform()) {
    return 'In-app purchases are only available in the Android app.';
  }
  if (!window.CdvPurchase) {
    return 'Purchase plugin not available. Try reinstalling the app.';
  }

  const { store, Platform } = window.CdvPurchase;
  const product = await waitForProduct(store, Platform);

  if (!product) {
    return 'Product not found. Make sure "remove_ads" is Active in Play Console, and the app is installed from the Play Store (not sideloaded).';
  }

  try {
    const err = await store.order(product.offers[0]);
    if (err) return `Purchase failed: ${err.message || err.code}`;
    return null; // null = success (purchase sheet opened, outcome handled by store.when())
  } catch (e) {
    return `Purchase error: ${e.message}`;
  }
}
