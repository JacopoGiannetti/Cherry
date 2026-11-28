// Le foto entrano con una dissolvenza solo la PRIMA volta che si caricano.
// Una foto già vista (tornando al ricettario le card vengono ricreate) c'è subito, piena:
// prima ripartiva da trasparente a ogni ritorno e il ricettario lampeggiava di bianco.
const loaded = new Set<string>();

/** Questa foto è già stata caricata in questa sessione. */
export const seen = (url: string | null | undefined) => !!url && loaded.has(url);

/** Props per <img src={url}>. */
export function fadeIn(url: string) {
  const known = loaded.has(url);
  // Si tiene anche l'elemento: finché qualcosa lo tiene, il browser non butta la foto già decodificata.
  const done = (el: HTMLImageElement) => { loaded.add(url); if (!warm.has(url)) warm.set(url, el); el.classList.add('is-in'); };
  return {
    className: known ? 'is-in' : undefined,
    // Già in memoria: si disegna nello stesso fotogramma della card, non uno dopo.
    decoding: (known ? 'sync' : 'async') as 'sync' | 'async',
    ref: (el: HTMLImageElement | null) => { if (el && el.complete && el.naturalWidth) done(el); },
    onLoad: (e: React.SyntheticEvent<HTMLImageElement>) => done(e.currentTarget),
    onError: (e: React.SyntheticEvent<HTMLImageElement>) => e.currentTarget.classList.add('is-in'),
  };
}

// Foto scaricate in anticipo: si tengono in memoria (se l'oggetto Image sparisce, il browser
// può buttare via la foto già decodificata) e non si chiedono due volte.
const warm = new Map<string, HTMLImageElement>();

/** Scarica e decodifica queste foto adesso, in sottofondo, così quando servono ci sono già. */
export function preload(urls: (string | null | undefined)[]) {
  for (const url of urls) {
    if (!url || warm.has(url)) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    img.decode?.().then(() => loaded.add(url)).catch(() => {});
    warm.set(url, img);
  }
}
