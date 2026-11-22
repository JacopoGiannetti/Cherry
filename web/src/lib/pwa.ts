// Cherry vive fuori dall'App Store: l'installazione sulla Home è ciò che
// la fa sentire un'app (icona, schermo intero, niente barra di Safari).

export const SUPPORT_EMAIL = 'support@hellocherry.app';

let deferred: any = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
});

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;

export function platform(): 'ios' | 'android' | 'desktop' {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export const isIOSSafari = () => platform() === 'ios' && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

export const canPromptInstall = () => !!deferred;

export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const choice = await deferred.userChoice.catch(() => null);
  deferred = null;
  return choice?.outcome === 'accepted';
}
