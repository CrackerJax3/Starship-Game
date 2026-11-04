import { Capacitor } from '@capacitor/core';

// GA4 Measurement Protocol — works the same in the Android app, the web build
// and on game portals, and needs no extra native SDK or google-services.json.
//
// Setup (one time):
//   GA4 -> Admin -> Data streams -> your stream -> Measurement Protocol API secrets -> Create
//   then paste the secret below. Until you do, every call here is a harmless no-op.
const MEASUREMENT_ID = 'G-W4JMB6EW63';
const API_SECRET = 'REPLACE_WITH_GA4_API_SECRET';

const ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const FLUSH_MS = 10000;
const MAX_BATCH = 20; // GA4 accepts up to 25 events per request

const CLIENT_KEY = 'analyticsClientId';
const sessionId = String(Math.floor(Date.now() / 1000));
const platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web';

let enabled = !API_SECRET.startsWith('REPLACE');
let queue = [];
let timer = null;
const baseParams = {};

function getClientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}.${Math.random().toString(36).slice(2)}`);
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return `anon.${sessionId}`;
  }
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!enabled || queue.length === 0) return;
  const events = queue.splice(0, MAX_BATCH);
  const url = `${ENDPOINT}?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`;
  const body = JSON.stringify({ client_id: getClientId(), events });
  try {
    if (navigator.sendBeacon && document.visibilityState === 'hidden') {
      navigator.sendBeacon(url, body);
    } else {
      fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  } catch { /* analytics must never break the game */ }
  if (queue.length) timer = setTimeout(flush, 500);
}

// Turn analytics on/off, e.g. after the consent flow. Off by default if no secret is set.
export function setAnalyticsEnabled(on) {
  enabled = on && !API_SECRET.startsWith('REPLACE');
  if (!enabled) queue = [];
}

// Params attached to every event (e.g. whether the player has removed ads).
export function setAnalyticsDefaults(params) {
  Object.assign(baseParams, params);
}

export function track(name, params = {}) {
  if (!enabled) return;
  queue.push({
    name,
    params: {
      ...baseParams,
      ...params,
      platform,
      session_id: sessionId,
      engagement_time_msec: 100,
    },
  });
  if (queue.length >= MAX_BATCH) flush();
  else if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});
