// I due stili di didascalia: quello di TikTok e quello di Snapchat.
//
// L'obiettivo è che il testo sia indistinguibile da quello scritto dentro
// l'app. Un testo in Inter o Poppins urla "montato in post" e il contenuto
// smette di sembrare organico, quindi si usano i font veri:
//
//   TikTok   — TikTok Sans, che TikTok ha rilasciato open source (OFL).
//              È letteralmente lo stesso file che usa l'app.
//   Snapchat — Snapchat Sans è proprietario e non è distribuibile. Il
//              sostituto più vicino è Public Sans: stesse proporzioni e
//              stessa spaziatura, cambia la coda della "g".
//
// I numeri qui sotto sono misurati su schermate reali. Sono tutti in un
// blocco solo perché la taratura fine si fa confrontando con uno screenshot
// vero, e deve essere un posto solo da toccare.
const path = require('path');
const ttf = require('./ttf');

const FONT_DIR = path.join(__dirname, 'fonts');

// ---------------------------------------------------------------------
// TARATURA — i valori da ritoccare confrontando con uno screenshot vero
// ---------------------------------------------------------------------
//
// Tutte le misure sono frazioni della larghezza o dell'altezza del video,
// mai pixel fissi: così una didascalia resa a 720x1280 e la stessa a
// 1080x1920 sono la stessa didascalia, non due dimensioni diverse.

const CAL = {
  tiktok: {
    // 5,1% della larghezza: 55px su 1080. Misurato sovrapponendo il testo
    // a didascalie TikTok reali.
    fontRatio: 0.051,
    // 1,06 e non il canonico 1,15: TikTok stringe le righe parecchio.
    lineHeight: 1.06,
    // Il contorno nero, 4px su 1080.
    strokeRatio: 0.0037,
    maxWidthRatio: 0.88,
    // 18% dall'alto, il "poco sopra la metà" dove TikTok mette il testo
    // quando non lo sposti.
    defaultY: 0.18,
    // Il margine del riquadro, in frazione del corpo del testo. Uno solo e
    // non due: drawtext accetta padding diversi per lato solo da ffmpeg 7,
    // e sia la versione di Debian sia quella che gira qui sono precedenti.
    boxPad: 0.3,
  },
  snapchat: {
    fontRatio: 0.052,
    lineHeight: 1.22,
    // La barra grigia: altezza pari a 2,2 volte il corpo del testo per la
    // riga singola, e cresce di una riga alla volta.
    barRatio: 2.2,
    barOpacity: 0.55,
    // Il testo può quasi riempire la barra, che è larga quanto il video.
    maxWidthRatio: 0.92,
    // Snapchat piazza la barra a metà schermo.
    defaultY: 0.5,
  },
  // La zona sicura: sotto ci passa la UI di TikTok (didascalia, profilo,
  // bottoni) e sopra la barra di stato. Un testo che ci finisce dentro
  // sembra un errore di montaggio, non una scelta.
  safe: { top: 150, bottom: 250, referenceHeight: 1920 },
};

// ---------------------------------------------------------------------

const STYLES = {
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    font: 'TikTokSans-SemiBold.ttf',
    fontLabel: 'TikTok Sans SemiBold',
    // Le varianti che l'app fa ciclare toccando il testo.
    backgrounds: [
      { id: 'stroke', label: 'Contorno' },
      { id: 'plain', label: 'Solo testo' },
      { id: 'box', label: 'Riquadro nero' },
      { id: 'boxWhite', label: 'Riquadro bianco' },
    ],
    defaultBackground: 'stroke',
  },
  snapchat: {
    id: 'snapchat',
    label: 'Snapchat',
    font: 'PublicSans-Medium.ttf',
    fontLabel: 'Public Sans Medium',
    backgrounds: [{ id: 'bar', label: 'Barra grigia' }],
    defaultBackground: 'bar',
  },
};

function style(id) {
  return STYLES[id] || STYLES.tiktok;
}

/**
 * Gli hook scritti nel nodo: uno per riga.
 *
 * Una riga per hook e non un campo per hook perché gli hook si scrivono
 * altrove e si incollano qui a blocchi di cinque o dieci.
 *
 * Legge anche il vecchio campo `text`, che conteneva una didascalia sola:
 * i flussi salvati prima non devono diventare nodi vuoti.
 */
function hooks(config) {
  const raw = config.hooks === undefined || config.hooks === null ? config.text : config.hooks;
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Gli stili scelti. Accendendoli tutti e due ogni hook esce in due
 * versioni, che è il modo di raddoppiare le uscite senza scrivere altro.
 */
function styles(config) {
  const list = Array.isArray(config.styles)
    ? config.styles
    : config.style
      ? [config.style]
      : [];
  const valid = list.filter((id) => STYLES[id]);
  return valid.length ? valid : ['tiktok'];
}

/** Per quanto si moltiplica quello che entra: hook × stili. */
function fanout(config) {
  return Math.max(1, hooks(config).length) * styles(config).length;
}

function catalog() {
  return Object.values(STYLES).map((s) => ({
    id: s.id,
    label: s.label,
    fontLabel: s.fontLabel,
    backgrounds: s.backgrounds,
    defaultBackground: s.defaultBackground,
  }));
}

/** La zona in cui il testo può stare, in pixel, per un video di questa altezza. */
function safeZone(height) {
  const k = height / CAL.safe.referenceHeight;
  return { top: Math.round(CAL.safe.top * k), bottom: Math.round(height - CAL.safe.bottom * k) };
}

/**
 * Calcola dove finisce ogni riga.
 *
 * `y` è la posizione verticale del centro del blocco di testo, da 0 a 1.
 * Viene ricondotta dentro la zona sicura: se il blocco non ci sta per
 * intero, si appoggia al bordo più vicino invece di uscire.
 *
 * `scale` moltiplica la dimensione standard dello stile, perché la
 * richiesta è poter partire dalla misura giusta e poi alzarla o abbassarla.
 */
function layout({ styleId, background, text, width, height, y, scale }) {
  const S = style(styleId);
  const cal = CAL[S.id];
  const font = ttf.load(path.join(FONT_DIR, S.font));

  const fontSize = Math.max(8, Math.round(width * cal.fontRatio * (scale || 1)));
  const maxWidth = width * cal.maxWidthRatio;
  const lines = ttf.wrap(font, text, fontSize, maxWidth);

  const lineStep = Math.round(fontSize * cal.lineHeight);
  // L'altezza visiva di una riga è l'occhio del font, non il corpo: usare
  // il corpo lascia un'aria sopra e sotto che sposta il centraggio.
  const glyphHeight = (font.capHeight / font.unitsPerEm) * fontSize;
  const blockHeight = lineStep * (lines.length - 1) + glyphHeight;

  // Lo sfondo si sceglie una volta per tutti gli stili, ma non tutti lo
  // hanno: "contorno" su Snapchat non vuol dire niente. Se non appartiene
  // a questo stile si usa il suo default, che è il comportamento giusto
  // quando lo stesso hook viene reso in due stili diversi.
  const wanted = background || S.defaultBackground;
  const bg = S.backgrounds.some((b) => b.id === wanted) ? wanted : S.defaultBackground;
  const zone = safeZone(height);

  // Per Snapchat il blocco da posizionare è la barra, non il testo.
  const barHeight =
    S.id === 'snapchat' ? Math.round(fontSize * cal.barRatio + lineStep * (lines.length - 1)) : 0;
  const outerHeight = S.id === 'snapchat' ? barHeight : blockHeight;

  const wantedCentre = height * (Number.isFinite(y) ? y : cal.defaultY);
  const half = outerHeight / 2;
  let centre = wantedCentre;
  if (centre - half < zone.top) centre = zone.top + half;
  if (centre + half > zone.bottom) centre = zone.bottom - half;
  // Se il blocco è più alto della zona sicura non c'è posizione buona: si
  // centra e si accetta lo sconfinamento, che almeno è simmetrico.
  if (outerHeight > zone.bottom - zone.top) centre = (zone.top + zone.bottom) / 2;

  const outerTop = Math.round(centre - half);
  const textTop = S.id === 'snapchat' ? Math.round(centre - blockHeight / 2) : outerTop;

  return {
    styleId: S.id,
    background: bg,
    font,
    fontFile: path.join(FONT_DIR, S.font),
    fontSize,
    lineStep,
    lines,
    blockHeight,
    // La riga i-esima: la y che vuole ffmpeg è quella del bordo superiore
    // della cella di testo, non della base del glifo.
    lineTop: (i) => Math.round(textTop + i * lineStep - (fontSize - glyphHeight) / 2),
    lineWidth: (i) => ttf.measure(font, lines[i], fontSize),
    bar:
      S.id === 'snapchat'
        ? { x: 0, y: outerTop, w: width, h: barHeight, opacity: cal.barOpacity }
        : null,
    stroke: bg === 'stroke' ? Math.max(1, Math.round(width * cal.strokeRatio)) : 0,
    boxPad: bg === 'box' || bg === 'boxWhite' ? Math.round(fontSize * (cal.boxPad || 0.3)) : 0,
    safe: zone,
  };
}

module.exports = { STYLES, CAL, style, catalog, hooks, styles, fanout, layout, safeZone, FONT_DIR };
