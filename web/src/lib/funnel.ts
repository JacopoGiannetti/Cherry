import type { Recipe } from './types';

// Le risposte dell'onboarding: restano sul telefono e costruiscono il
// paywall (i tuoi numeri, la tua ricetta), poi finiscono sul profilo.
export type Funnel = {
  saved: number;      // ricette salvate (500 = "500+")
  cooked: number;     // cucinate il mese scorso
  blockers: string[];
  household: number;
  nights: number;     // sere a settimana in cui vuole cucinare
  takeout: number;    // sere di asporto/delivery adesso
  days?: number[];    // quali sere (0 = lunedì), se le ha scelte nel percorso nuovo
  url?: string;
  recipe?: Recipe;
  demo?: boolean;
};

export const DEFAULT_FUNNEL: Funnel = { saved: 50, cooked: 1, blockers: [], household: 2, nights: 3, takeout: 2 };
const KEY = 'cherry.funnel';

export function loadFunnel(): Funnel {
  try { return { ...DEFAULT_FUNNEL, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULT_FUNNEL; }
}
export function saveFunnel(f: Funnel) {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* navigazione privata */ }
}
export function hasFunnel() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

// Stime dichiarate come tali a schermo: asporto ~$18 a persona, a casa ~$6.
export const TAKEOUT_USD = 18;
export const HOME_USD = 6;

export function derive(f: Funnel) {
  const swapped = Math.min(f.takeout, f.nights);
  const monthly = Math.round((swapped * 4.3 * f.household * (TAKEOUT_USD - HOME_USD)) / 5) * 5;
  return {
    oneIn: f.cooked > 0 ? Math.max(1, Math.round(f.saved / f.cooked)) : null,
    waiting: Math.max(0, f.saved - f.cooked),
    swapped,
    monthly,
    dinners: Math.round(f.nights * 4.3),
    savedLabel: f.saved >= 500 ? '500+' : String(f.saved),
  };
}

export const DEMO_URL = 'https://www.tiktok.com/@jose.elcook/video/7448169436764212510';
