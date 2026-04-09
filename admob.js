import {
  AdMob,
  AdmobConsentStatus,
  RewardAdPluginEvents,
  InterstitialAdPluginEvents,
} from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';

// ─── Real AdMob IDs ───────────────────────────────────────────────────────────
const ADMOB_APP_ID       = 'ca-app-pub-8274273901549014~1769131441'; // eslint-disable-line no-unused-vars
// Fill these in once you create the ad units in your AdMob dashboard:
const REWARDED_AD_ID     = 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX';
const INTERSTITIAL_AD_ID = 'ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX';
// ─────────────────────────────────────────────────────────────────────────────

// Google's official test IDs — safe during development
const TEST_REWARDED_ID     = 'ca-app-pub-3940256099942544/5224354917';
const TEST_INTERSTITIAL_ID = 'ca-app-pub-3940256099942544/1033173712';

// Flip to false once you have real rewarded/interstitial ad unit IDs
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

// ─── Rewarded ad ─────────────────────────────────────────────────────────────
// Returns true if the user watched enough to earn the reward, false otherwise.
export function showRewardedAd() {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(false);

  return new Promise(async (resolve) => {
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };

    const listeners = [];

    try {
      listeners.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => done(true)));
      listeners.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => done(false)));
      listeners.push(await AdMob.addListener(RewardAdPluginEvents.FailedToLoad, () => done(false)));
      listeners.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => done(false)));

      await AdMob.prepareRewardVideoAd({
        adId: USE_TEST_ADS ? TEST_REWARDED_ID : REWARDED_AD_ID,
        isTesting: USE_TEST_ADS,
      });
      await AdMob.showRewardVideoAd();
    } catch {
      done(false);
    } finally {
      // Clean up listeners once settled
      Promise.resolve().then(() => listeners.forEach(l => l.remove?.()));
    }
  });
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
