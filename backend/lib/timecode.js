// I tempi che arrivano da Gemini. Oltre il minuto a volte li scrive come
// "minuti e secondi incollati": 2:26 diventa 226, e letto come secondi
// manda fuori strada loop e fotogrammi. Qui si leggono in tutte le forme.

/** "1:27", "01:27.5", "0:01:27", 87, "87" → secondi. NaN se non è un tempo. */
function toSeconds(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  if (!s.includes(':')) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

const fromMss = (v) => Math.floor(v / 100) * 60 + (v % 100);

/**
 * true se questi numeri sono minuti-e-secondi incollati (226 = 2:26) e non secondi.
 * Si riconoscono così: nessun valore tra 60 e 99, nessuno con le ultime due cifre ≥ 60,
 * e (se si conosce la durata vera) l'ultimo va oltre la fine del video.
 */
function looksMss(values, duration) {
  const list = values.filter((v) => Number.isFinite(v));
  if (!list.some((v) => v >= 100)) return false;
  if (list.some((v) => v >= 60 && v % 100 >= 60)) return false;
  return duration ? Math.max(...list) > duration + 1.5 : false;
}

/** Gli spezzoni con i tempi rimessi in secondi veri, se erano incollati. null se erano già giusti. */
function repairSegments(segments, duration) {
  if (!Array.isArray(segments) || !segments.length || !duration) return null;
  if (!looksMss(segments.flatMap((s) => [s.start, s.end]), duration)) return null;
  return segments.map((s) => ({ ...s, start: fromMss(s.start), end: fromMss(s.end) }));
}

const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

module.exports = { toSeconds, fromMss, looksMss, repairSegments, clock };
