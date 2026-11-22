// Meta Pixel, solo con il consenso. Senza VITE_META_PIXEL_ID non fa nulla.
// Il Pixel si carica dopo "Accept" nel banner dei cookie; chi rifiuta non
// manda niente a Meta (né dal browser né, per il pagamento, dal server).
// Gli eventi di pagamento hanno l'id della Checkout Session di Stripe: lo
// stesso che usa il server (Conversions API), così Meta li conta una volta.

const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;
const KEY = 'cherry.consent';

export type Consent = 'granted' | 'denied' | null;
const listeners = new Set<() => void>();

export function getConsent(): Consent {
  try { const v = localStorage.getItem(KEY); return v === 'granted' || v === 'denied' ? v : null; } catch { return null; }
}

export function setConsent(v: Exclude<Consent, null> | null) {
  try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* privato */ }
  if (v === 'granted') load();
  if (v === 'denied' && (window as any).fbq) (window as any).fbq('consent', 'revoke');
  listeners.forEach((l) => l());
}

export function onConsentChange(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** Serve il banner? Solo se c'è un Pixel e non si è ancora scelto. */
export const needsConsent = () => !!PIXEL_ID && getConsent() === null;

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

/** All'avvio: se il consenso c'è già, il Pixel parte. */
export function initMeta() { if (getConsent() === 'granted') load(); }

export function track(event: string, params: Record<string, unknown> = {}, eventId?: string) {
  if (!PIXEL_ID || getConsent() !== 'granted') return;
  load();
  (window as any).fbq('track', event, params, eventId ? { eventID: eventId } : undefined);
}

let lastPath = typeof location !== 'undefined' ? location.pathname : '';
/** Le pagine dell'app cambiano senza ricaricare: PageView a ogni cambio. */
export function pageView(path: string) {
  if (path === lastPath) return;
  lastPath = path;
  track('PageView');
}

const cookie = (name: string) => document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.split('=')[1];

/** Cosa serve al server per abbinare il pagamento a chi ha visto l'annuncio (solo con consenso). */
export function metaForServer() {
  if (!PIXEL_ID || getConsent() !== 'granted') return undefined;
  let fbc = cookie('_fbc');
  const clid = new URLSearchParams(location.search).get('fbclid') || sessionStorage.getItem('cherry.fbclid');
  if (!fbc && clid) fbc = `fb.1.${Date.now()}.${clid}`;
  return { consent: true, fbp: cookie('_fbp'), fbc };
}

/** Il fbclid arriva sulla landing: lo si tiene finché non si paga (di solito qualche schermata dopo). */
export function keepClickId() {
  try {
    const clid = new URLSearchParams(location.search).get('fbclid');
    if (clid) { sessionStorage.setItem('cherry.fbclid', clid); localStorage.setItem('cherry.fbclid', clid); }
    else if (!sessionStorage.getItem('cherry.fbclid')) { const k = localStorage.getItem('cherry.fbclid'); if (k) sessionStorage.setItem('cherry.fbclid', k); }
  } catch { /* privato */ }
}

/** Un evento una volta sola per chiave (es. la stessa pagina di benvenuto ricaricata). */
export function once(key: string, fn: () => void) {
  try { if (localStorage.getItem('cherry.ev.' + key)) return; localStorage.setItem('cherry.ev.' + key, '1'); } catch { /* privato */ }
  fn();
}
