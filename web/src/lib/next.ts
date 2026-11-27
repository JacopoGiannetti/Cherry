// Dove riportare chi deve prima entrare. Il comando "Add to Cherry" apre /app/add?u=<link> in
// Safari: se lì non è loggato passa dal login, e dopo deve tornare a quella pagina, non al ricettario.
const KEY = 'cherry.next';

export function rememberNext(path: string) {
  try { sessionStorage.setItem(KEY, path); } catch { /* storage spento: si torna al ricettario */ }
}

/** Il percorso salvato, una volta sola. Solo percorsi interni all'app. */
export function takeNext(): string | null {
  try {
    const p = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return p && p.startsWith('/') && !p.startsWith('//') ? p : null;
  } catch { return null; }
}
