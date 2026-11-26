// Il percorso anonimo di chi arriva sul sito (web/src/lib/journey.ts), in journeys/{fid}.
// Lo legge la dashboard (Jacopo Giannetti Analytics → Cherry). Un documento per browser:
//   first / last   da dove è arrivato (utm, referrer, fbclid, dispositivo, lingua)
//   steps.<passo>  quando ci è arrivato la prima volta (landing, hello…account, paywall, checkout, paid)
//   answers        le risposte dell'onboarding
//   pixel.<evento> gli eventi del Pixel partiti davvero dal browser
//   uid            se ha fatto l'account (verificato col token, mai dal corpo)
// Niente IP: solo il paese, che serve al consenso e ai numeri per paese.
const { db, FieldValue } = require('./firebase');

// L'onboarding dal 26 nov 2026 (web/src/app/screens/OnboardingNext.tsx), nell'ordine in cui si vede.
const STEPS_NOW = ['hello', 'saved', 'cooked', 'reveal', 'blockers', 'magic', 'nights', 'receipt', 'chart', 'team', 'account'];
// I passi di prima restano validi: servono a leggere i percorsi già scritti.
const STEPS = [...new Set([...STEPS_NOW, 'fix', 'table', 'takeout', 'math', 'paste', 'ready'])];
const EVENTS = new Set(['landing', 'step', 'account', 'paywall', 'checkout', 'paid', 'pixel', 'consent']);
const PIXEL = new Set(['PageView', 'CompleteRegistration', 'InitiateCheckout', 'Purchase', 'Subscribe']);
const BLOCKERS = new Set(['rewind', 'fast', 'amounts', 'lost', 'shopping']);

const str = (v, n = 80) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);
const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function cleanCtx(c, country) {
  if (!c || typeof c !== 'object') return undefined;
  const utm = {};
  for (const k of ['source', 'medium', 'campaign', 'content', 'term']) if (str(c.utm?.[k], 120)) utm[k] = str(c.utm[k], 120);
  return clean({
    path: str(c.path), ref: str(c.ref), utm, fbclid: c.fbclid === true,
    device: str(c.device, 12), browser: str(c.browser, 12), lang: str(c.lang, 10), country: str(country, 2), at: Date.now(),
  });
}

function cleanAnswers(a) {
  if (!a || typeof a !== 'object') return undefined;
  return clean({
    saved: num(a.saved, 0, 1000), cooked: num(a.cooked, 0, 1000),
    blockers: Array.isArray(a.blockers) ? a.blockers.filter((b) => BLOCKERS.has(b)).slice(0, 5) : undefined,
    household: num(a.household, 1, 20), nights: num(a.nights, 0, 7), takeout: num(a.takeout, 0, 14),
    paste: ['demo', 'own'].includes(a.paste) ? a.paste : undefined,
    platform: ['instagram', 'tiktok', 'youtube', 'other'].includes(a.platform) ? a.platform : undefined,
  });
}

/** Scrive un passo. uid solo se verificato. Non lancia. */
async function record({ fid, event, data, ctx, test, uid, country }) {
  if (!/^[a-z0-9]{10,40}$/.test(String(fid || '')) || !EVENTS.has(event)) return false;
  data = data && typeof data === 'object' ? data : {};
  const ref = db().doc(`journeys/${fid}`);
  await db().runTransaction(async (t) => {
    const cur = (await t.get(ref)).data() || {};
    const now = Date.now();
    const patch = { updatedAt: now };
    if (!cur.createdAt) patch.createdAt = now;
    if (test) patch.test = true;
    if (uid && !cur.uid) patch.uid = uid;
    const c = cleanCtx(ctx, country);
    if (c) { if (!cur.first) patch.first = c; patch.last = c; }
    if (country && !cur.country) patch.country = str(country, 2);
    const steps = {};
    const mark = (k) => { if (!cur.steps?.[k]) steps[k] = now; };
    if (event === 'step') { if (STEPS.includes(data.id)) mark(data.id); } else if (event !== 'pixel' && event !== 'consent') mark(event);
    if (Object.keys(steps).length) patch.steps = steps;
    const answers = cleanAnswers(data.answers);
    if (answers && Object.keys(answers).length) patch.answers = answers;
    if (event === 'checkout' && ['yearly', 'monthly'].includes(data.plan)) patch.plan = data.plan;
    if (event === 'paid') patch.paid = clean({ plan: str(data.plan, 10), value: num(data.value, 0, 10000), currency: str(data.currency, 3), at: cur.paid?.at || now });
    if (event === 'pixel' && PIXEL.has(data.name)) {
      patch.pixel = { [data.name]: { first: cur.pixel?.[data.name]?.first || now, n: FieldValue.increment(1) } };
    }
    if (event === 'consent' && ['granted', 'denied'].includes(data.value)) patch.consent = data.value;
    t.set(ref, patch, { merge: true });
  });
  return true;
}

/** Dal webhook di Stripe: il pagamento arriva sul percorso anche se il browser non torna. */
async function markPaid(fid, { plan, value, currency, uid, live }) {
  if (!/^[a-z0-9]{10,40}$/.test(String(fid || ''))) return;
  const now = Date.now();
  await db().doc(`journeys/${fid}`).set({
    steps: { paid: now }, paid: clean({ plan, value, currency, at: now, live }), ...(uid ? { uid } : {}), updatedAt: now,
  }, { merge: true }).catch((e) => console.warn('[journey] paid:', e.message));
}

module.exports = { record, markPaid, STEPS, STEPS_NOW };
