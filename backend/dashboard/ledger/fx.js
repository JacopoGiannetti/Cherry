// Cambi di riferimento BCE, per convertire in euro le fatture in valuta.
//
// Regola (art. 13 c. 4 DPR 633/72): il cambio del giorno della fattura,
// o se quel giorno non c'è (weekend, festivi TARGET) quello del giorno
// prima più vicino. La BCE pubblica verso le 16: una fattura di oggi,
// prima di allora, non ha ancora il suo cambio. In quel caso si usa
// l'ultimo pubblicato e il risultato è "provvisorio": la TD17 non si
// genera finché non diventa definitivo.
const API = 'https://data-api.ecb.europa.eu/service/data/EXR';

// currency -> { rates: Map(date -> rate), fetchedAt, from, to }
const cache = new Map();
const TTL_MS = 30 * 60 * 1000;

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isWeekday(iso) {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

async function fetchRange(currency, from, to) {
  const url = `${API}/D.${currency}.EUR.SP00.A?startPeriod=${from}&endPeriod=${to}&format=csvdata`;
  const response = await fetch(url, { headers: { Accept: 'text/csv' } });
  if (response.status === 404) return new Map();
  if (!response.ok) throw new Error(`BCE: ${response.status}`);
  const lines = (await response.text()).trim().split(/\r?\n/);
  const head = lines.shift().split(',');
  const iDate = head.indexOf('TIME_PERIOD');
  const iValue = head.indexOf('OBS_VALUE');
  const rates = new Map();
  for (const line of lines) {
    const cells = line.split(',');
    const rate = Number(cells[iValue]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(cells[iDate]) && rate > 0) rates.set(cells[iDate], rate);
  }
  return rates;
}

async function ratesFor(currency, dates) {
  const today = new Date().toISOString().slice(0, 10);
  const from = addDays(dates.reduce((a, b) => (a < b ? a : b)), -10);
  const hit = cache.get(currency);
  if (hit && hit.from <= from && Date.now() - hit.fetchedAt < TTL_MS) return hit.rates;
  const rates = await fetchRange(currency, from, today);
  cache.set(currency, { rates, fetchedAt: Date.now(), from, to: today });
  return rates;
}

/**
 * dates: ['2026-09-04', …] della stessa valuta.
 * Ritorna { [date]: { rate, rateDate, provisional } }: un euro vale
 * `rate` unità di valuta, quindi euro = importo / rate.
 */
async function convertDates(currency, dates) {
  const cur = String(currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur) || cur === 'EUR') throw new Error(`valuta non valida: ${currency}`);
  const unique = [...new Set(dates)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (!unique.length) return {};
  const rates = await ratesFor(cur, unique);
  if (!rates.size) throw new Error(`la BCE non pubblica un cambio per ${cur}`);
  const published = [...rates.keys()].sort();
  const latest = published[published.length - 1];
  const out = {};
  for (const date of unique) {
    let rateDate = null;
    for (let i = published.length - 1; i >= 0; i -= 1) {
      if (published[i] <= date) { rateDate = published[i]; break; }
    }
    if (!rateDate) throw new Error(`nessun cambio BCE ${cur} prima del ${date}`);
    // Manca il cambio proprio di quel giorno e non è uscito niente dopo:
    // se è un giorno lavorativo potrebbe ancora arrivare.
    const provisional = rateDate !== date && date >= latest && isWeekday(date);
    out[date] = { rate: rates.get(rateDate), rateDate, provisional };
  }
  return out;
}

module.exports = { convertDates };
