import {
  AdMob,
  AdmobConsentStatus,
  InterstitialAdPluginEvents,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';
import { isAdsRemoved } from './inapppurchase.js';
import { track, setAnalyticsEnabled } from './analytics.js';

// ─── Real AdMob IDs ───────────────────────────────────────────────────────────
const ADMOB_APP_ID       = 'ca-app-pub-8274273901549014~1769131441'; // eslint-disable-line no-unused-vars
const INTERSTITIAL_AD_ID = 'ca-app-pub-8274273901549014/3745588362';
const REWARDED_AD_ID     = 'ca-app-pub-8274273901549014/7407103952';
// ─────────────────────────────────────────────────────────────────────────────

// Google's official test IDs — safe during development
const TEST_INTERSTITIAL_ID = 'ca-app-pub-3940256099942544/1033173712';
const TEST_REWARDED_ID     = 'ca-app-pub-3940256099942544/5224354917';

// Flip to true while developing so you never click your own live ads
const USE_TEST_ADS = false;

// ─── Ad frequency policy ─────────────────────────────────────────────────────
// Interstitials: never on a player's first win, then every 2nd win, and never
// within 3 minutes of another full-screen ad.
const INTERSTITIAL_EVERY_N_WINS = 2;
const INTERSTITIAL_MIN_GAP_MS = 3 * 60 * 1000;
// Rewarded "continue" offer: every 3rd crash, only if a video is already
// loaded, and not right after another ad.
const REWARDED_EVERY_N_DEATHS = 3;
const REWARDED_MIN_GAP_MS = 60 * 1000;

const WIN_COUNT_KEY = 'winCount';
let winCount = 0;
try { winCount = parseInt(localStorage.getItem(WIN_COUNT_KEY), 10) || 0; } catch { /* ignore */ }
let lastFullScreenAt = 0; // timestamp of the last ad that closed

// ─── Preload state ───────────────────────────────────────────────────────────
let initialised = false;
let interReady = false;
let interLoading = false;
let interFails = 0;
let interTimer = null;
let rewardReady = false;
let rewardLoading = false;
let rewardFails = 0;
let rewardTimer = null;

let pendingInterstitial = null; // resolver while an interstitial is on screen
let pendingReward = null;       // resolver while a rewarded video is on screen
let rewardEarned = false;

// Retry delays grow 30s, 60s, 2m … capped at 5m so a bad connection doesn't spin.
const retryDelay = (fails) => Math.min(30000 * 2 ** Math.max(0, fails - 1), 300000);

function adsAllowed() {
  return initialised && !isAdsRemoved();
}

async function loadInterstitial() {
  if (!adsAllowed() || interReady || interLoading) return;
  interLoading = true;
  try {
    await AdMob.prepareInterstitial({
      adId: USE_TEST_ADS ? TEST_INTERSTITIAL_ID : INTERSTITIAL_AD_ID,
      isTesting: USE_TEST_ADS,
    });
    interReady = true;
    interLoading = false;
    interFails = 0;
  } catch (e) {
    onInterstitialLoadFailed(e);
  }
}

function onInterstitialLoadFailed(e) {
  if (!interLoading) return; // already handled (event and rejection both report failures)
  interLoading = false;
  interReady = false;
  interFails += 1;
  track('ad_load_failed', { format: 'interstitial', code: String(e?.code ?? 'unknown') });
  if (!interTimer) {
    interTimer = setTimeout(() => { interTimer = null; loadInterstitial(); }, retryDelay(interFails));
  }
}

async function loadRewarded() {
  if (!adsAllowed() || rewardReady || rewardLoading) return;
  rewardLoading = true;
  try {
    await AdMob.prepareRewardVideoAd({
      adId: USE_TEST_ADS ? TEST_REWARDED_ID : REWARDED_AD_ID,
      isTesting: USE_TEST_ADS,
    });
    rewardReady = true;
    rewardLoading = false;
    rewardFails = 0;
  } catch (e) {
    onRewardedLoadFailed(e);
  }
}

function onRewardedLoadFailed(e) {
  if (!rewardLoading) return; // already handled
  rewardLoading = false;
  rewardReady = false;
  rewardFails += 1;
  track('ad_load_failed', { format: 'rewarded', code: String(e?.code ?? 'unknown') });
  if (!rewardTimer) {
    rewardTimer = setTimeout(() => { rewardTimer = null; loadRewarded(); }, retryDelay(rewardFails));
  }
}

function finishInterstitial(shown) {
  const resolve = pendingInterstitial;
  pendingInterstitial = null;
  if (shown) lastFullScreenAt = Date.now();
  resolve?.(shown);
  setTimeout(loadInterstitial, 1000); // get the next one ready
}

function finishRewarded() {
  const resolve = pendingReward;
  pendingReward = null;
  const earned = rewardEarned;
  rewardEarned = false;
  lastFullScreenAt = Date.now();
  track(earned ? 'ad_rewarded_earned' : 'ad_rewarded_dismissed');
  resolve?.(earned);
  setTimeout(loadRewarded, 1000);
}

// Listeners are registered once (not per ad), so nothing leaks over a long session.
function registerListeners() {
  AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => finishInterstitial(true));
  AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => finishInterstitial(false));
  AdMob.addListener(InterstitialAdPluginEvents.FailedToLoad, onInterstitialLoadFailed);

  AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { rewardEarned = true; });
  AdMob.addListener(RewardAdPluginEvents.Dismissed, finishRewarded);
  AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => {
    rewardEarned = false;
    const resolve = pendingReward;
    pendingReward = null;
    resolve?.(false);
    setTimeout(loadRewarded, 1000);
  });
  AdMob.addListener(RewardAdPluginEvents.FailedToLoad, onRewardedLoadFailed);
}

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

  // GDPR / UMP consent (required for EEA & Play Store compliance).
  // IMPORTANT: You must also create a GDPR message in the AdMob console:
  //   AdMob → Privacy & messaging → GDPR → Create message
  // Without that step the consent form will never appear for EEA users.
  let consentOk = true;
  try {
    const { status, isConsentFormAvailable } = await AdMob.requestConsentInfo({});
    const needsConsent = status === AdmobConsentStatus.REQUIRED
      || status === AdmobConsentStatus.UNKNOWN;
    if (isConsentFormAvailable && needsConsent) {
      await AdMob.showConsentForm();
      const after = await AdMob.requestConsentInfo({});
      consentOk = after.status === AdmobConsentStatus.OBTAINED
        || after.status === AdmobConsentStatus.NOT_REQUIRED;
    }
  } catch (e) {
    console.warn('AdMob consent error (non-fatal):', e);
  }
  // Only collect analytics once consent is settled.
  setAnalyticsEnabled(consentOk);

  initialised = true;
  registerListeners();
  // Preload both formats now so they're ready the moment they're needed.
  loadInterstitial();
  loadRewarded();
}

// ─── Policy helpers (used by main.js) ────────────────────────────────────────
// Call once per completed run.
export function recordWin() {
  winCount += 1;
  try { localStorage.setItem(WIN_COUNT_KEY, String(winCount)); } catch { /* ignore */ }
}

export function shouldShowInterstitial() {
  return adsAllowed()
    && interReady
    && winCount >= INTERSTITIAL_EVERY_N_WINS
    && winCount % INTERSTITIAL_EVERY_N_WINS === 0
    && Date.now() - lastFullScreenAt >= INTERSTITIAL_MIN_GAP_MS;
}

// True only if a video is loaded and it's a good moment to offer it.
export function shouldOfferRewarded(deathCount) {
  return adsAllowed()
    && rewardReady
    && deathCount > 0
    && deathCount % REWARDED_EVERY_N_DEATHS === 0
    && Date.now() - lastFullScreenAt >= REWARDED_MIN_GAP_MS;
}

// ─── Rewarded ad ─────────────────────────────────────────────────────────────
// Resolves true if the player earned the reward, false otherwise.
// Never makes the player wait: if no video is loaded it resolves false at once.
export function showRewardedAd() {
  if (!Capacitor.isNativePlatform() || !adsAllowed() || !rewardReady) {
    return Promise.resolve(false);
  }
  rewardReady = false;
  return new Promise((resolve) => {
    pendingReward = resolve;
    rewardEarned = false;
    AdMob.showRewardVideoAd().catch(() => {
      pendingReward = null;
      resolve(false);
      setTimeout(loadRewarded, 1000);
    });
  });
}

// ─── Interstitial ad ─────────────────────────────────────────────────────────
// Resolves true if an ad was shown and closed, false if it was skipped.
// Never makes the player wait: if no ad is loaded it resolves false at once.
export function showInterstitialAd() {
  if (!Capacitor.isNativePlatform() || !adsAllowed()) return Promise.resolve(false);
  if (!interReady) {
    track('ad_interstitial_skipped', { reason: 'not_ready' });
    loadInterstitial();
    return Promise.resolve(false);
  }
  interReady = false;
  return new Promise((resolve) => {
    pendingInterstitial = resolve;
    track('ad_interstitial_shown');
    AdMob.showInterstitial().catch(() => finishInterstitial(false));
  });
}
