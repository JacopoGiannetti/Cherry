// Le impostazioni dell'app che si cambiano dalla dashboard, senza un
// update dello store. Un documento solo: la dashboard lo scrive, GET
// /config lo passa all'app all'avvio.
//
// Ogni chiave nuova parte spenta: l'app che non riesce a leggere il
// documento (offline, server giù) si comporta come col default.
const DOC = 'appConfig/remote';

const DEFAULTS = {
  /// La richiesta di stelle sulla slide delle recensioni dell'onboarding.
  onboardingReviewPrompt: false,
};

function normalize(data) {
  const d = data || {};
  return {
    onboardingReviewPrompt: d.onboardingReviewPrompt === true,
  };
}

module.exports = { DOC, DEFAULTS, normalize };
