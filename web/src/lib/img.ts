/** Per <img>: la classe is-in quando la foto è pronta. Se è già in cache c'è subito, senza dissolvenza. */
export const fadeIn = {
  ref: (el: HTMLImageElement | null) => { if (el && el.complete && el.naturalWidth) el.classList.add('is-in'); },
  onLoad: (e: React.SyntheticEvent<HTMLImageElement>) => e.currentTarget.classList.add('is-in'),
  onError: (e: React.SyntheticEvent<HTMLImageElement>) => e.currentTarget.classList.add('is-in'),
};
