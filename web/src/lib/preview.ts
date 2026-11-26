// Anteprima privata: percorsi in prova che vede solo chi apre il sito con la chiave.
//   /app/start?k=<chiave>   accende la modalità prova su questo browser (resta accesa)
//   /app/start?k=off        la spegne
// In prova niente finisce nelle statistiche vere (il percorso è segnato "test", il Pixel non
// manda la registrazione) e l'onboarding si può rifare anche da abbonati.
const KEY = 'cherry.preview';
const SECRET = 'cherry-jg-7q4m2x';

export function isPreview(): boolean {
  try {
    const k = new URLSearchParams(location.search).get('k');
    if (k === SECRET) localStorage.setItem(KEY, '1');
    if (k === 'off') localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
