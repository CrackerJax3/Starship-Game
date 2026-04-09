import {
  AdMob,
  AdmobConsentStatus,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';

// ─── Real AdMob IDs ───────────────────────────────────────────────────────────
const ADMOB_APP_ID       = 'ca-app-pub-8274273901549014~1769131441'; // eslint-disable-line no-unused-vars
// Fill these in once you create the ad units in your AdMob dashboard:
const INTERSTITIAL_AD_ID = 'ca-app-pub-8274273901549014/3745588362';
const REWARDED_AD_ID     = 'ca-app-pub-8274273901549014/7407103952';
// ─────────────────────────────────────────────────────────────────────────────

// Google's official test IDs — safe during development
const TEST_INTERSTITIAL_ID = 'ca-app-pub-3940256099942544/1033173712';
const TEST_REWARDED_ID     = 'ca-app-pub-3940256099942544/5224354917';

// Flip to false once you have a real interstitial ad unit ID
const USE_TEST_ADS = false;

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
// Returns true if the user earned the reward, false otherwise.
export function showRewardedAd() {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(false);

  return new Promise(async (resolve) => {
    let settled = false;
    const listeners = [];
    const done = (val) => {
      if (settled) return;
      settled = true;
      listeners.forEach(l => l.remove?.());
      resolve(val);
    };

    try {
      listeners.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded,     () => done(true)));
      listeners.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed,    () => done(false)));
      listeners.push(await AdMob.addListener(RewardAdPluginEvents.FailedToLoad, () => done(false)));
      listeners.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => done(false)));

      await AdMob.prepareRewardVideoAd({
        adId: USE_TEST_ADS ? TEST_REWARDED_ID : REWARDED_AD_ID,
        isTesting: USE_TEST_ADS,
      });
      await AdMob.showRewardVideoAd();
    } catch {
      done(false);
    }
  });
}

// ─── Interstitial ad ─────────────────────────────────────────────────────────
// Resolves when the interstitial is dismissed (or fails silently).
export function showInterstitialAd() {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();

  return new Promise(async (resolve) => {
    let settled = false;
    const listeners = [];
    const done = () => {
      if (settled) return;
      settled = true;
      listeners.forEach(l => l.remove?.());
      resolve();
    };

    try {
      listeners.push(await AdMob.addListener(InterstitialAdPluginEvents.Dismissed,    done));
      listeners.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, done));
      listeners.push(await AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, done));

      await AdMob.prepareInterstitial({
        adId: USE_TEST_ADS ? TEST_INTERSTITIAL_ID : INTERSTITIAL_AD_ID,
        isTesting: USE_TEST_ADS,
      });
      await AdMob.showInterstitial();
    } catch {
      done();
    }
  });
}
