// Anteprima privata: percorsi in prova che vede solo chi apre il sito con la chiave.
//   /app/start-next?k=<chiave>   accende l'anteprima su questo browser (resta accesa)
//   /app/start-next?k=off        la spegne
// Chi non ha la chiave viene mandato al percorso in produzione. In anteprima niente
// finisce nelle statistiche vere: il percorso è segnato "test" e il Pixel non parte.
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
