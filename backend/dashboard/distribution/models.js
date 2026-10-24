// I modelli di generazione, tutti su fal.ai.
//
// Un solo fornitore e una sola chiave (FAL_KEY, già nel .env per le foto
// delle ricette) perché ogni fornitore in più è un altro account, un'altra
// fattura e un altro formato di risposta da normalizzare. Su fal ci sono
// tutti quelli che servono: cambiare modello è cambiare una stringa.
//
// Ogni voce sa tre cose: quanto costa, come si costruisce la richiesta e
// come si legge la risposta. Gli schemi degli endpoint non sono uguali fra
// loro — Kling vuole gli elementi, Seedream vuole `image_urls`, Wan vuole
// `num_frames` — e tenerli qui evita che le differenze si spargano nel
// motore.

// Prezzi verificati a settembre 2026. Sono stime a preventivo: quello che
// finisce nel registro dei costi è il preventivo, non la fattura di fal,
// quindi vanno riletti ogni tanto.
// Override da env per non dover ridistribuire il container quando fal
// ritocca il listino.
function price(envName, fallback) {
  const v = parseFloat(process.env[envName] || '');
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Uno stesso oggetto per immagini e video: `per` dice come si moltiplica. */
function perImage(usd) {
  return { per: 'image', usd, estimate: () => usd };
}
function perSecond(usd) {
  return { per: 'second', usd, estimate: (seconds) => usd * Math.max(1, Math.ceil(seconds || 0)) };
}

// ---------------------------------------------------------------------
// Immagini
// ---------------------------------------------------------------------

function gptImageBuild({ prompt, imageUrls }) {
  // `auto` legge il ritaglio dalla sorgente: un verticale resta verticale,
  // e non si forza un 16:9 su un selfie 9:16. La qualità è `high` perché
  // sui volti da UGC `medium` liscia i pori e `xhigh` costa il doppio
  // senza cambiare il senso del fotogramma.
  const quality = process.env.FAL_GPT_IMAGE_QUALITY || 'high';
  return {
    prompt,
    image_urls: imageUrls,
    image_size: 'auto',
    quality,
    num_images: 1,
    output_format: 'png',
    background: 'auto',
  };
}

const IMAGE_MODELS = [
  {
    id: 'gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare',
    endpoint: 'openai/gpt-image-2.5/flare/edit',
    note: 'Ricostruisce il riferimento da UGC: volto, luce, crop. Il default.',
    // Preventivo per un verticale ~1024×1536 a quality=high. Il listino
    // di fal scala con i pixel: override da env se il ritaglio medio cambia.
    price: perImage(price('FAL_GPT_IMAGE_2_5_USD', 0.05)),
    seed: false,
    maxRefs: 16,
    brief: 'gpt-image',
    build: gptImageBuild,
  },
  {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst',
    endpoint: 'openai/gpt-image-2.5/sunburst/edit',
    note: 'Stesso modello, più lento e più fermo sui dettagli fini.',
    price: perImage(price('FAL_GPT_IMAGE_2_5_USD', 0.05)),
    seed: false,
    maxRefs: 16,
    brief: 'gpt-image',
    build: gptImageBuild,
  },
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    endpoint: 'fal-ai/nano-banana-2/edit',
    note: 'Cambia quello che chiedi e lascia stare il resto.',
    price: perImage(price('FAL_NANO_BANANA_2_USD', 0.08)),
    // Gemini non accetta un seed: due run con lo stesso prompt danno
    // risultati diversi. Per le varianti è un vantaggio, per rifare
    // identica una cosa che è piaciuta no.
    seed: false,
    maxRefs: 14,
    build({ prompt, imageUrls }) {
      return { prompt, image_urls: imageUrls, num_images: 1, output_format: 'png' };
    },
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    endpoint: 'fal-ai/nano-banana-pro/edit',
    note: 'Ragiona di più sul contenuto. Per le variazioni vere.',
    price: perImage(price('FAL_NANO_BANANA_PRO_USD', 0.15)),
    seed: false,
    maxRefs: 14,
    build({ prompt, imageUrls }) {
      return { prompt, image_urls: imageUrls, num_images: 1, output_format: 'png' };
    },
  },
  {
    id: 'seedream-5-lite',
    label: 'Seedream 5.0 Lite',
    endpoint: 'fal-ai/bytedance/seedream/v5/lite/edit',
    note: 'Il più economico, fino a 3072px. Per i volumi.',
    price: perImage(price('FAL_SEEDREAM_5_LITE_USD', 0.035)),
    seed: true,
    maxRefs: 10,
    build({ prompt, imageUrls, seed }) {
      return {
        prompt,
        image_urls: imageUrls,
        num_images: 1,
        ...(Number.isInteger(seed) ? { seed } : {}),
      };
    },
  },
  {
    id: 'flux-2-pro',
    label: 'FLUX.2 [pro]',
    endpoint: 'fal-ai/flux-2-pro/edit',
    note: 'Preciso e con seed: l’unico con cui rifai identica una variante.',
    // $0.03 al megapixel: un verticale 1080x1920 sono 2,07 MP.
    price: perImage(price('FAL_FLUX_2_PRO_USD', 0.062)),
    seed: true,
    maxRefs: 8,
    build({ prompt, imageUrls, seed }) {
      return {
        prompt,
        image_urls: imageUrls,
        num_images: 1,
        output_format: 'png',
        ...(Number.isInteger(seed) ? { seed } : {}),
      };
    },
  },
];

// ---------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------

// Kling indirizza i riferimenti nel prompt con @Image1, @Element1. Il
// prompt lo scrive `prompts.js`, che sa quanti riferimenti gli sono stati
// passati; qui si sistemano solo nei campi giusti.
function klingBuild({ prompt, videoUrl, imageUrls, keepAudio }) {
  // Lo schema di o3/standard/video-to-video/edit non ha `duration`:
  // la lunghezza la decide il video di riferimento. Mandarla (per di più
  // come numero, mentre altri endpoint la vogliono stringa) è un campo
  // ignoto che a volte fal ingoia e a volte fa restare il job appeso.
  return {
    prompt,
    video_url: videoUrl,
    ...(imageUrls && imageUrls.length ? { image_urls: imageUrls.slice(0, 4) } : {}),
    keep_audio: keepAudio !== false,
  };
}

const VIDEO_MODELS = [
  {
    id: 'kling-o3',
    label: 'Kling O3',
    endpoint: 'fal-ai/kling-video/o3/standard/video-to-video/edit',
    note: 'Tiene movimento, camera e audio. Il default per i clip corti.',
    price: perSecond(price('FAL_KLING_O3_USD_SEC', 0.168)),
    // Il modello rifiuta sorgenti fuori da questi limiti: meglio dirlo
    // prima di spendere che leggere un 422 a run avviata.
    limits: { minSeconds: 3, maxSeconds: 15, minSide: 720, maxSide: 3840, maxBytes: 200 * 1024 * 1024 },
    refs: 'element',
    maxRefs: 4,
    build: klingBuild,
  },
  {
    id: 'kling-o1',
    label: 'Kling O1',
    endpoint: 'fal-ai/kling-video/o1/video-to-video/edit',
    note: 'La generazione precedente, stesso schema.',
    price: perSecond(price('FAL_KLING_O1_USD_SEC', 0.168)),
    limits: { minSeconds: 3, maxSeconds: 10, minSide: 720, maxSide: 2160, maxBytes: 200 * 1024 * 1024 },
    refs: 'element',
    maxRefs: 4,
    build: klingBuild,
  },
  {
    id: 'wan-vace-14b',
    label: 'Wan VACE 14B',
    endpoint: 'fal-ai/wan-vace-apps/video-edit',
    note: 'Un quarto del prezzo di Kling. Per le bozze e i volumi.',
    price: perSecond(price('FAL_WAN_VACE_USD_SEC', 0.05)),
    limits: { minSeconds: 1, maxSeconds: 20 },
    refs: 'image',
    maxRefs: 1,
    // Wan lavora a 480p e sale di prezzo con la risoluzione: per le
    // bozze la qualità che serve è "si capisce cosa cambia".
    build({ prompt, videoUrl, imageUrls }) {
      return {
        prompt,
        video_url: videoUrl,
        resolution: process.env.FAL_WAN_RESOLUTION || '480p',
        ...(imageUrls && imageUrls.length ? { image_url: imageUrls[0] } : {}),
      };
    },
  },
  {
    id: 'wan-2-7',
    label: 'Wan 2.7 Edit',
    endpoint: 'fal-ai/wan/v2.7/edit-video',
    note: 'Via di mezzo: meglio di VACE, meno di Kling.',
    price: perSecond(price('FAL_WAN_27_USD_SEC', 0.1)),
    limits: { minSeconds: 1, maxSeconds: 20 },
    refs: 'image',
    maxRefs: 1,
    build({ prompt, videoUrl, imageUrls, seed }) {
      return {
        prompt,
        video_url: videoUrl,
        resolution: '720p',
        ...(imageUrls && imageUrls.length ? { image_url: imageUrls[0] } : {}),
        ...(Number.isInteger(seed) ? { seed } : {}),
      };
    },
  },
  {
    id: 'seedance-2-5',
    label: 'Seedance 2.5 Edit',
    endpoint: 'bytedance/seedance-2.5/reference-to-video',
    note: 'Modifica vera (task editing): tiene formato, durata e movimento. Il più caro.',
    // A token: con un video di riferimento ~$0.284 al secondo fatturato a
    // 720p, e si fatturano sorgente + uscita, che in modifica durano uguale.
    price: perSecond(price('FAL_SEEDANCE_25_USD_SEC', 0.57)),
    limits: { minSeconds: 2, maxSeconds: 15 },
    refs: 'image',
    maxRefs: 4,
    // Il video da modificare è il primo riferimento: il prompt lo deve
    // chiamare @Video1, altrimenti il modello non sa qual è il master.
    build({ prompt, videoUrl, imageUrls, seed }) {
      return {
        prompt: `Edit @Video1. ${prompt} Keep the motion, camera, timing and audio of @Video1.`,
        task: 'editing',
        video_urls: [videoUrl],
        ...(imageUrls && imageUrls.length ? { image_urls: imageUrls.slice(0, 4) } : {}),
        resolution: process.env.FAL_SEEDANCE_RESOLUTION || '720p',
        generate_audio: true,
        ...(Number.isInteger(seed) ? { seed } : {}),
      };
    },
  },
  {
    id: 'wan-3-0',
    label: 'Wan 3.0',
    endpoint: 'alibaba/wan-3.0/reference-to-video',
    note: 'Rigenera dal clip invece di ritoccarlo: meno fedele al movimento di Kling e Seedance.',
    // $0.10/s di uscita a 720p, più i secondi del video di riferimento.
    price: perSecond(price('FAL_WAN_30_USD_SEC', 0.2)),
    // I riferimenti video non passano i 15s in tutto e vogliono 16+ fps.
    limits: { minSeconds: 2, maxSeconds: 15 },
    refs: 'image',
    maxRefs: 4,
    // Su fal Wan 3.0 non ha un endpoint di modifica: il clip entra come
    // riferimento e si chiama "Video 1", senza @. La durata va passata,
    // altrimenti fal ne fa 5s qualunque sia il clip.
    build({ prompt, videoUrl, imageUrls, duration, seed }) {
      const named = prompt.replace(/@Image(\d+)/g, 'Image $1');
      return {
        prompt: `Edit Video 1. ${named} Keep the motion, camera and timing of Video 1.`,
        reference_video_urls: [videoUrl],
        ...(imageUrls && imageUrls.length ? { reference_image_urls: imageUrls.slice(0, 4) } : {}),
        duration: Math.min(15, Math.max(2, Math.ceil(duration || 5))),
        resolution: process.env.FAL_WAN_30_RESOLUTION || '720p',
        audio: true,
        ...(Number.isInteger(seed) ? { seed } : {}),
      };
    },
  },
];

// ---------------------------------------------------------------------

const BY_ID = new Map([...IMAGE_MODELS, ...VIDEO_MODELS].map((m) => [m.id, m]));

// I default: immagini su GPT Image 2.5 Flare perché tiene il volto e il
// crop del riferimento (è quello che serve sull'UGC); video su Kling O3
// perché i clip sono da pochi secondi e lì la differenza di prezzo con
// Wan è di centesimi, mentre la differenza di qualità si vede.
const DEFAULTS = { image: 'gpt-image-2.5-flare', video: 'kling-o3' };

/** Se questo modello vuole il brief JSON di ricostruzione, non la frase corta. */
function usesGptImageBrief(model) {
  return Boolean(model && model.brief === 'gpt-image');
}

function get(id) {
  return BY_ID.get(id) || null;
}

function defaultFor(kind) {
  return BY_ID.get(DEFAULTS[kind]) || null;
}

/** Risolve un id scelto dall'utente, tornando al default se non esiste o è del tipo sbagliato. */
function resolve(kind, id) {
  const wanted = BY_ID.get(id);
  const list = kind === 'video' ? VIDEO_MODELS : IMAGE_MODELS;
  if (wanted && list.includes(wanted)) return wanted;
  return defaultFor(kind);
}

/** Quello che serve al browser per riempire le tendine. */
function catalog() {
  const strip = (m) => ({
    id: m.id,
    label: m.label,
    note: m.note,
    seed: Boolean(m.seed),
    price: { per: m.price.per, usd: m.price.usd },
    limits: m.limits || null,
  });
  return {
    image: IMAGE_MODELS.map(strip),
    video: VIDEO_MODELS.map(strip),
    defaults: DEFAULTS,
  };
}

/**
 * Preventivo di una singola generazione. Per i video si paga al secondo,
 * quindi la durata della sorgente è metà del conto.
 */
function estimate(model, { seconds } = {}) {
  if (!model) return 0;
  return model.price.estimate(seconds);
}

module.exports = {
  IMAGE_MODELS,
  VIDEO_MODELS,
  get,
  resolve,
  defaultFor,
  catalog,
  estimate,
  usesGptImageBrief,
};
