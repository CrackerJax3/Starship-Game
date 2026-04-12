import { Capacitor } from '@capacitor/core';

export const REMOVE_ADS_PRODUCT_ID = 'remove_ads';
const STORAGE_KEY = 'adsRemoved';

export function isAdsRemoved() {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

// Diagnostic state — lets purchaseRemoveAds report exactly what went wrong
let _storeRef = null;           // set once store is available
let _platformRef = null;
let _storeInitialized = false;
let _storeInitError = null;
let _loadedProduct = null;      // set by productUpdated when offers are present
let _productUpdatedCount = 0;   // how many times productUpdated fired (any product)

export function initPurchases(onStatusChange) {
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

    store.when()
      .productUpdated(product => {
        _productUpdatedCount++;
        console.log(`IAP productUpdated: id=${product.id} state=${product.state} offers=${product.offers?.length ?? 0}`);
        if (product.id === REMOVE_ADS_PRODUCT_ID) {
          // Accept even if offers is empty — store the product so we can inspect it
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
        _storeInitError = `[${err.code}] ${err.message}`;
        console.warn('IAP store error:', err.code, err.message);
      });

    store.initialize([Platform.GOOGLE_PLAY])
      .then(() => {
        _storeInitialized = true;
        console.log('IAP store initialized');
        // Also try store.get() as a fallback if productUpdated didn't fire with offers
        const p = store.get(REMOVE_ADS_PRODUCT_ID, Platform.GOOGLE_PLAY);
        if (p && !_loadedProduct) {
          _loadedProduct = p;
          console.log(`IAP fallback store.get: state=${p.state} offers=${p.offers?.length ?? 0}`);
        }
      })
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

// Poll up to 30 s for the product to load
function waitForProduct(ms = 30000) {
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

export async function purchaseRemoveAds() {
  if (!Capacitor.isNativePlatform()) {
    return 'In-app purchases are only available in the Android app.';
  }
  if (!window.CdvPurchase) {
    return 'Purchase plugin (CdvPurchase) not found. Try reinstalling the app.';
  }

  const product = await waitForProduct();

  if (!product?.offers?.length) {
    // Build a detailed diagnostic message
    let why = '';
    if (_storeInitError)         why = `Store error: ${_storeInitError}`;
    else if (!_storeInitialized) why = 'Store did not finish initializing in 10 s.';
    else if (product) {
      // We have a product object but no offers — inspect its state
      why = `Product found (state: "${product.state}", offers: ${product.offers?.length ?? 0}). `
          + 'It may still be in Draft or not yet approved in Play Console.';
    } else {
      why = `store.get() returned nothing after ${_productUpdatedCount} productUpdated event(s). `
          + 'Check that the package name and product ID match exactly in Play Console.';
    }
    return `Cannot purchase: ${why}`;
  }

  try {
    const err = await _storeRef.order(product.offers[0]);
    if (err) return `Purchase failed: ${err.message || err.code}`;
    return null;
  } catch (e) {
    return `Purchase error: ${e.message}`;
  }
}
