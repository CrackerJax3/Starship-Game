import {
  AdMob,
  BannerAdSize,
  BannerAdPosition,
  AdmobConsentStatus,
} from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';

// ─── YOUR AdMob IDs — fill these in after creating your AdMob account ────────
// App ID also goes in android/app/src/main/AndroidManifest.xml
const ADMOB_APP_ID  = 'ca-app-pub-8274273901549014~1769131441'; // eslint-disable-line no-unused-vars
const BANNER_AD_ID  = 'ca-app-pub-8274273901549014/9456049779';
// ─────────────────────────────────────────────────────────────────────────────

// Google's official test IDs — safe to use during development
const TEST_BANNER_ID = 'ca-app-pub-3940256099942544/6300978111';

// Flip to false once you have live AdMob IDs and are ready to publish
const USE_TEST_ADS = false;

export async function initAdMob() {
  // Only runs inside the Android/iOS app — silently skipped in the browser
  if (!Capacitor.isNativePlatform()) return;

  try {
    await AdMob.initialize({
      requestTrackingAuthorization: false, // set true if you ever target iOS
      initializeForTesting: USE_TEST_ADS,
    });
  } catch (e) {
    console.warn('AdMob initialize failed:', e);
    return;
  }

  // ── GDPR / UMP consent (required for EEA users & Play Store compliance) ──
  try {
    const { status, isConsentFormAvailable } = await AdMob.requestConsentInfo({
      debugGeography: 0, // 0 = disabled; change to 1 (EEA) to test the consent form
    });
    const needsConsent = status === AdmobConsentStatus.REQUIRED
      || status === AdmobConsentStatus.UNKNOWN;
    if (isConsentFormAvailable && needsConsent) {
      await AdMob.showConsentForm();
    }
  } catch (consentErr) {
    // Consent failure is non-fatal — ads can still load in non-EEA regions
    console.warn('AdMob consent error (non-fatal):', consentErr);
  }

  // ── Banner ad ─────────────────────────────────────────────────────────────
  try {
    await AdMob.showBanner({
      adId: USE_TEST_ADS ? TEST_BANNER_ID : BANNER_AD_ID,
      adSize: BannerAdSize.BANNER,             // 320×50 dp — least intrusive
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: USE_TEST_ADS,
    });
  } catch (bannerErr) {
    console.warn('AdMob banner failed:', bannerErr);
  }
}
