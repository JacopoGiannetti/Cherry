// I tipi di nodo: cosa accettano, cosa emettono, cosa si configura.
//
// Il punto da tenere a mente è che ogni collegamento trasporta una LISTA,
// non un file. Source ne emette uno, l'AI Wizard con otto varianti ne
// emette otto, il Merge di otto per tre ne emette ventiquattro. È questa
// moltiplicazione il motivo per cui lo strumento serve: da due sorgenti
// escono cinquanta uscite. Se i nodi fossero "un file dentro, un file
// fuori" il batch andrebbe riscritto da capo più avanti.
//
// I campi descritti qui vengono resi dal browser così come sono: aggiungere
// un'opzione a un nodo si fa in questo file, non in due.
const models = require('./models');
const prompts = require('./prompts');
const textStyle = require('./text-style');
const media = require('./media');

const MAX_VARIANTS = 12;

// Gli ingressi del Merge, nell'ordine in cui le clip vengono attaccate.
const MERGE_PORTS = ['a', 'b', 'c', 'd'];

const NODES = {
  source: {
    id: 'source',
    label: 'Source',
    tint: 'teal',
    summary: 'Da dove parte tutto: un file caricato o già nello storage.',
    inputs: [],
    outputs: [{ id: 'out', label: 'Contenuti', kind: 'any' }],
    defaults: { assetIds: [] },
    fields: [
      {
        key: 'assetIds',
        type: 'assets',
        label: 'Contenuti',
        help: 'Carica dal computer o scegli dallo storage. Quello che carichi viene salvato lì da solo.',
      },
    ],
  },

  wizard: {
    id: 'wizard',
    label: 'AI Wizard',
    tint: 'violet',
    summary: 'Genera varianti della sorgente. Si autoregola su immagine o video.',
    inputs: [{ id: 'in', label: 'Sorgente', kind: 'any' }],
    outputs: [{ id: 'out', label: 'Varianti', kind: 'any' }],
    defaults: {
      level: 'small',
      engine: 'exact',
      target: 'auto',
      count: 4,
      cleanup: [],
      note: '',
      anchor: true,
      imageModel: 'gpt-image-2.5-flare',
      videoModel: 'kling-o3',
      knobs: ['grade', 'zoom', 'grain'],
    },
    fields: [
      {
        key: 'level',
        type: 'segment',
        label: 'Quanto cambia',
        options: () => prompts.catalog().levels.map((l) => ({ value: l.id, label: l.label, help: l.hint })),
      },
      {
        // Lo slight change ha due anime. Correzione colore, zoom e
        // velocità sono operazioni esatte: gratis, istantanee e senza
        // rischio. Spostare una cintura o i pacchi sul sedile dietro è
        // contenuto, e lì serve un modello. Il default è l'esatto perché
        // per rendere un file diverso basta quello.
        key: 'engine',
        type: 'segment',
        label: 'Come',
        options: [
          { value: 'exact', label: 'Esatto', help: 'ffmpeg: colore, zoom, velocità. Gratis e immediato.' },
          { value: 'ai', label: 'AI', help: 'Tocca il contenuto: un oggetto si sposta o cambia colore.' },
        ],
        when: { level: 'slight' },
      },
      {
        key: 'target',
        type: 'select',
        label: 'Su cosa',
        options: () => prompts.catalog().targets.map((t) => ({ value: t.id, label: t.label })),
        help: 'Lascia “Decide l’AI” se non ti interessa dove cade la modifica.',
      },
      { key: 'count', type: 'number', label: 'Quante varianti', min: 1, max: MAX_VARIANTS, step: 1 },
      {
        // Quello che nella sorgente è appiccicato sopra e nelle varianti
        // non deve ricomparire. È una ricostruzione, non un ritaglio,
        // quindi la fa il modello: con il ritocco esatto non si può, e
        // sceglierlo lì sposta il nodo sul motore AI.
        key: 'cleanup',
        type: 'chips',
        label: 'Togli dal risultato',
        options: () => prompts.catalog().cleanup.map((c) => ({ value: c.id, label: c.label })),
        help: 'Sottotitoli bruciati, firme, sticker: quello che stava sopra al video di partenza. Serve l’AI, quindi si paga anche nello slight change.',
      },
      {
        key: 'note',
        type: 'textarea',
        label: 'Indicazione tua (facoltativa)',
        placeholder: 'es. tienila sempre in macchina',
        help: 'Una riga di regia. Senza, decide il modello.',
      },
      {
        key: 'anchor',
        type: 'toggle',
        label: 'Approva il fotogramma prima del video',
        help: 'Modifica il primo fotogramma come immagine, te lo mostra, e solo dopo genera il video. Costa un decimo e si vede prima se convince.',
        when: { kind: 'video' },
      },
      {
        key: 'imageModel',
        type: 'select',
        label: 'Modello immagini',
        options: () => models.catalog().image.map((m) => ({ value: m.id, label: m.label, help: m.note })),
      },
      {
        key: 'videoModel',
        type: 'select',
        label: 'Modello video',
        options: () => models.catalog().video.map((m) => ({ value: m.id, label: m.label, help: m.note })),
        when: { kind: 'video' },
      },
      {
        key: 'knobs',
        type: 'chips',
        label: 'Leve del ritocco',
        options: () => Object.entries(media.SLIGHT_KNOBS).map(([value, label]) => ({ value, label })),
        help: 'Ogni variante muove queste leve di un passo diverso, così nessuna è uguale a un’altra.',
        when: { exact: true },
      },
    ],
  },

  text: {
    id: 'text',
    label: 'Testo',
    tint: 'amber',
    summary: 'Stampa gli hook col font vero di TikTok o di Snapchat. Ogni hook è un video in più.',
    inputs: [{ id: 'in', label: 'Contenuti', kind: 'any' }],
    outputs: [{ id: 'out', label: 'Con testo', kind: 'any' }],
    defaults: { styles: ['tiktok'], background: 'stroke', hooks: '', y: null, scale: 1 },
    fields: [
      {
        key: 'hooks',
        type: 'textarea',
        label: 'Hook',
        placeholder: 'un hook per riga\nquando ha visto il prezzo\nnessuno ne parla ma',
        help: 'Uno per riga. Ogni hook diventa un contenuto a sé.',
      },
      {
        // Chips e non un interruttore a tre posizioni: "tutti e due" non è
        // un terzo stile, è averli accesi entrambi. E se un giorno ne
        // arriva un terzo, il campo non cambia.
        key: 'styles',
        type: 'chips',
        label: 'Stile',
        options: () => textStyle.catalog().map((s) => ({ value: s.id, label: s.label })),
        help: 'Accendili entrambi e ogni hook esce due volte, una per stile.',
      },
      {
        key: 'background',
        type: 'select',
        label: 'Sfondo del testo',
        options: (config) =>
          textStyle.style(textStyle.styles(config)[0]).backgrounds.map((b) => ({ value: b.id, label: b.label })),
        help: 'Vale per gli stili che lo prevedono: Snapchat usa sempre la sua barra.',
      },
      {
        key: 'y',
        type: 'range',
        label: 'Posizione verticale',
        min: 0,
        max: 1,
        step: 0.01,
        help: 'Resta dentro la zona sicura: sotto ci passa la UI di TikTok.',
      },
      { key: 'scale', type: 'range', label: 'Dimensione', min: 0.6, max: 1.8, step: 0.05, help: '1 è la misura standard dello stile.' },
    ],
  },

  merge: {
    id: 'merge',
    label: 'Merge',
    tint: 'green',
    summary: 'Ogni combinazione degli ingressi collegati, in fila. Da 10 hook e 2 demo escono 20 video.',
    // Quattro slot numerati e non due: le combinazioni vere si fanno con
    // hook + demo + coda, e l'ordine è quello degli ingressi. Gli ultimi
    // due sono facoltativi, un flusso con due ingressi resta valido.
    inputs: [
      { id: 'a', label: '1°', kind: 'any' },
      { id: 'b', label: '2°', kind: 'any' },
      { id: 'c', label: '3°', kind: 'any', optional: true },
      { id: 'd', label: '4°', kind: 'any', optional: true },
    ],
    outputs: [{ id: 'out', label: 'Unite', kind: 'video' }],
    defaults: { stillSeconds: 2.5, limit: 100, pick: 'spread' },
    fields: [
      { key: 'stillSeconds', type: 'number', label: 'Durata delle foto (s)', min: 0.5, max: 10, step: 0.5, help: 'Quanto resta a schermo un’immagine usata come clip.' },
      { key: 'limit', type: 'number', label: 'Tetto di combinazioni', min: 1, max: 500, step: 1, help: 'Il prodotto cresce in fretta: questo è il freno.' },
      {
        // Quando il tetto taglia, conta quali combinazioni restano.
        // Prendendole in fila si esaurisce il primo ingresso e l'ultimo
        // non compare mai: con due demo, la seconda non si vedrebbe.
        key: 'pick',
        type: 'segment',
        label: 'Se il tetto taglia',
        options: [
          { value: 'spread', label: 'Distribuite', help: 'A passo costante: ogni sorgente compare.' },
          { value: 'order', label: 'In fila', help: 'Le prime del prodotto, in ordine.' },
        ],
      },
    ],
  },

  save: {
    id: 'save',
    label: 'Save',
    tint: 'slate',
    summary: 'Ordina i risultati in Output, divisi fra Video e Foto.',
    inputs: [{ id: 'in', label: 'Da salvare', kind: 'any' }],
    outputs: [],
    defaults: { folderId: null, prefix: '' },
    fields: [
      {
        key: 'folderId',
        type: 'folder',
        label: 'Cartella',
        help: 'Lasciala com’è e va in Output / la cartella di questa run. Dentro, Video e Foto si separano da soli.',
      },
      { key: 'prefix', type: 'text', label: 'Prefisso dei nomi', placeholder: 'es. reaction-ott' },
    ],
  },
};

/** Il catalogo che il browser usa per la palette e per il pannello. */
function catalog() {
  const resolveOptions = (field) => ({
    ...field,
    // Le opzioni dinamiche (modelli, cartelle, stili) vengono risolte
    // adesso: il browser riceve elenchi già pronti.
    options: typeof field.options === 'function' ? field.options({}) : field.options || null,
  });

  return Object.values(NODES).map((n) => ({
    id: n.id,
    label: n.label,
    tint: n.tint,
    summary: n.summary,
    inputs: n.inputs,
    outputs: n.outputs,
    defaults: n.defaults,
    fields: n.fields.map(resolveOptions),
  }));
}

function type(id) {
  return NODES[id] || null;
}

/** La configurazione di un nodo, coi buchi riempiti dai default. */
function configOf(node) {
  const t = type(node.type);
  return { ...(t ? t.defaults : {}), ...(node.config || {}) };
}

/**
 * Se il Wizard se la cava con ffmpeg o se deve passare da un modello.
 *
 * Il ritocco esatto è gratis, ma sa solo spostare colori e inquadratura:
 * ricostruire quello che stava sotto a un sottotitolo non è nelle sue
 * corde. Chiedere una pulizia sposta quindi il nodo sull'AI, e il
 * preventivo deve saperlo prima della run, o mostra "gratis" e poi addebita.
 */
function wizardIsExact(config) {
  if (config.level !== 'slight') return false;
  if ((config.engine || 'exact') !== 'exact') return false;
  return !(config.cleanup || []).length;
}

/**
 * Quanto costerà un nodo, prima di premere Run.
 *
 * `incoming` è quante cose gli arrivano dall'alto e `seconds` la durata
 * media: senza queste due il preventivo di un nodo video non significa
 * niente, perché lì si paga al secondo per ogni variante.
 */
function estimateNode(node, { incoming = 1, seconds = 0, kind = 'image' } = {}) {
  const config = configOf(node);

  if (node.type === 'wizard') {
    const count = Math.max(1, Math.min(MAX_VARIANTS, config.count || 1));
    const jobs = incoming * count;
    // Il ritocco esatto è ffmpeg: non costa niente e non passa da fal.
    if (wizardIsExact(config)) return { usd: 0, jobs, free: true };

    if (kind === 'video') {
      const video = models.resolve('video', config.videoModel);
      const image = models.resolve('image', config.imageModel);
      const perVariant =
        models.estimate(video, { seconds }) + (config.anchor ? models.estimate(image) : 0);
      return { usd: perVariant * jobs, jobs };
    }
    const image = models.resolve('image', config.imageModel);
    return { usd: models.estimate(image) * jobs, jobs };
  }

  // Testo, merge e save girano in casa: costano tempo di CPU, non soldi.
  if (node.type === 'text') {
    return { usd: 0, jobs: incoming * textStyle.fanout(config), free: true };
  }
  if (node.type === 'merge') {
    return { usd: 0, jobs: Math.min(config.limit || 100, incoming), free: true };
  }
  return { usd: 0, jobs: incoming, free: true };
}

module.exports = {
  NODES,
  MAX_VARIANTS,
  MERGE_PORTS,
  catalog,
  type,
  configOf,
  estimateNode,
  wizardIsExact,
};
