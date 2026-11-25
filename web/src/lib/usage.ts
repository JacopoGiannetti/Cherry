// Cosa si fa nell'app, per la pagina Retention della dashboard: in che giorni
// uno apre Cherry, apre una ricetta, cucina, fa la spesa. Uno per tipo al giorno
// (alla dashboard servono i giorni, non i clic). Niente contenuti: solo il tipo.
import { api } from './api';
import { auth } from './firebase';
import { IS_MOCK } from './store';

export type UsageEvent =
  | 'app.open' | 'recipe.open' | 'recipe.create' | 'recipe.edit' | 'cook.start' | 'cook.done'
  | 'list.add' | 'list.check' | 'list.share' | 'trip.done' | 'folder.use';

export function used(event: UsageEvent) {
  if (IS_MOCK || !auth.currentUser) return;
  const day = new Date().toISOString().slice(0, 10);
  const key = `cherry.used.${day}`;
  let done: string[] = [];
  try { done = JSON.parse(localStorage.getItem(key) || '[]'); } catch { /* storage spento */ }
  if (done.includes(event)) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith('cherry.used.') && k !== key) localStorage.removeItem(k);
    }
    localStorage.setItem(key, JSON.stringify([...done, event]));
  } catch { /* storage spento: si manda lo stesso */ }
  api('/event', { event }).catch(() => {
    // Non è arrivato: al prossimo gesto si riprova.
    try { localStorage.setItem(key, JSON.stringify(done)); } catch { /* niente */ }
  });
}
