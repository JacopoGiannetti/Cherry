// I prompt dell'AI Wizard.
//
// La regola che tutti i modelli di editing rispettano è una sola: nomina
// solo quello che cambia. Il contenuto originale ha già inquadratura, luce,
// soggetto, movimento; descriverli di nuovo equivale a dire al modello che
// può rifarli, ed è così che una richiesta di "cambia il colore dei capelli"
// torna indietro con un'altra stanza e un'altra faccia. Ogni prompt qui
// finisce quindi con una clausola che inchioda quello che deve restare
// fermo, ed è la parte che fa la differenza fra un risultato usabile e uno
// buttato.
//
// La costruzione avviene in due tempi:
//   1. un modello legge la sorgente e scrive N istruzioni diverse fra loro
//      (senza questo passaggio "fammi 8 varianti" produce 8 volte la stessa
//      idea con parole diverse);
//   2. ogni istruzione viene impacchettata con la clausola di conservazione
//      del livello scelto.
const { generateJSON, imagePart, videoPart } = require('../../services/gemini');

// ---------------------------------------------------------------------
// I tre livelli
// ---------------------------------------------------------------------

const LEVELS = {
  slight: {
    id: 'slight',
    label: 'Slight change',
    hint: 'Quasi impercettibile: il contenuto è lo stesso, cambia un dettaglio.',
    // Cosa può toccare. Serve al modello che scrive le istruzioni, non a
    // quello che genera.
    allowed: [
      'the exact hue, position or angle of one small secondary object (a strap, a bag, a cup, a parcel, a sticker)',
      'the arrangement of minor clutter in the background',
      'a small accessory that is already present, moved or re-coloured',
      'the colour grade of the whole frame, shifted slightly warmer, cooler or flatter',
    ],
    forbidden: [
      'the person, their face, their identity',
      'their hair, their clothing, their expression, their pose',
      'the room or the place',
      'the action being performed',
    ],
    // La clausola di chiusura, quella che va nel prompt di generazione.
    preserve:
      'Keep the person, their face, their hair, their clothing, their expression and their pose exactly as in the source. ' +
      'Keep the same room, the same framing and the same lighting. Change nothing else.',
  },

  small: {
    id: 'small',
    label: 'Small variation',
    hint: 'Si nota ma non cambia il senso: capelli, vestiti, occhiali, posto.',
    allowed: [
      'the hair colour or the hairstyle of the person',
      'the garment they are wearing on top, its colour or its cut',
      'adding or removing one worn accessory such as glasses, a cap, earrings',
      'moving the scene to a different but equally plausible place of the same kind',
    ],
    forbidden: [
      'the identity of the person and the geometry of their face',
      'the action they are performing',
      'the emotion on their face and its intensity',
      'the camera: framing, distance, angle and movement',
    ],
    preserve:
      'Keep the same person with the same face and the same facial geometry. ' +
      'Keep the same expression, the same action and the same body pose. ' +
      'Keep the camera framing, the camera distance and the camera movement exactly as in the source.',
  },

  variation: {
    id: 'variation',
    label: 'Variation',
    hint: 'Nuovo contenuto con lo stesso identico senso: altra persona, altro posto.',
    allowed: [
      'a different person altogether: different face, different build, different hair',
      'a different setting that carries the same situation',
      'different clothing consistent with the new person and the new place',
    ],
    forbidden: [
      'the action: it must be the same action',
      'the emotion and its intensity: they must read the same',
      'the shot type and the framing',
      'the vertical 9:16 format',
    ],
    // Qui non si conserva l'aspetto ma il significato: è la richiesta
    // difficile, e va detta in modo che il modello non la legga come
    // "inventa qualcosa di nuovo".
    preserve:
      'The new content must read as the same moment performed by someone else: ' +
      'the same action, the same emotion at the same intensity, the same shot type, the same framing and the same vertical format. ' +
      'A viewer scrolling past must understand exactly the same thing.',
  },
};

// ---------------------------------------------------------------------
// I tre bersagli
// ---------------------------------------------------------------------

const TARGETS = {
  auto: {
    id: 'auto',
    label: 'Decide l’AI',
    instruction: 'Choose yourself which element to change, picking whatever gives the most useful difference at this level.',
  },
  subject: {
    id: 'subject',
    label: 'Soggetto',
    instruction: 'The change must land on the main subject, the person or object the shot is about. Leave the place and the background alone.',
  },
  location: {
    id: 'location',
    label: 'Location',
    instruction: 'The change must land on the place where the scene happens. Leave the main subject exactly as it is.',
  },
  background: {
    id: 'background',
    label: 'Sfondo',
    instruction: 'The change must land only on what sits behind the main subject. The subject itself and the immediate foreground stay untouched.',
  },
};

// ---------------------------------------------------------------------
// La pulizia: togliere quello che è stato appiccicato sopra
// ---------------------------------------------------------------------
//
// Un video ripreso dal feed di qualcun altro arriva con sopra roba che non
// c'entra con la scena: sottotitoli bruciati, la firma di chi l'ha
// pubblicato, sticker, la barra di avanzamento. Nelle varianti non deve
// restare niente di tutto questo, sia perché tradisce la provenienza sia
// perché una scritta vecchia sotto una nuova è la cosa più riconoscibile
// che ci sia.
//
// Non è un ritaglio: al modello si chiede di ricostruire quello che stava
// sotto. Dirglielo è la parte che conta, altrimenti sfoca la zona e si
// vede il rattoppo.

const CLEANUP = {
  captions: {
    id: 'captions',
    label: 'Scritte e sottotitoli',
    phrase: 'burned-in captions, subtitles, titles and any other lettering laid over the footage',
  },
  watermark: {
    id: 'watermark',
    label: 'Loghi e watermark',
    phrase: 'watermarks, platform logos, @usernames and channel signatures',
  },
  stickers: {
    id: 'stickers',
    label: 'Sticker ed emoji',
    phrase: 'stickers, emoji, arrows, circles, GIFs and any other graphic pasted on top',
  },
  ui: {
    id: 'ui',
    label: 'Interfaccia',
    phrase: 'interface elements such as progress bars, buttons, icons, counters and app chrome',
  },
};

/**
 * La frase che chiede di togliere le sovrimpressioni.
 *
 * Torna `null` se non c'è niente da togliere, così chi chiama non deve
 * distinguere fra lista vuota e lista assente.
 */
function cleanupClause(ids) {
  const picked = (Array.isArray(ids) ? ids : []).map((id) => CLEANUP[id]).filter(Boolean);
  if (!picked.length) return null;

  const list = picked.map((c) => c.phrase);
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join('; ')}; and ${list[list.length - 1]}`;

  return (
    `Remove from the result every overlay that was added on top of the original footage: ${joined}. ` +
    'These are not part of the filmed scene. Rebuild whatever they were covering from the scene underneath, ' +
    'continuing its texture, its lighting and its perspective, so that the area reads as if nothing was ever there. ' +
    'Do not blur, smudge, crop or cover them, and do not write anything of your own in their place.'
  );
}

/** Solo per il pianificatore: cosa sta già venendo tolto. */
function cleanupBrief(ids) {
  const picked = (Array.isArray(ids) ? ids : []).map((id) => CLEANUP[id]).filter(Boolean);
  if (!picked.length) return null;
  return picked.map((c) => c.phrase).join('; ');
}

function level(id) {
  return LEVELS[id] || LEVELS.small;
}
function target(id) {
  return TARGETS[id] || TARGETS.auto;
}

/** Per le tendine del browser. */
function catalog() {
  return {
    levels: Object.values(LEVELS).map((l) => ({ id: l.id, label: l.label, hint: l.hint })),
    targets: Object.values(TARGETS).map((t) => ({ id: t.id, label: t.label })),
    cleanup: Object.values(CLEANUP).map((c) => ({ id: c.id, label: c.label })),
  };
}

// ---------------------------------------------------------------------
// Il pianificatore: legge la sorgente e scrive N istruzioni diverse
// ---------------------------------------------------------------------

const S = { type: 'string' };
function obj(keys) {
  return { type: 'object', properties: Object.fromEntries(keys.map((k) => [k, S])) };
}

// Stessa alberatura del brief UGC: il pianificatore la riempie guardando
// la sorgente, una volta per variante. GPT Image 2.5 tiene il
// fotorealismo se ogni dimensione è nominata; una frase sola la lascia
// inventare.
const lookSchema = {
  type: 'object',
  properties: {
    canvas: obj([
      'orientation', 'aspect_ratio', 'framing', 'crop', 'subject_scale',
      'subject_alignment', 'camera_distance', 'headroom', 'bottom_crop',
      'left_background', 'right_background', 'instruction',
    ]),
    scene: {
      type: 'object',
      properties: {
        location: S,
        time_of_day: S,
        mood: S,
        visual_style: S,
        background_complexity: S,
        environment: obj(['walls', 'floor', 'furniture', 'windows', 'lighting', 'other']),
      },
    },
    subject: {
      type: 'object',
      properties: {
        description: S,
        position: S,
        body_visibility: S,
        pose: obj(['head', 'torso', 'shoulders', 'arms', 'hands', 'posture']),
        expression: obj(['overall', 'mouth', 'lips', 'gaze', 'brows']),
        skin: obj(['tone', 'undertone', 'finish', 'texture', 'freckles_and_marks', 'highlights', 'retouching']),
        face: {
          type: 'object',
          properties: {
            shape: S, forehead: S, cheekbones: S, jaw: S, chin: S,
            eyes: obj(['shape', 'color', 'size', 'lashes', 'eyeliner', 'eyeshadow', 'catchlights']),
            eyebrows: obj(['shape', 'color', 'density', 'finish']),
            nose: obj(['shape', 'bridge', 'tip', 'highlight']),
            lips: obj(['shape', 'upper_lip', 'lower_lip', 'color', 'liner', 'finish']),
            makeup: obj(['style', 'foundation', 'bronzer', 'blush', 'highlight', 'eyes', 'lips']),
          },
        },
      },
    },
    hair: obj([
      'color', 'style', 'part', 'texture', 'crown', 'front_sections',
      'left_face_strand', 'right_face_strand', 'back', 'flyaways', 'shine',
    ]),
    jewelry: {
      type: 'object',
      properties: {
        earrings: obj(['type', 'shape', 'material', 'surface', 'size', 'visibility', 'finish']),
        necklace: S,
        other: S,
      },
    },
    wardrobe: {
      type: 'object',
      properties: {
        top: obj([
          'type', 'color', 'neckline', 'construction', 'fit', 'material',
          'finish', 'wrinkles', 'instruction',
        ]),
        bottom: S,
        other: S,
      },
    },
    body_and_pose: obj([
      'shoulders', 'collarbones', 'upper_chest', 'torso', 'left_arm', 'right_arm', 'right_side',
    ]),
    background: {
      type: 'object',
      properties: {
        left: S,
        center_rear: S,
        right: S,
        depth: S,
      },
    },
    lighting: obj([
      'type', 'primary_source', 'direction', 'quality', 'contrast', 'subject',
      'background', 'skin_effect', 'hair_effect', 'fabric_effect',
      'color_temperature', 'shadow_style',
    ]),
    camera: obj([
      'device', 'orientation', 'lens', 'focal_length_equivalent', 'camera_height',
      'camera_distance', 'perspective', 'focus', 'depth_of_field', 'image_quality',
      'dynamic_range', 'processing', 'grain', 'motion_blur',
    ]),
    composition_geometry: obj([
      'face_center', 'eye_line', 'head_top', 'mouth', 'shoulder_line',
      'neckline', 'visual_balance',
    ]),
    color_palette: {
      type: 'object',
      properties: {
        dominant_colors: { type: 'array', items: S },
        skin: S,
        hair: S,
        top: S,
        jewelry: S,
        background: S,
        overall_saturation: S,
        contrast: S,
        white_balance: S,
      },
    },
    image_texture: obj([
      'skin', 'hair', 'fabric', 'metal', 'walls', 'furniture', 'other',
    ]),
  },
};

const planSchema = {
  type: 'object',
  properties: {
    read: {
      type: 'object',
      properties: {
        subject: S,
        action: S,
        place: S,
        mood: S,
      },
      required: ['subject', 'action', 'place', 'mood'],
    },
    variants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: S,
          instruction: S,
          look: lookSchema,
        },
        required: ['label', 'instruction', 'look'],
      },
    },
  },
  required: ['read', 'variants'],
};

/**
 * Chiede al modello di guardare la sorgente e proporre `count` modifiche
 * distinte fra loro, al livello e sul bersaglio richiesti.
 *
 * `media` è { buffer, mimeType, kind }. Un video viene mandato intero
 * quando è piccolo; per i clip verticali da pochi secondi lo è quasi
 * sempre, e se non lo è il chiamante passa i fotogrammi come immagini.
 */
async function plan({ media, levelId, targetId, count, userNote, cleanup }) {
  const L = level(levelId);
  const T = target(targetId);
  const n = Math.max(1, Math.min(20, count || 1));
  const removing = cleanupBrief(cleanup);

  const parts = [];
  if (media && media.buffer) {
    parts.push(
      media.kind === 'video'
        ? videoPart(media.buffer, media.mimeType || 'video/mp4')
        : imagePart(media.buffer, media.mimeType || 'image/jpeg')
    );
  }

  const prompt = [
    `You are directing ${n} variant${n > 1 ? 's' : ''} of one piece of short-form vertical content.`,
    '',
    'First read what you are looking at: who or what is the subject, what action is happening, where it happens, and what the emotional register is.',
    '',
    `Then write exactly ${n} variants at this level of change:`,
    `LEVEL — ${L.label}: ${L.hint}`,
    'At this level you may change:',
    ...L.allowed.map((a) => `  - ${a}`),
    'At this level you must never change:',
    ...L.forbidden.map((f) => `  - ${f}`),
    '',
    `WHERE THE CHANGE GOES — ${T.instruction}`,
    ...(removing
      ? [
          '',
          `ALREADY HANDLED — every variant will separately have these removed: ${removing}. ` +
            'Do not spend an instruction on removing them, and do not describe them as part of the scene.',
        ]
      : []),
    ...(userNote ? ['', `THE OPERATOR ALSO ASKS — ${userNote}`] : []),
    '',
    'Each variant has three things:',
    '  - label: two or three words in Italian, to name it in a list.',
    '  - instruction: the one change, starting with a verb, under 25 words. One change. No lists.',
    '  - look: a complete photorealistic specification of the IMAGE TO GENERATE, not of the source.',
    '',
    'look uses a fixed field tree (canvas, scene, subject, hair, jewelry, wardrobe, body_and_pose, background, lighting, camera, composition_geometry, color_palette, image_texture). Fill every field you can see or invent. Write concrete sensory detail: skin pores, fabric weave, light direction, millimetre crop, jewelry metal, wall texture. Empty or generic fields ("a person", "indoor", "natural light") are a failure.',
    '',
    'look is the picture AFTER the change, in ultra-real smartphone UGC style:',
    '  - visual_style is always an authentic high-resolution smartphone photo, never a studio campaign, CGI, or illustration.',
    '  - camera is always a modern phone: mild wide-angle, HDR, very light sensor grain, no motion blur.',
    '  - retouching is light social-media polish, never plastic skin.',
    '  - canvas is vertical 9:16 unless the source is clearly another shape.',
    '  - If a field does not apply (no jewelry, no person, no makeup), write "none" or "not visible". Do not omit the field.',
    '',
    L.id === 'variation'
      ? 'This level CHANGES THE PERSON. Each look must specify a different adult with a different face, skin, hair and wardrobe. Do not copy the source identity. Keep the same action, emotion, shot type and vertical framing.'
      : 'This level KEEPS THE PERSON. Each look describes that same person in full (face, skin, hair, pose) and applies only the named change to the relevant fields.',
    '',
    `The ${n} variants must be genuinely different from each other. Two looks that would photograph similarly are a failure.`,
    'Do not mention text, captions, UI, watermarks or icons anywhere in look: they are stripped later.',
  ].join('\n');

  const out = await generateJSON({
    label: 'distribution.plan',
    prompt,
    parts,
    schema: planSchema,
    // Serve varietà fra le istruzioni, non precisione: una temperatura
    // bassa qui produce otto varianti che si somigliano.
    temperature: 0.95,
  });

  const variants = Array.isArray(out.variants) ? out.variants.filter((v) => v && v.instruction) : [];
  // Il modello a volte ne restituisce una in meno o una in più: si taglia
  // e, se ne mancano, si ricicla con una nota di differenziazione invece
  // di far fallire la run.
  const filled = variants.slice(0, n);
  while (filled.length < n && variants.length) {
    const base = variants[filled.length % variants.length];
    filled.push({
      label: `${base.label} ${filled.length + 1}`,
      instruction: `${base.instruction} Make this one visibly different from the other variants.`,
      look: base.look || null,
    });
  }

  return { read: out.read || null, variants: filled };
}

// ---------------------------------------------------------------------
// Il prompt di generazione
// ---------------------------------------------------------------------

/**
 * Impacchetta un'istruzione nel prompt che va al modello che genera.
 *
 * Due forme:
 *
 * - Kling, Wan, Nano Banana: una frase. Nominare una cosa è dargli il
 *   permesso di rifarla, quindi si nomina solo il cambiamento.
 * - GPT Image 2.5: un JSON con l'alberatura completa di un brief UGC
 *   ultra-realistico (canvas, scena, volto, pelle, capelli, vestiti,
 *   luce, camera, geometria, palette, texture). I valori arrivano dal
 *   `look` del pianificatore, che descrive QUESTA variante — non una
 *   persona fissa, e non il fotogramma di partenza se il livello chiede
 *   un'altra faccia. Lo stile fotografico (smartphone, HDR, pori, niente
 *   CGI) è inchiodato nel JSON, ed è quello che obbliga il modello a
 *   generare da ultra-realistico.
 *
 * `look` è l'oggetto del pianificatore. `brief` è `'gpt-image'` o assente.
 */
function buildEditPrompt({ levelId, instruction, refs = 0, refKind = 'image', cleanup, look, brief }) {
  if (brief === 'gpt-image') return buildGptImageBrief({ levelId, instruction, cleanup, look });

  const L = level(levelId);
  const parts = [instruction.trim().replace(/\s*$/, '')];
  if (!/[.!?]$/.test(parts[0])) parts[0] += '.';

  if (refs > 0) {
    const names = Array.from({ length: refs }, (_, i) => `@${refKind === 'element' ? 'Element' : 'Image'}${i + 1}`);
    parts.push(`Use ${names.join(' and ')} as the reference for how it should look.`);
  }

  const clean = cleanupClause(cleanup);
  if (clean) parts.push(clean);

  parts.push(clean ? `Beyond that edit and those removals, ${lowerFirst(L.preserve)}` : L.preserve);
  return parts.join(' ');
}

const NEGATIVE = [
  'text', 'caption', 'white heart icon', 'social media UI', 'buttons', 'watermark',
  'logo', 'screen overlay', 'timestamps', 'extra people', 'hard flash',
  'dramatic cinematic shadows', 'extreme bokeh', 'fisheye distortion',
  'plastic skin', 'over-smoothed face', 'over-sharpened pores',
  'CGI', '3D render', 'illustration', 'anime', 'cartoon',
  'distorted anatomy', 'warped shoulders', 'asymmetrical eyes',
  'studio backdrop', 'beauty-dish lighting', 'uncanny valley',
];

function pick(src, path, fallback) {
  let cur = src;
  for (const key of path.split('.')) {
    if (!cur || typeof cur !== 'object') return fallback;
    cur = cur[key];
  }
  if (cur == null || cur === '') return fallback;
  return cur;
}

/**
 * Costruisce il JSON completo, campo per campo come un brief UGC
 * ultra-realistico. I valori di scena/persona arrivano da `look`; lo
 * stile fotografico è fisso, ed è quello che tiene il modello sul
 * fotorealismo anche quando la persona cambia.
 */
function buildGptImageBrief({ levelId, instruction, cleanup, look }) {
  const L = level(levelId);
  const LKP = look && typeof look === 'object' ? look : {};
  const change = (instruction || '').trim().replace(/\s*$/, '');
  const changeDot = change ? (change.endsWith('.') ? change : `${change}.`) : '';
  const clean = cleanupClause(cleanup);

  const canvas = {
    orientation: pick(LKP, 'canvas.orientation', 'portrait'),
    aspect_ratio: pick(LKP, 'canvas.aspect_ratio', '9:16'),
    framing: pick(LKP, 'canvas.framing', 'tight vertical smartphone photo'),
    crop: pick(LKP, 'canvas.crop', 'match a natural phone crop of the scene'),
    subject_scale: pick(LKP, 'canvas.subject_scale', 'subject occupying most of the frame'),
    subject_alignment: pick(LKP, 'canvas.subject_alignment', 'slightly off-center as in a handheld selfie'),
    camera_distance: pick(LKP, 'canvas.camera_distance', "close arm's-length smartphone distance"),
    headroom: pick(LKP, 'canvas.headroom', 'small, as in a real phone selfie'),
    bottom_crop: pick(LKP, 'canvas.bottom_crop', 'cuts through the lower torso or as the look describes'),
    left_background: pick(LKP, 'canvas.left_background', 'environment visible at left'),
    right_background: pick(LKP, 'canvas.right_background', 'environment visible at right'),
    instruction: 'do not include any social-media interface graphics, hearts, buttons, captions or watermarks',
  };

  const scene = {
    location: pick(LKP, 'scene.location', 'real interior or exterior matching the action'),
    time_of_day: pick(LKP, 'scene.time_of_day', 'daytime with natural light'),
    mood: pick(LKP, 'scene.mood', 'intimate, casual, lived-in'),
    visual_style: 'authentic high-resolution smartphone beauty/UGC photo',
    background_complexity: pick(LKP, 'scene.background_complexity', 'moderate but visually subdued'),
    environment: {
      walls: pick(LKP, 'scene.environment.walls', 'real walls with visible texture'),
      floor: pick(LKP, 'scene.environment.floor', 'as visible, or not in frame'),
      furniture: pick(LKP, 'scene.environment.furniture', 'real furniture, slightly out of focus'),
      windows: pick(LKP, 'scene.environment.windows', 'as visible'),
      lighting: pick(LKP, 'scene.environment.lighting', 'bright natural light on the subject, darker surroundings'),
      other: pick(LKP, 'scene.environment.other', 'none'),
    },
  };

  const subject = {
    description: pick(LKP, 'subject.description', 'the person performing the action, an adult'),
    position: pick(LKP, 'subject.position', 'center foreground'),
    body_visibility: pick(LKP, 'subject.body_visibility', 'head, neck, shoulders, upper torso'),
    pose: {
      head: pick(LKP, 'subject.pose.head', 'upright, slight natural turn'),
      torso: pick(LKP, 'subject.pose.torso', 'mostly frontal'),
      shoulders: pick(LKP, 'subject.pose.shoulders', 'relaxed'),
      arms: pick(LKP, 'subject.pose.arms', 'as in a handheld phone photo'),
      hands: pick(LKP, 'subject.pose.hands', 'as visible, natural'),
      posture: pick(LKP, 'subject.pose.posture', 'upright and casual'),
    },
    expression: {
      overall: pick(LKP, 'subject.expression.overall', 'natural, unposed'),
      mouth: pick(LKP, 'subject.expression.mouth', 'relaxed'),
      lips: pick(LKP, 'subject.expression.lips', 'softly closed or speaking naturally'),
      gaze: pick(LKP, 'subject.expression.gaze', 'into the camera or as the action requires'),
      brows: pick(LKP, 'subject.expression.brows', 'relaxed and defined'),
    },
    skin: {
      tone: pick(LKP, 'subject.skin.tone', 'natural, specific, not generic beige'),
      undertone: pick(LKP, 'subject.skin.undertone', 'as observed, warm or cool'),
      finish: pick(LKP, 'subject.skin.finish', 'luminous satin glow, not matte plastic'),
      texture: pick(LKP, 'subject.skin.texture', 'realistic fine skin texture with subtle pores'),
      freckles_and_marks: pick(LKP, 'subject.skin.freckles_and_marks', 'small natural marks retained'),
      highlights: pick(LKP, 'subject.skin.highlights', 'bright natural highlights on forehead, cheekbones, nose, collarbones'),
      retouching: 'light-to-moderate social-media processing, never plastic',
    },
    face: {
      shape: pick(LKP, 'subject.face.shape', 'natural, specific to this person'),
      forehead: pick(LKP, 'subject.face.forehead', 'as this person'),
      cheekbones: pick(LKP, 'subject.face.cheekbones', 'defined but natural'),
      jaw: pick(LKP, 'subject.face.jaw', 'as this person'),
      chin: pick(LKP, 'subject.face.chin', 'as this person'),
      eyes: {
        shape: pick(LKP, 'subject.face.eyes.shape', 'natural'),
        color: pick(LKP, 'subject.face.eyes.color', 'specific iris colour'),
        size: pick(LKP, 'subject.face.eyes.size', 'medium'),
        lashes: pick(LKP, 'subject.face.eyes.lashes', 'real lashes, cleanly separated'),
        eyeliner: pick(LKP, 'subject.face.eyes.eyeliner', 'as worn, or none'),
        eyeshadow: pick(LKP, 'subject.face.eyes.eyeshadow', 'as worn, or none'),
        catchlights: pick(LKP, 'subject.face.eyes.catchlights', 'bright natural window reflections'),
      },
      eyebrows: {
        shape: pick(LKP, 'subject.face.eyebrows.shape', 'natural arch'),
        color: pick(LKP, 'subject.face.eyebrows.color', 'matching the hair'),
        density: pick(LKP, 'subject.face.eyebrows.density', 'medium'),
        finish: pick(LKP, 'subject.face.eyebrows.finish', 'groomed, not drawn on'),
      },
      nose: {
        shape: pick(LKP, 'subject.face.nose.shape', 'as this person'),
        bridge: pick(LKP, 'subject.face.nose.bridge', 'as this person'),
        tip: pick(LKP, 'subject.face.nose.tip', 'as this person'),
        highlight: pick(LKP, 'subject.face.nose.highlight', 'subtle centered highlight'),
      },
      lips: {
        shape: pick(LKP, 'subject.face.lips.shape', 'as this person'),
        upper_lip: pick(LKP, 'subject.face.lips.upper_lip', 'as this person'),
        lower_lip: pick(LKP, 'subject.face.lips.lower_lip', 'as this person'),
        color: pick(LKP, 'subject.face.lips.color', 'natural lip colour'),
        liner: pick(LKP, 'subject.face.lips.liner', 'none, or as worn'),
        finish: pick(LKP, 'subject.face.lips.finish', 'soft natural moisture'),
      },
      makeup: {
        style: pick(LKP, 'subject.face.makeup.style', 'natural or soft glam as this person'),
        foundation: pick(LKP, 'subject.face.makeup.foundation', 'skin-like, pores still visible'),
        bronzer: pick(LKP, 'subject.face.makeup.bronzer', 'as worn, or none'),
        blush: pick(LKP, 'subject.face.makeup.blush', 'as worn, or natural flush'),
        highlight: pick(LKP, 'subject.face.makeup.highlight', 'controlled luminous sheen'),
        eyes: pick(LKP, 'subject.face.makeup.eyes', 'as worn'),
        lips: pick(LKP, 'subject.face.makeup.lips', 'as worn'),
      },
    },
  };

  const hair = {
    color: pick(LKP, 'hair.color', 'specific, not generic brown'),
    style: pick(LKP, 'hair.style', 'as this person wears it'),
    part: pick(LKP, 'hair.part', 'as this person'),
    texture: pick(LKP, 'hair.texture', 'individual strands visible'),
    crown: pick(LKP, 'hair.crown', 'natural volume'),
    front_sections: pick(LKP, 'hair.front_sections', 'as this person'),
    left_face_strand: pick(LKP, 'hair.left_face_strand', 'as visible, or none'),
    right_face_strand: pick(LKP, 'hair.right_face_strand', 'as visible, or none'),
    back: pick(LKP, 'hair.back', 'as this person'),
    flyaways: pick(LKP, 'hair.flyaways', 'minimal but realistic'),
    shine: pick(LKP, 'hair.shine', 'soft natural highlights along strands'),
  };

  const jewelry = {
    earrings: {
      type: pick(LKP, 'jewelry.earrings.type', 'none'),
      shape: pick(LKP, 'jewelry.earrings.shape', 'none'),
      material: pick(LKP, 'jewelry.earrings.material', 'none'),
      surface: pick(LKP, 'jewelry.earrings.surface', 'none'),
      size: pick(LKP, 'jewelry.earrings.size', 'none'),
      visibility: pick(LKP, 'jewelry.earrings.visibility', 'none'),
      finish: pick(LKP, 'jewelry.earrings.finish', 'none'),
    },
    necklace: pick(LKP, 'jewelry.necklace', 'none'),
    other: pick(LKP, 'jewelry.other', 'none'),
  };

  const wardrobe = {
    top: {
      type: pick(LKP, 'wardrobe.top.type', 'the garment worn on top'),
      color: pick(LKP, 'wardrobe.top.color', 'specific colour'),
      neckline: pick(LKP, 'wardrobe.top.neckline', 'as worn'),
      construction: pick(LKP, 'wardrobe.top.construction', 'real seams and structure'),
      fit: pick(LKP, 'wardrobe.top.fit', 'as worn, with realistic tension'),
      material: pick(LKP, 'wardrobe.top.material', 'named fabric with visible weave or sheen'),
      finish: pick(LKP, 'wardrobe.top.finish', 'real fabric highlight, not CGI gloss'),
      wrinkles: pick(LKP, 'wardrobe.top.wrinkles', 'small realistic tension creases'),
      instruction: pick(LKP, 'wardrobe.top.instruction', 'keep the garment looking like clothing, not a costume'),
    },
    bottom: pick(LKP, 'wardrobe.bottom', 'as visible, or cropped out'),
    other: pick(LKP, 'wardrobe.other', 'none'),
  };

  const body_and_pose = {
    shoulders: pick(LKP, 'body_and_pose.shoulders', 'natural, evenly lit'),
    collarbones: pick(LKP, 'body_and_pose.collarbones', 'visible with soft highlights if the neckline shows them'),
    upper_chest: pick(LKP, 'body_and_pose.upper_chest', 'natural skin with tonal variation'),
    torso: pick(LKP, 'body_and_pose.torso', 'slightly angled, mostly frontal'),
    left_arm: pick(LKP, 'body_and_pose.left_arm', 'as visible'),
    right_arm: pick(LKP, 'body_and_pose.right_arm', 'as visible'),
    right_side: pick(LKP, 'body_and_pose.right_side', 'as cropped'),
  };

  const background = {
    left: pick(LKP, 'background.left', 'real environment, slightly softer than the subject'),
    center_rear: pick(LKP, 'background.center_rear', 'real environment behind the subject'),
    right: pick(LKP, 'background.right', 'real environment, slightly softer than the subject'),
    depth: pick(LKP, 'background.depth', 'moderately deep, natural phone depth of field'),
  };

  const lighting = {
    type: pick(LKP, 'lighting.type', 'strong natural daylight'),
    primary_source: pick(LKP, 'lighting.primary_source', 'window or open sky near the camera'),
    direction: pick(LKP, 'lighting.direction', 'front and slightly above'),
    quality: pick(LKP, 'lighting.quality', 'bright but diffused'),
    contrast: pick(LKP, 'lighting.contrast', 'higher on the subject than on the room'),
    subject: pick(LKP, 'lighting.subject', 'face and upper body brightly illuminated'),
    background: pick(LKP, 'lighting.background', 'a stop darker than the subject'),
    skin_effect: pick(LKP, 'lighting.skin_effect', 'warm luminous highlights without clipped whites'),
    hair_effect: pick(LKP, 'lighting.hair_effect', 'subtle glossy strand reflections'),
    fabric_effect: pick(LKP, 'lighting.fabric_effect', 'soft sheen matching the fabric'),
    color_temperature: pick(LKP, 'lighting.color_temperature', 'neutral-warm daylight'),
    shadow_style: pick(LKP, 'lighting.shadow_style', 'very soft facial shadows, deeper background shadows'),
  };

  const camera = {
    device: pick(LKP, 'camera.device', 'modern smartphone camera'),
    orientation: pick(LKP, 'camera.orientation', 'vertical portrait'),
    lens: pick(LKP, 'camera.lens', 'standard wide selfie or rear phone lens'),
    focal_length_equivalent: pick(LKP, 'camera.focal_length_equivalent', 'approximately 24-28mm'),
    camera_height: pick(LKP, 'camera.camera_height', 'near face level'),
    camera_distance: pick(LKP, 'camera.camera_distance', 'approximately 45-70 cm from the face'),
    perspective: pick(LKP, 'camera.perspective', 'mild wide-angle smartphone perspective'),
    focus: pick(LKP, 'camera.focus', 'sharpest on eyes and face'),
    depth_of_field: pick(LKP, 'camera.depth_of_field', 'moderately deep, background naturally softer'),
    image_quality: 'high-resolution smartphone image',
    dynamic_range: 'strong HDR preserving bright skin and darker surroundings',
    processing: 'subtle sharpening and noise reduction, phone pipeline',
    grain: 'very light realistic phone-sensor grain',
    motion_blur: 'none',
  };

  const composition_geometry = {
    face_center: pick(LKP, 'composition_geometry.face_center', 'upper third, slightly off-center'),
    eye_line: pick(LKP, 'composition_geometry.eye_line', 'upper third'),
    head_top: pick(LKP, 'composition_geometry.head_top', 'near the top edge with little headroom'),
    mouth: pick(LKP, 'composition_geometry.mouth', 'below the eyes, natural spacing'),
    shoulder_line: pick(LKP, 'composition_geometry.shoulder_line', 'mid-frame'),
    neckline: pick(LKP, 'composition_geometry.neckline', 'lower third'),
    visual_balance: pick(LKP, 'composition_geometry.visual_balance', 'bright subject against a quieter room'),
  };

  const colors = Array.isArray(LKP.color_palette && LKP.color_palette.dominant_colors)
    ? LKP.color_palette.dominant_colors.filter(Boolean)
    : [];

  const color_palette = {
    dominant_colors: colors.length ? colors : ['skin', 'hair', 'garment', 'background'],
    skin: pick(LKP, 'color_palette.skin', subject.skin.tone),
    hair: pick(LKP, 'color_palette.hair', hair.color),
    top: pick(LKP, 'color_palette.top', wardrobe.top.color),
    jewelry: pick(LKP, 'color_palette.jewelry', jewelry.earrings.material),
    background: pick(LKP, 'color_palette.background', 'muted interior tones'),
    overall_saturation: pick(LKP, 'color_palette.overall_saturation', 'moderate'),
    contrast: pick(LKP, 'color_palette.contrast', 'moderately high'),
    white_balance: pick(LKP, 'color_palette.white_balance', 'warm-neutral'),
  };

  const image_texture = {
    skin: pick(LKP, 'image_texture.skin', 'fine pores, subtle freckles, small natural marks'),
    hair: pick(LKP, 'image_texture.hair', 'individual strands and soft flyaways'),
    fabric: pick(LKP, 'image_texture.fabric', 'real weave or sheen with fine tension folds'),
    metal: pick(LKP, 'image_texture.metal', jewelry.earrings.type === 'none' ? 'none' : 'polished metal reflections'),
    walls: pick(LKP, 'image_texture.walls', 'matte real plaster or paint'),
    furniture: pick(LKP, 'image_texture.furniture', 'soft real upholstery or wood'),
    other: pick(LKP, 'image_texture.other', 'none'),
  };

  const photographic_style = {
    genre: 'beauty and lifestyle smartphone photo',
    aesthetic: 'authentic social-media UGC, luxury-casual',
    realism: 'extreme photorealism',
    retouching: 'polished but believable',
    production_value: 'personal phone photo with high-quality natural light',
    desired_result: 'looks like a genuine high-resolution selfie or phone still, not a generated image',
  };

  const brief = {
    prompt_type: 'photorealistic_ugc_generation',
    objective:
      'Generate one extremely photorealistic vertical smartphone photograph. ' +
      'The look fields below are the complete specification of this image: face, skin, hair, clothing, pose, lighting, interior, camera, crop, colour and texture. ' +
      (changeDot ? `The intended difference from a previous take is: ${changeDot} ` : '') +
      'Completely ignore and remove all text, icons, hearts, buttons, interface graphics, timestamps, watermarks, logos, or other on-screen elements.',
    change: {
      instruction: changeDot || 'none — generate the look as specified',
      rule: 'one intended difference; the look fields are authoritative for everything else',
      level: L.label,
    },
    preserve: L.preserve,
    reference_fidelity: {
      target: 'extreme photorealism in authentic smartphone-UGC style',
      priority_order: [
        'overall vertical crop and composition',
        'facial proportions, skin texture and expression as specified in look',
        'hairstyle and clothing as specified in look',
        'pose and camera perspective',
        'lighting direction and colour temperature',
        'interior/background',
        'natural smartphone-camera rendering',
      ],
    },
    canvas,
    scene,
    subject,
    hair,
    jewelry,
    wardrobe,
    body_and_pose,
    background,
    lighting,
    camera,
    composition_geometry,
    color_palette,
    image_texture,
    photographic_style,
    ...(clean ? { overlay_removal: clean } : {}),
    negative_prompt: NEGATIVE,
    final_generation_instruction: [
      'Generate one extremely photorealistic vertical smartphone photo.',
      subject.description + '.',
      `Skin: ${subject.skin.tone}, ${subject.skin.texture}, ${subject.skin.finish}.`,
      `Hair: ${hair.color} ${hair.style}, ${hair.texture}.`,
      `Wearing ${wardrobe.top.color} ${wardrobe.top.type} in ${wardrobe.top.material}.`,
      `Place: ${scene.location}, ${lighting.type} from ${lighting.primary_source}.`,
      `Frame: ${canvas.framing}, ${canvas.crop}, ${camera.device}, ${camera.perspective}.`,
      changeDot ? `The one intended difference: ${changeDot}` : '',
      L.preserve,
      'Preserve realistic skin pores, subtle marks, natural smartphone HDR, mild phone-lens perspective, and crisp facial detail.',
      'Completely omit text, buttons, watermarks, logos, interface graphics and screen overlays.',
      clean || '',
    ].filter(Boolean).join(' '),
  };

  return JSON.stringify(brief);
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Il prompt del secondo passo del flusso ad ancora: il fotogramma è già
 * stato modificato e approvato, al modello video si chiede solo di
 * portarlo su tutta la clip. Non si ripete cosa è cambiato — l'ancora lo
 * mostra, e ridirlo a parole è l'occasione perché il modello lo reinterpreti.
 */
function buildAnchorPrompt({ refKind = 'image', cleanup }) {
  const ref = refKind === 'element' ? '@Element1' : '@Image1';
  const parts = [`Apply the appearance shown in ${ref} to the video.`];

  // L'ancora è un fotogramma solo, e le sovrimpressioni compaiono e
  // scompaiono lungo tutta la clip: ripulire il primo fotogramma non
  // ripulisce il resto. La richiesta va rifatta al modello video.
  const clean = cleanupClause(cleanup);
  if (clean) parts.push(clean);

  parts.push(
    'Keep the motion, the timing, the camera framing, the camera movement and everything not shown as changed exactly as in the source video' +
      (clean ? ', except for the overlays described above, which must be gone for the whole duration.' : '.')
  );
  return parts.join(' ');
}

module.exports = {
  LEVELS,
  TARGETS,
  CLEANUP,
  level,
  target,
  catalog,
  cleanupClause,
  plan,
  buildEditPrompt,
  buildAnchorPrompt,
};
