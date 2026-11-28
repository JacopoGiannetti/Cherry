// Le foto entrano con una dissolvenza solo la PRIMA volta che si caricano.
// Una foto già vista (tornando al ricettario le card vengono ricreate) c'è subito, piena:
// prima ripartiva da trasparente a ogni ritorno e il ricettario lampeggiava di bianco.
const loaded = new Set<string>();

/** Props per <img src={url}>. */
export function fadeIn(url: string) {
  const known = loaded.has(url);
  const done = (el: HTMLImageElement) => { loaded.add(url); el.classList.add('is-in'); };
  return {
    className: known ? 'is-in' : undefined,
    // Già in memoria: si disegna nello stesso fotogramma della card, non uno dopo.
    decoding: (known ? 'sync' : 'async') as 'sync' | 'async',
    ref: (el: HTMLImageElement | null) => { if (el && el.complete && el.naturalWidth) done(el); },
    onLoad: (e: React.SyntheticEvent<HTMLImageElement>) => done(e.currentTarget),
    onError: (e: React.SyntheticEvent<HTMLImageElement>) => e.currentTarget.classList.add('is-in'),
  };
}
