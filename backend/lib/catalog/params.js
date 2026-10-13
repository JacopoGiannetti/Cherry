// I parametri del ricettario. I default stanno qui; la dashboard li può
// sovrascrivere in catalogConfig/params senza toccare codice.
const { db, COLLECTIONS } = require('./deps');

const DEFAULTS = {
  // Quota del mazzo per tipo di ricetta, in base alla dieta dell'utente.
  quotas: {
    vegan: { vegan: 1 },
    vegetarian: { vegan: 0.6, vegetarian: 0.4 },
    pescatarian: { vegan: 0.5, vegetarian: 0.25, pescatarian: 0.25 },
  },
  // Di quanto la quota si sposta seguendo i gusti della persona (±).
  quotaShift: 0.15,
  // Quante tenute in più vale una stella o una persona che la riusa.
  bonus: { star: 0.5, reuse: 0.5 },
  // Prudenza del punteggio: più è alta, più contano le viste.
  confidence: 1.64,
  // Visualizzazioni minime in un gruppo di dieta per usarne il punteggio.
  groupMinViews: 10,
  // Posti per le ricette in classifica con poche visualizzazioni.
  youngSlots: 2,
  youngViews: 20,
  // Ricette IA minime per mazzo anche quando la classifica basterebbe:
  // senza, la classifica smette di crescere appena basta a un mazzo.
  minAiPerDeck: 2,
  // Una ricetta in classifica esce da sola se non piace: dopo
  // `earlyViews` viste con al massimo `earlyMaxKeeps` tenute, oppure
  // dopo `lateViews` viste sotto `lateMinKeepRate`. Una stella o un
  // riuso la salvano; quelle rimesse a mano dalla dashboard restano.
  retire: { earlyViews: 4, earlyMaxKeeps: 1, lateViews: 10, lateMinKeepRate: 0.35 },
  // Un piatto uscito tante volte per una dieta non si fa più riscrivere.
  dishMaxRetired: 3,
  // Un piatto già visto non ritorna prima di tanti giorni.
  seenDishDays: 30,
  // Dopo quanti giorni una ricetta servita e mai swipata conta "non vista".
  openDays: 7,
  // Una candidata senza like scade dopo tanti giorni.
  candidateDays: 30,
  // Da dollari alla valuta dell'utente: stime, non cambi di mercato.
  currency: { USD: 1, EUR: 0.92, GBP: 0.79 },
  // Ingredienti condivisi tra le ricette: default per chi non ha scelto.
  ingredientSharing: true,
};

const TTL_MS = 60_000;
let cached = null;
let cachedAt = 0;

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

async function getParams() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  try {
    const snap = await db().collection(COLLECTIONS.config).doc('params').get();
    cached = merge(DEFAULTS, snap.exists ? snap.data() : {});
  } catch (e) {
    console.warn('[catalog] parametri non leggibili, uso i default:', e.message);
    cached = DEFAULTS;
  }
  cachedAt = Date.now();
  return cached;
}

function invalidateParams() {
  cached = null;
}

module.exports = { DEFAULTS, getParams, invalidateParams, merge };
