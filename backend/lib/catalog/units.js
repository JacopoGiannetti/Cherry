// Quantità del ricettario. Ogni ricetta è salvata una volta sola, per 2
// persone e in metrico; qui la si scala alle porzioni dell'utente e la si
// scrive nelle sue unità e nella sua lingua.

const UNITS = ['g', 'ml', 'tsp', 'tbsp', 'piece', 'clove', 'can', 'bunch', 'pinch', 'slice', 'sprig', 'sheet', 'handful', 'to_taste'];

const BASE_SERVINGS = 2;

// [singolare, plurale]; null = solo il numero ("2 limoni" lo dice il nome).
const LABELS = {
  en: {
    tsp: ['tsp', 'tsp'], tbsp: ['tbsp', 'tbsp'], clove: ['clove', 'cloves'], can: ['can', 'cans'],
    bunch: ['bunch', 'bunches'], pinch: ['pinch', 'pinches'], slice: ['slice', 'slices'], sprig: ['sprig', 'sprigs'],
    sheet: ['sheet', 'sheets'], handful: ['handful', 'handfuls'], cup: ['cup', 'cups'], to_taste: 'to taste',
  },
  it: {
    tsp: ['cucchiaino', 'cucchiaini'], tbsp: ['cucchiaio', 'cucchiai'], clove: ['spicchio', 'spicchi'], can: ['lattina', 'lattine'],
    bunch: ['mazzetto', 'mazzetti'], pinch: ['pizzico', 'pizzichi'], slice: ['fetta', 'fette'], sprig: ['rametto', 'rametti'],
    sheet: ['foglio', 'fogli'], handful: ['manciata', 'manciate'], cup: ['tazza', 'tazze'], to_taste: 'q.b.',
  },
  es: {
    tsp: ['cdta', 'cdtas'], tbsp: ['cda', 'cdas'], clove: ['diente', 'dientes'], can: ['lata', 'latas'],
    bunch: ['manojo', 'manojos'], pinch: ['pizca', 'pizcas'], slice: ['rebanada', 'rebanadas'], sprig: ['ramita', 'ramitas'],
    sheet: ['hoja', 'hojas'], handful: ['puñado', 'puñados'], cup: ['taza', 'tazas'], to_taste: 'al gusto',
  },
  fr: {
    tsp: ['c. à c.', 'c. à c.'], tbsp: ['c. à s.', 'c. à s.'], clove: ['gousse', 'gousses'], can: ['boîte', 'boîtes'],
    bunch: ['botte', 'bottes'], pinch: ['pincée', 'pincées'], slice: ['tranche', 'tranches'], sprig: ['brin', 'brins'],
    sheet: ['feuille', 'feuilles'], handful: ['poignée', 'poignées'], cup: ['tasse', 'tasses'], to_taste: 'selon le goût',
  },
  de: {
    tsp: ['TL', 'TL'], tbsp: ['EL', 'EL'], clove: ['Zehe', 'Zehen'], can: ['Dose', 'Dosen'],
    bunch: ['Bund', 'Bund'], pinch: ['Prise', 'Prisen'], slice: ['Scheibe', 'Scheiben'], sprig: ['Zweig', 'Zweige'],
    sheet: ['Blatt', 'Blätter'], handful: ['Handvoll', 'Handvoll'], cup: ['Tasse', 'Tassen'], to_taste: 'nach Geschmack',
  },
  pt: {
    tsp: ['colher de chá', 'colheres de chá'], tbsp: ['colher de sopa', 'colheres de sopa'], clove: ['dente', 'dentes'], can: ['lata', 'latas'],
    bunch: ['maço', 'maços'], pinch: ['pitada', 'pitadas'], slice: ['fatia', 'fatias'], sprig: ['raminho', 'raminhos'],
    sheet: ['folha', 'folhas'], handful: ['punhado', 'punhados'], cup: ['xícara', 'xícaras'], to_taste: 'a gosto',
  },
};

const FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾', 0.333: '⅓', 0.667: '⅔' };

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

function decimal(value, lang) {
  const text = String(Math.round(value * 100) / 100);
  return lang === 'en' ? text : text.replace('.', ',');
}

/** 1.5 → "1½", 0.25 → "¼". Solo quarti e terzi, il resto in decimale. */
function fraction(value, lang) {
  const whole = Math.floor(value + 1e-9);
  const rest = Math.round((value - whole) * 1000) / 1000;
  if (rest < 0.01) return String(whole);
  const match = Object.keys(FRACTIONS).find((k) => Math.abs(Number(k) - rest) < 0.02);
  if (!match) return decimal(value, lang);
  return `${whole || ''}${FRACTIONS[match]}`;
}

function label(lang, unit, amount) {
  const table = LABELS[lang] || LABELS.en;
  const entry = table[unit];
  if (!entry) return '';
  if (typeof entry === 'string') return entry;
  return amount > 1 ? entry[1] : entry[0];
}

function roundMetric(amount) {
  if (amount < 10) return Math.max(1, Math.round(amount));
  if (amount < 100) return roundTo(amount, 5);
  if (amount < 1000) return roundTo(amount, 10);
  return roundTo(amount, 50);
}

function metricText(amount, unit, lang) {
  const rounded = roundMetric(amount);
  if (rounded >= 1000) {
    return `${decimal(rounded / 1000, lang)} ${unit === 'g' ? 'kg' : 'l'}`;
  }
  return `${rounded} ${unit}`;
}

function usWeight(grams, lang) {
  const oz = grams / 28.35;
  if (oz >= 16) return `${fraction(roundTo(oz / 16, 0.25), lang)} lb`;
  if (oz < 1) return `${fraction(Math.max(0.25, roundTo(oz, 0.25)), lang)} oz`;
  return `${fraction(roundTo(oz, oz < 4 ? 0.5 : 1), lang)} oz`;
}

function usVolume(ml, lang) {
  if (ml < 15) {
    const tsp = Math.max(0.25, roundTo(ml / 5, 0.25));
    return `${fraction(tsp, lang)} ${label(lang, 'tsp', tsp)}`;
  }
  if (ml < 60) {
    const tbsp = Math.max(0.5, roundTo(ml / 15, 0.5));
    return `${fraction(tbsp, lang)} ${label(lang, 'tbsp', tbsp)}`;
  }
  const cups = Math.max(0.25, roundTo(ml / 240, 0.25));
  return `${fraction(cups, lang)} ${label(lang, 'cup', cups)}`;
}

const COUNTED_HALVES = new Set(['piece', 'can', 'bunch', 'handful']);
const COUNTED_WHOLE = new Set(['clove', 'slice', 'sprig', 'sheet']);

/**
 * Una quantità canonica (per 2) scritta per l'utente.
 * @param {number} amount
 * @param {string} unit
 * @param {object} opts { servings, units: 'metric'|'us', lang }
 */
function quantityText(amount, unit, { servings = BASE_SERVINGS, units = 'metric', lang = 'en' } = {}) {
  if (unit === 'to_taste' || !(amount > 0)) return label(lang, 'to_taste', 0);
  const scaled = amount * (servings / BASE_SERVINGS);

  if (unit === 'g') return units === 'us' ? usWeight(scaled, lang) : metricText(scaled, 'g', lang);
  if (unit === 'ml') return units === 'us' ? usVolume(scaled, lang) : metricText(scaled, 'ml', lang);

  if (unit === 'tsp' || unit === 'tbsp') {
    let value = unit === 'tsp' ? roundTo(scaled, 0.25) : roundTo(scaled, 0.5);
    let u = unit;
    if (u === 'tsp' && value >= 3) {
      value = roundTo(value / 3, 0.5);
      u = 'tbsp';
    }
    if (u === 'tbsp' && value > 8) {
      return units === 'us' ? usVolume(value * 15, lang) : metricText(value * 15, 'ml', lang);
    }
    value = Math.max(u === 'tsp' ? 0.25 : 0.5, value);
    return `${fraction(value, lang)} ${label(lang, u, value)}`;
  }

  if (unit === 'pinch') {
    const value = Math.max(1, Math.round(scaled));
    return `${value} ${label(lang, 'pinch', value)}`;
  }

  let value;
  if (COUNTED_WHOLE.has(unit)) value = Math.max(1, Math.ceil(scaled - 0.01));
  else if (COUNTED_HALVES.has(unit)) value = Math.max(0.5, Math.ceil(scaled * 2 - 0.01) / 2);
  else value = Math.max(0.5, roundTo(scaled, 0.5));
  const text = fraction(value, lang);
  const word = label(lang, unit, value);
  return word ? `${text} ${word}` : text;
}

function temperatureText(celsius, units) {
  const c = Number(celsius);
  if (!Number.isFinite(c)) return '';
  if (units === 'us') return `${roundTo(c * 9 / 5 + 32, 5)}°F`;
  return `${Math.round(c)}°C`;
}

function lengthText(cm, units, lang) {
  const value = Number(cm);
  if (!Number.isFinite(value)) return '';
  if (units === 'us') {
    const inches = Math.max(0.25, roundTo(value / 2.54, 0.25));
    return `${fraction(inches, lang)} in`;
  }
  return `${decimal(value, lang)} cm`;
}

const TOKEN = /\{\{\s*([qtl])\s*:\s*([^}]*)\}\}/g;

/** Riempie {{q:200 g}}, {{t:180}}, {{l:2}} nei passaggi. */
function fillTokens(text, opts) {
  return String(text || '').replace(TOKEN, (_, kind, body) => {
    const raw = body.trim();
    if (kind === 't') return temperatureText(parseFloat(raw), opts.units) || raw;
    if (kind === 'l') return lengthText(parseFloat(raw), opts.units, opts.lang) || raw;
    const m = raw.match(/^([\d.,/]+)\s*([a-z_]+)?$/i);
    if (!m) return raw;
    let amount = m[1].includes('/') ? m[1].split('/').reduce((a, b) => Number(a) / Number(b)) : parseFloat(m[1].replace(',', '.'));
    let unit = (m[2] || 'piece').toLowerCase();
    if (unit === 'kg') { amount *= 1000; unit = 'g'; }
    if (unit === 'l') { amount *= 1000; unit = 'ml'; }
    if (!UNITS.includes(unit)) return raw;
    return quantityText(amount, unit, opts);
  });
}

/** I segnaposto di un testo, per controllare che la traduzione li tenga. */
function tokensOf(text) {
  return (String(text || '').match(TOKEN) || []).map((t) => t.replace(/\s+/g, '')).sort();
}

module.exports = { UNITS, BASE_SERVINGS, quantityText, fillTokens, tokensOf, temperatureText };
