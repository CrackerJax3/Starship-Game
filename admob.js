import {
  AdMob,
  AdmobConsentStatus,
  InterstitialAdPluginEvents,
} from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';

// ─── Real AdMob IDs ───────────────────────────────────────────────────────────
const ADMOB_APP_ID       = 'ca-app-pub-8274273901549014~1769131441'; // eslint-disable-line no-unused-vars
// Fill this in once you create the Interstitial ad unit in your AdMob dashboard:
const INTERSTITIAL_AD_ID = 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX';
// ─────────────────────────────────────────────────────────────────────────────

// Google's official test interstitial ID — safe during development
const TEST_INTERSTITIAL_ID = 'ca-app-pub-3940256099942544/1033173712';

// Flip to false once you have a real interstitial ad unit ID
const USE_TEST_ADS = true;

// ─── Initialise ──────────────────────────────────────────────────────────────
export async function initAdMob() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await AdMob.initialize({
      requestTrackingAuthorization: false,
      initializeForTesting: USE_TEST_ADS,
    });
  } catch (e) {
    console.warn('AdMob initialize failed:', e);
    return;
  }

  // GDPR / UMP consent (required for EEA & Play Store compliance)
  try {
    const { status, isConsentFormAvailable } = await AdMob.requestConsentInfo({
      debugGeography: 0,
    });
    const needsConsent = status === AdmobConsentStatus.REQUIRED
      || status === AdmobConsentStatus.UNKNOWN;
    if (isConsentFormAvailable && needsConsent) {
      await AdMob.showConsentForm();
    }
  } catch (e) {
    console.warn('AdMob consent error (non-fatal):', e);
  }
}

// ─── Interstitial ad ─────────────────────────────────────────────────────────
// Resolves when the interstitial is dismissed (or fails silently).
export function showInterstitialAd() {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();

  return new Promise(async (resolve) => {
    const listeners = [];

    try {
      listeners.push(await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, resolve));
      listeners.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, resolve));
      listeners.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, resolve));

      await AdMob.prepareInterstitial({
        adId: USE_TEST_ADS ? TEST_INTERSTITIAL_ID : INTERSTITIAL_AD_ID,
        isTesting: USE_TEST_ADS,
      });
      await AdMob.showInterstitial();
    } catch {
      resolve();
    } finally {
      Promise.resolve().then(() => listeners.forEach(l => l.remove?.()));
    }
  });
}
