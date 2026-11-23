// Meta Pixel e consenso. Senza VITE_META_PIXEL_ID non fa nulla.
//
// Due regole, secondo il paese (da /api/geo, cioè da Cloudflare):
// - opt-in (UE/SEE, UK, Svizzera, o paese sconosciuto): niente Meta finché non si preme "Accept".
// - opt-out (USA e resto del mondo): il Pixel parte subito, con un avviso piccolo e un modo
//   per dire di no ("Do Not Sell or Share", Account → Cookie preferences).
// Global Privacy Control vale come un "no" ovunque. Un "no" ferma anche gli eventi dal server:
// al checkout il consenso passa al backend solo se qui è "granted".
// Gli eventi di pagamento hanno l'id della Checkout Session: lo stesso dell'API Conversions,
// così Meta li conta una volta.

const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;
const KEY = 'cherry.consent';
const NOTICE_KEY = 'cherry.notice';
const REGION_KEY = 'cherry.region';

/** UE (27) + SEE (Islanda, Liechtenstein, Norvegia) + Regno Unito + Svizzera. */
const OPT_IN = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO', 'GB', 'CH']);

export type Consent = 'granted' | 'denied' | null;
export type Region = 'optin' | 'optout';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function onConsentChange(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

const store = {
  get: (k: string, s: Storage = localStorage) => { try { return s.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null, s: Storage = localStorage) => { try { v === null ? s.removeItem(k) : s.setItem(k, v); } catch { /* privato */ } },
};

/** La scelta esplicita della persona, se c'è. */
export function getConsent(): Consent {
  const v = store.get(KEY);
  return v === 'granted' || v === 'denied' ? v : null;
}

/** Il browser chiede di non vendere né condividere i dati (Global Privacy Control). */
export const gpc = () => typeof navigator !== 'undefined' && (navigator as any).globalPrivacyControl === true;

// ---------- paese ----------
let region: Region | null = (store.get(REGION_KEY, sessionStorage) as Region | null) || null;
export const getRegion = () => region;

export function regionFor(country: string | null | undefined): Region {
  return country && !OPT_IN.has(country.toUpperCase()) ? 'optout' : 'optin';
}

async function detectRegion(): Promise<Region> {
  // Solo in sviluppo: ?geo=US (o IT, …) simula il paese.
  if (import.meta.env.DEV) {
    const sim = new URLSearchParams(location.search).get('geo');
    if (sim) store.set('cherry.geo', sim, sessionStorage);
    const s = store.get('cherry.geo', sessionStorage);
    if (s) return regionFor(s);
  }
  if (region) return region;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch('/api/geo', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    const { country } = await r.json();
    return regionFor(country);
  } catch {
    return 'optin'; // non si sa: si chiede prima, per prudenza
  }
}

/** Il consenso che vale davvero adesso. */
export function effectiveConsent(): Consent {
  if (gpc()) return 'denied';
  const c = getConsent();
  if (c) return c;
  return region === 'optout' ? 'granted' : null;
}

/** Cosa mostrare: il banner che chiede (opt-in), l'avviso piccolo (opt-out), o niente. */
export function consentUi(): 'banner' | 'notice' | null {
  if (!PIXEL_ID || !region || gpc() || getConsent() !== null) return null;
  if (region === 'optin') return 'banner';
  return store.get(NOTICE_KEY) ? null : 'notice';
}
export const dismissNotice = () => { store.set(NOTICE_KEY, '1'); emit(); };

/** Compatibilità: serve il banner che chiede? */
export const needsConsent = () => consentUi() === 'banner';

export function setConsent(v: Consent) {
  store.set(KEY, v);
  apply();
  emit();
}

function apply() {
  const w = window as any;
  if (effectiveConsent() === 'granted') {
    if (loaded) w.fbq?.('consent', 'grant'); else load();
  } else if (w.fbq) {
    w.fbq('consent', 'revoke');
  }
}

// ---------- il Pixel ----------
let loaded = false;
function load() {
  if (loaded || !PIXEL_ID || typeof window === 'undefined') return;
  loaded = true;
  /* eslint-disable */
  // Lo snippet ufficiale di Meta, riscritto senza globali sporchi.
  const w = window as any;
  if (!w.fbq) {
    const n: any = (w.fbq = function (...args: any[]) { n.callMethod ? n.callMethod.apply(n, args) : n.queue.push(args); });
    if (!w._fbq) w._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(s);
  }
  w.fbq('consent', 'grant');
  w.fbq('init', PIXEL_ID);
  w.fbq('track', 'PageView');
}

/** All'avvio: si scopre il paese, poi il Pixel parte se il consenso c'è (o vale per difetto). */
let started: Promise<void> | null = null;
export function initMeta() {
  if (started || !PIXEL_ID) return started;
  started = detectRegion().then((r) => {
    region = r;
    store.set(REGION_KEY, r, sessionStorage);
    if (effectiveConsent() === 'granted') load();
    emit();
  });
  return started;
}

/**
 * Manda un evento al Pixel. Se il paese non è ancora noto (initMeta in corso) lo aspetta:
 * negli USA il consenso vale per difetto solo dopo averlo saputo.
 * Risponde true se l'evento è partito davvero (cioè se il consenso c'è).
 */
export async function track(event: string, params: Record<string, unknown> = {}, eventId?: string): Promise<boolean> {
  if (!PIXEL_ID) return false;
  if (!region && started) await started.catch(() => {});
  if (effectiveConsent() !== 'granted') return false;
  load();
  (window as any).fbq('track', event, params, eventId ? { eventID: eventId } : undefined);
  return true;
}

/** Un id per l'evento, uguale nel browser e nell'API Conversions (deduplica). */
export const eventId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

let lastPath = typeof location !== 'undefined' ? location.pathname : '';
/** Le pagine dell'app cambiano senza ricaricare: PageView a ogni cambio. */
export function pageView(path: string) {
  if (path === lastPath) return;
  lastPath = path;
  void track('PageView');
}

const cookie = (name: string) => document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.split('=')[1];

/** Cosa serve al server per abbinare l'evento all'annuncio: solo se il consenso vale. */
export async function metaForServer(id?: string) {
  if (!PIXEL_ID) return undefined;
  if (!region && started) await started.catch(() => {});
  if (effectiveConsent() !== 'granted') return undefined;
  let fbc = cookie('_fbc');
  const clid = new URLSearchParams(location.search).get('fbclid') || sessionStorage.getItem('cherry.fbclid');
  if (!fbc && clid) fbc = `fb.1.${Date.now()}.${clid}`;
  return { consent: true, basis: getConsent() === 'granted' ? 'opt_in' : 'default', fbp: cookie('_fbp'), fbc, ...(id ? { eventId: id } : {}) };
}

/** Il fbclid arriva sulla landing: lo si tiene finché non si paga (di solito qualche schermata dopo). */
export function keepClickId() {
  try {
    const clid = new URLSearchParams(location.search).get('fbclid');
    if (clid) { sessionStorage.setItem('cherry.fbclid', clid); localStorage.setItem('cherry.fbclid', clid); }
    else if (!sessionStorage.getItem('cherry.fbclid')) { const k = localStorage.getItem('cherry.fbclid'); if (k) sessionStorage.setItem('cherry.fbclid', k); }
  } catch { /* privato */ }
}

/**
 * Un evento una volta sola per chiave (es. la stessa pagina di benvenuto ricaricata).
 * La chiave si scrive solo se l'evento è partito davvero (consenso "granted"):
 * altrimenti, se la persona accetta dopo, l'evento può ancora partire.
 */
export async function once(key: string, fn: () => Promise<boolean> | boolean) {
  try { if (localStorage.getItem('cherry.ev.' + key)) return; } catch { /* privato */ }
  if (!(await fn())) return;
  try { localStorage.setItem('cherry.ev.' + key, '1'); } catch { /* privato */ }
}

// ---------- le preferenze (pannello) ----------
const prefsListeners = new Set<(open: boolean) => void>();
export function onPrefs(l: (open: boolean) => void) { prefsListeners.add(l); return () => { prefsListeners.delete(l); }; }
/** Apre il pannello delle preferenze cookie (footer "Do Not Sell or Share", Account). */
export function openCookiePrefs() { prefsListeners.forEach((l) => l(true)); }
