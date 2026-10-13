// Lettore minimo delle metriche di un font TrueType.
//
// Serve a una cosa sola: sapere quanto è larga una riga di testo prima di
// disegnarla, per poter andare a capo dove ci andrebbe l'app vera. Senza
// misurare si finisce a indovinare con una media di caratteri per riga, e
// una didascalia che va a capo nel punto sbagliato si riconosce subito
// come "montata in post" — che è esattamente quello che vogliamo evitare.
//
// Il centraggio orizzontale non passa da qui: quello lo calcola ffmpeg con
// (w-text_w)/2, ed è esatto. Qui si decide solo dove spezzare.
const fs = require('fs');

const cache = new Map();

function readTables(buf) {
  const numTables = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const p = 12 + i * 16;
    const tag = buf.toString('ascii', p, p + 4);
    tables[tag] = { offset: buf.readUInt32BE(p + 8), length: buf.readUInt32BE(p + 12) };
  }
  return tables;
}

/** cmap formato 4: il caso normale per il Latino. */
function parseFormat4(buf, off, map) {
  const segCount = buf.readUInt16BE(off + 6) / 2;
  const endAt = off + 14;
  const startAt = endAt + segCount * 2 + 2;
  const deltaAt = startAt + segCount * 2;
  const rangeAt = deltaAt + segCount * 2;

  for (let s = 0; s < segCount; s++) {
    const end = buf.readUInt16BE(endAt + s * 2);
    const start = buf.readUInt16BE(startAt + s * 2);
    if (start > end) continue;
    const delta = buf.readInt16BE(deltaAt + s * 2);
    const rangeOffset = buf.readUInt16BE(rangeAt + s * 2);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let gid;
      if (rangeOffset === 0) {
        gid = (c + delta) & 0xffff;
      } else {
        const gi = rangeAt + s * 2 + rangeOffset + (c - start) * 2;
        if (gi + 1 >= buf.length) continue;
        gid = buf.readUInt16BE(gi);
        if (gid !== 0) gid = (gid + delta) & 0xffff;
      }
      if (gid) map.set(c, gid);
    }
  }
}

/** cmap formato 12: serve per emoji e per tutto ciò che sta oltre il BMP. */
function parseFormat12(buf, off, map) {
  const nGroups = buf.readUInt32BE(off + 12);
  for (let g = 0; g < nGroups; g++) {
    const p = off + 16 + g * 12;
    const start = buf.readUInt32BE(p);
    const end = buf.readUInt32BE(p + 4);
    const startGid = buf.readUInt32BE(p + 8);
    // Un gruppo può coprire un intervallo enorme: si tiene un tetto per
    // non costruire una mappa da milioni di voci per un font che non le usa.
    const span = Math.min(end - start, 0xffff);
    for (let i = 0; i <= span; i++) map.set(start + i, startGid + i);
  }
}

function parseCmap(buf, table) {
  const map = new Map();
  if (!table) return map;
  const off = table.offset;
  const numSub = buf.readUInt16BE(off + 2);

  let best = null;
  let bestScore = -1;
  for (let i = 0; i < numSub; i++) {
    const p = off + 4 + i * 8;
    const platform = buf.readUInt16BE(p);
    const encoding = buf.readUInt16BE(p + 2);
    const subOff = off + buf.readUInt32BE(p + 4);
    // Windows/UCS-4 batte Windows/BMP batte Unicode generico.
    let score = 0;
    if (platform === 3 && encoding === 10) score = 3;
    else if (platform === 3 && encoding === 1) score = 2;
    else if (platform === 0) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = subOff;
    }
  }
  if (best === null) return map;

  const format = buf.readUInt16BE(best);
  if (format === 4) parseFormat4(buf, best, map);
  else if (format === 12) parseFormat12(buf, best, map);
  return map;
}

/** Carica e memorizza le metriche di un font. Il parsing costa, la cache no. */
function load(file) {
  const hit = cache.get(file);
  if (hit) return hit;

  const buf = fs.readFileSync(file);
  const tables = readTables(buf);
  if (!tables.head || !tables.hhea || !tables.hmtx) {
    throw new Error(`Font senza tabelle metriche: ${file}`);
  }

  const unitsPerEm = buf.readUInt16BE(tables.head.offset + 18) || 1000;
  const numHMetrics = buf.readUInt16BE(tables.hhea.offset + 34);

  const advances = new Array(numHMetrics);
  for (let i = 0; i < numHMetrics; i++) {
    advances[i] = buf.readUInt16BE(tables.hmtx.offset + i * 4);
  }
  // Oltre numHMetrics tutti i glifi hanno la larghezza dell'ultimo: è così
  // che i font monospaziano le code senza ripetere il valore.
  const lastAdvance = advances[numHMetrics - 1] || unitsPerEm / 2;

  const cmap = parseCmap(buf, tables.cmap);

  let ascender = buf.readInt16BE(tables.hhea.offset + 4);
  let descender = buf.readInt16BE(tables.hhea.offset + 6);
  let capHeight = 0;
  if (tables['OS/2'] && tables['OS/2'].length >= 90) {
    const o = tables['OS/2'].offset;
    const version = buf.readUInt16BE(o);
    ascender = buf.readInt16BE(o + 68) || ascender;
    descender = buf.readInt16BE(o + 70) || descender;
    if (version >= 2) capHeight = buf.readInt16BE(o + 88);
  }

  const font = {
    file,
    unitsPerEm,
    ascender,
    descender,
    capHeight: capHeight || Math.round(unitsPerEm * 0.71),
    advanceOf(codePoint) {
      const gid = cmap.get(codePoint);
      if (gid === undefined) {
        // Carattere assente: si usa la larghezza dello spazio, che è la
        // stima meno sbagliata per il glifo di fallback.
        const spaceGid = cmap.get(32);
        return spaceGid !== undefined && spaceGid < numHMetrics ? advances[spaceGid] : lastAdvance;
      }
      return gid < numHMetrics ? advances[gid] : lastAdvance;
    },
  };

  cache.set(file, font);
  return font;
}

/** Larghezza di una stringa in pixel, a una data dimensione in punti. */
function measure(font, text, fontSize) {
  let units = 0;
  for (const ch of String(text)) units += font.advanceOf(ch.codePointAt(0));
  return (units / font.unitsPerEm) * fontSize;
}

/**
 * Manda a capo su più righe rispettando una larghezza massima.
 *
 * Gli a capo scritti a mano vengono rispettati: chi scrive una didascalia
 * su due righe di solito sa dove vuole la spezzatura, e riflowarla sarebbe
 * fastidioso. Una parola più larga della riga resta da sola e sfora, che è
 * meno peggio di spezzarla a metà.
 */
function wrap(font, text, fontSize, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (measure(font, candidate, fontSize) <= maxWidth) current = candidate;
      else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

module.exports = { load, measure, wrap };
