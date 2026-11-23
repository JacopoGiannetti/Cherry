// Il percorso di chi arriva sul sito, per la dashboard (Jacopo Giannetti Analytics → Cherry):
// landing → onboarding passo per passo → account → paywall → checkout → pagato,
// più le risposte alle domande e gli eventi del Pixel davvero partiti.
//
// Anonimo: un id a caso tenuto in questo browser, niente IP né cookie, niente terzi.
// Serve solo a vedere dove si fermano le persone. Non blocca mai niente: se fallisce, pazienza.

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const KEY = 'cherry.fid';
const SENT = 'cherry.j.';

function rand() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

/** L'id anonimo di questo browser (lo stesso tra landing, onboarding, Stripe e ritorno). */
export function journeyId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[a-z0-9]{10,40}$/.test(id)) { id = rand(); localStorage.setItem(KEY, id); }
    return id;
  } catch {
    return rand();
  }
}

/** Da dove arriva: solo la prima volta per questo id. */
function context() {
  const q = new URLSearchParams(location.search);
  const ua = navigator.userAgent;
  const utm: Record<string, string> = {};
  for (const k of ['source', 'medium', 'campaign', 'content', 'term']) {
    const v = q.get(`utm_${k}`);
    if (v) utm[k] = v.slice(0, 120);
  }
  let ref = '';
  try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch { /* niente */ }
  return {
    path: location.pathname.slice(0, 80),
    ref: ref === location.hostname ? '' : ref,
    utm,
    fbclid: q.has('fbclid'),
    device: /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : /Mobile/.test(ua) ? 'mobile' : 'desktop',
    browser: /Instagram/.test(ua) ? 'instagram' : /FBAN|FBAV/.test(ua) ? 'facebook' : /CriOS|Chrome/.test(ua) ? 'chrome' : /Safari/.test(ua) ? 'safari' : /Firefox/.test(ua) ? 'firefox' : 'other',
    lang: (navigator.language || '').slice(0, 10),
  };
}

/** L'app (non la landing, che non carica Firebase) dice come avere il token dell'utente. */
let tokenOf: (() => Promise<string | null>) | null = null;
export const setJourneyAuth = (fn: () => Promise<string | null>) => { tokenOf = fn; };

/** Il paese, se /api/geo l'ha già detto (lo chiede meta.ts all'avvio). */
const country = () => { try { return sessionStorage.getItem('cherry.country') || undefined; } catch { return undefined; } };

const isTest = () => import.meta.env.DEV || /^(localhost|127\.|192\.168\.)/.test(location.hostname) || new URLSearchParams(location.search).has('test');

/**
 * Un passo del percorso. `data` per le risposte (passo dell'onboarding) o altro.
 * `once`: si manda una volta sola per questo browser (es. "landing").
 */
export async function journey(event: string, data?: Record<string, unknown>, opts: { once?: boolean } = {}) {
  try {
    if (opts.once) {
      try { if (sessionStorage.getItem(SENT + event)) return; sessionStorage.setItem(SENT + event, '1'); } catch { /* privato */ }
    }
    const fid = journeyId();
    // Da dove arriva: la prima volta, e ogni volta che arriva da un link tracciato (annuncio, utm).
    let first = false;
    try { first = !localStorage.getItem(SENT + 'ctx'); if (first) localStorage.setItem(SENT + 'ctx', '1'); } catch { /* privato */ }
    const q = new URLSearchParams(location.search);
    const tagged = q.has('fbclid') || [...q.keys()].some((k) => k.startsWith('utm_'));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = tokenOf ? await tokenOf().catch(() => null) : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    await fetch(`${BASE}/v1/journey`, {
      method: 'POST',
      headers,
      keepalive: true,
      body: JSON.stringify({ fid, event, data, ctx: first || tagged ? context() : undefined, country: country(), test: isTest() || undefined }),
    });
  } catch { /* le statistiche non devono mai rompere il sito */ }
}
