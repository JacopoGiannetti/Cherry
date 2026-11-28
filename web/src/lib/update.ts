// L'app si aggiorna da sola. Un'app aggiunta alla Home resta in memoria per giorni: riaprendola
// dallo sfondo gira ancora la versione di prima, e una correzione pubblicata non arriva finché
// non la si chiude del tutto. Qui, ogni volta che l'app torna in primo piano, si guarda se il
// sito ha una versione nuova: se sì, e non si sta cucinando o scrivendo, la pagina si ricarica.
const running = () => [...document.scripts].map((s) => s.src).find((src) => /\/assets\/app\.[^/]+\.js/.test(src)) || '';
// Dove ricaricare non fa perdere niente: ricettario, spesa, impostazioni, una ricetta aperta.
const safeHere = () => /^\/app\/?$|^\/app\/(list|settings)\/?$|^\/app\/r\/[^/]+\/?$/.test(location.pathname);

let checking = false;
async function check() {
  if (checking || document.visibilityState !== 'visible' || !navigator.onLine) return;
  const mine = running();
  if (!mine) return;
  checking = true;
  try {
    const html = await fetch('/app/', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : ''));
    const latest = (html.match(/\/assets\/app\.[A-Za-z0-9_-]+\.js/) || [])[0];
    if (!latest || mine.endsWith(latest) || !safeHere()) return;
    // Una volta sola per versione: se dopo il ricarico gira ancora la vecchia (cache), niente giri a vuoto.
    if (sessionStorage.getItem('cherry.updated') === latest) return;
    sessionStorage.setItem('cherry.updated', latest);
    location.reload();
  } catch { /* senza rete si resta sulla versione che c'è */ } finally {
    checking = false;
  }
}

export function watchForUpdates() {
  document.addEventListener('visibilitychange', () => { void check(); });
  window.addEventListener('pageshow', () => { void check(); });
  // Anche a app aperta a lungo: ogni dieci minuti.
  setInterval(() => { void check(); }, 10 * 60 * 1000);
}
