// Eventi client che non passano da un job AI: keep/pass, onboarding,
// apertura inbox. Allowlist stretta — niente payload libero.
const express = require('express');
const { recordEvent, APP_OPEN_EVENT } = require('../lib/usage');
const { events: onboardingEvents, PREFIX, QUIZ_SKIP_EVENT } = require('../lib/onboarding-funnel');
const { keys } = require('../config/keys');
const catalogTally = require('../lib/catalog/tally');

// Gli eventi dopo cui vale la pena ricontare i voti del ricettario.
const CATALOG_EVENTS = new Set(['recipe.keep', 'recipe.pass', 'recipe.save', 'list.finish', APP_OPEN_EVENT]);

const router = express.Router();

// `onboardingEvents` porta dentro gli step del funnel di tutte le
// versioni (le app vecchie mandano ancora quelli della v1) più
// `onboarding.complete`, che era già qui.
const ALLOWED = new Set([
  'recipe.keep',
  'recipe.pass',
  'recipe.save',
  'inbox.open',
  'list.finish',
  APP_OPEN_EVENT,
  QUIZ_SKIP_EVENT,
  ...onboardingEvents,
]);

/// Un utente manda venti step in tre minuti, e `analytics/totals` è un
/// documento solo: Firestore ne regge circa una scrittura al secondo.
/// Il funnel si conta comunque per utente, quindi lì non serve nulla.
/// Stesso discorso per le aperture, che sono l'evento più frequente che
/// esista: si contano sul documento della persona, non sul totale.
function skipsTotals(event) {
  return event.startsWith(PREFIX) || event === QUIZ_SKIP_EVENT || event === APP_OPEN_EVENT;
}

router.post('/event', (req, res) => {
  const event = String((req.body || {}).event || '');
  if (!ALLOWED.has(event)) {
    return res.status(400).json({ error: 'unknown_event' });
  }
  recordEvent(req.uid, event, skipsTotals(event) ? { skipTotals: true } : {});
  if (keys.catalog.enabled && CATALOG_EVENTS.has(event)) catalogTally.onEvent(req.uid, event);
  res.json({ ok: true });
});

module.exports = router;
