// Swap engine (§6): estrazione della ricetta da video/screenshot/testo,
// ledger originale→sostituti, e riscrittura finale "Make it mine".
// L'estrazione dipende dal profilo solo per la lingua (la cache è per
// URL + lingua); il ledger e la riscrittura sono personalizzati.
//
// Il ledger serve un obiettivo: una dieta (vegana, vegetariana, senza
// carne) oppure un ritocco (più proteine, più leggera, senza glutine,
// più economica). I ritocchi rispettano comunque la dieta del profilo.
const { dietSection, swapVerb, responseLanguage, STORE_SECTIONS, photoBrief, IMAGE_PROMPT_SCHEMA } = require('./diet');

const DIET_GOALS = {
  vegan: { verb: 'Make it vegan', title: 'Vegan Carbonara' },
  vegetarian: { verb: 'Make it vegetarian', title: 'Vegetarian Lasagna' },
  pescatarian: { verb: 'Remove the meat', title: 'Seafood Paella' },
};

const TWEAK_GOALS = {
  protein: {
    verb: 'Make it high-protein',
    title: 'High-Protein Carbonara',
    aim: 'Raise the protein substantially — aim for at least 30 g per serving — while keeping the dish recognisable and just as craveable.',
    keep: 'it already pulls its weight, or changing it would not add meaningful protein',
    ideas: 'a leaner or bigger protein, legume or protein pasta, Greek yogurt or cottage cheese in creamy sauces, eggs, beans folded in',
    rationale: '"+14 g protein", "creamy, twice the protein"',
  },
  light: {
    verb: 'Make it lighter',
    title: 'Lighter Carbonara',
    aim: 'Cut calories and heavy fats substantially — aim for about a third fewer calories per serving — without making it taste like diet food.',
    keep: 'it is already light, or it carries the flavour of the dish',
    ideas: 'Greek yogurt for cream, less oil with smarter technique, leaner cuts, more vegetables in the base, oven instead of deep-frying',
    rationale: '"half the fat", "same crunch, no frying"',
  },
  glutenFree: {
    verb: 'Make it gluten-free',
    title: 'Gluten-Free Carbonara',
    aim: 'Remove EVERY source of gluten. Be rigorous about hidden gluten: wheat flour, pasta, bread and breadcrumbs, couscous, bulgur, barley, rye, spelt, regular soy sauce, beer, many stock cubes.',
    keep: 'it is naturally gluten-free',
    ideas: 'gluten-free pasta or rice noodles, tamari for soy sauce, cornstarch or rice flour for thickening, polenta or gluten-free crumbs',
    rationale: '"tamari, same umami", "rice flour keeps it crisp"',
  },
  cheaper: {
    verb: 'Make it cheaper',
    title: 'Budget Carbonara',
    aim: 'Cut the cost of the dish substantially while keeping it delicious and filling.',
    keep: 'it is already cheap, or it is the soul of the dish',
    ideas: 'cheaper cuts or proteins, pantry staples, frozen vegetables, store-brand cheese, dried herbs for fresh ones',
    rationale: '"half the price", "same depth for less"',
  },
};

const GOALS = [...Object.keys(DIET_GOALS), ...Object.keys(TWEAK_GOALS)];

/** L'obiettivo di default: la dieta di chi segue una dieta, nessuno per chi mangia tutto. */
function defaultGoal(profile = {}) {
  const diet = profile.dietaryIdentity;
  if (diet === 'omnivore') return null;
  if (diet === 'vegetarian' || diet === 'pescatarian') return diet;
  if (diet === 'reducer') return 'pescatarian';
  return 'vegan';
}

/** Con un obiettivo di dieta il profilo segue quella dieta, il resto non cambia. */
function profileFor(profile, goal) {
  return DIET_GOALS[goal] ? { ...profile, dietaryIdentity: goal } : profile;
}

function goalVerb(profile, goal) {
  return (DIET_GOALS[goal] || TWEAK_GOALS[goal] || { verb: swapVerb(profile) }).verb;
}

const ingredientItem = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    quantity: { type: 'STRING' },
    storeSection: { type: 'STRING', enum: STORE_SECTIONS },
    costUsd: { type: 'NUMBER' },
  },
  required: ['name', 'quantity', 'storeSection', 'costUsd'],
};

// ---------- Fase 1: estrazione (cacheable per URL + lingua) ----------

const extractionSchema = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN', description: 'false if the content contains no recipe' },
    recipe: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        servings: { type: 'NUMBER' },
        cookMinutes: { type: 'NUMBER' },
        ingredients: { type: 'ARRAY', items: ingredientItem },
        steps: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['title', 'servings', 'cookMinutes', 'ingredients', 'steps'],
    },
  },
  required: ['found'],
};

// Solo per i video: in più, il video diviso in passaggi. Facoltativo,
// così una divisione mancata non costa la ricetta.
const segmentItem = {
  type: 'OBJECT',
  properties: {
    start: { type: 'NUMBER', description: 'Second of the video where this phase starts' },
    end: { type: 'NUMBER', description: 'Second of the video where this phase ends' },
    title: { type: 'STRING', description: '2-5 words naming the action, e.g. "Brown the onion"' },
    steps: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '0-based indexes into recipe.steps shown in this phase' },
    ingredients: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '0-based indexes into recipe.ingredients used in this phase' },
  },
  required: ['start', 'end', 'title', 'steps', 'ingredients'],
};

const videoExtractionSchema = {
  ...extractionSchema,
  properties: {
    ...extractionSchema.properties,
    recipe: {
      ...extractionSchema.properties.recipe,
      properties: {
        ...extractionSchema.properties.recipe.properties,
        segments: { type: 'ARRAY', items: segmentItem },
      },
    },
  },
};

// Vista dinamica a richiesta, su una ricetta già letta (anche trasformata
// o modificata a mano): solo gli spezzoni, la ricetta non si tocca.
const segmentsSchema = {
  type: 'OBJECT',
  properties: { segments: { type: 'ARRAY', items: segmentItem } },
  required: ['segments'],
};

function buildSegmentsPrompt(recipe) {
  const steps = (recipe.steps || []).map((s, i) => `${i}. ${s}`).join('\n');
  const ingredients = (recipe.ingredients || []).map((g, i) => `${i}. ${g.name}${g.quantity ? ` (${g.quantity})` : ''}`).join('\n');
  return [
    'You receive a cooking video from social media and a recipe written from it.',
    'The recipe may have been adapted (some ingredients replaced, steps reworded): match each step to the moment',
    'of the video showing that action, even when the ingredient on screen is the original one.',
    '',
    `Steps:\n${steps}`,
    '',
    `Ingredients:\n${ingredients}`,
    '',
    'Split the video into segments: one per cooking phase the viewer would want to rewatch',
    '(chopping, browning, adding the sauce, plating...). Usually 3-8 segments, each at least 3 seconds.',
    'start/end are seconds of THIS video, in order, not overlapping; skip intros, talking heads and outros',
    'that show no cooking. For each segment list the 0-based indexes of the steps it shows and of the',
    'ingredients used in it. Every step should belong to exactly one segment when the video shows it.',
    'title = 2-5 words naming the action, in the same language as the steps.',
  ].join('\n');
}

function buildExtractionPrompt({ sourceType, caption, text, profile }) {
  const lines = [
    'You are a precise recipe transcriber.',
    'Reconstruct the recipe FAITHFULLY as shown — do NOT modify, substitute or improve anything yet.',
  ];
  if (sourceType === 'video') {
    lines.push('You receive a cooking video from social media. Watch it and transcribe the recipe.');
    if (caption) lines.push(`The post caption (may contain the ingredient list): """${caption.slice(0, 2000)}"""`);
    lines.push(
      'Also split the video into segments: one per cooking phase the viewer would want to rewatch',
      '(chopping, browning, adding the sauce, plating...). Usually 3-8 segments, each at least 3 seconds.',
      'start/end are seconds of THIS video, in order, not overlapping; skip intros, talking heads and outros',
      'that show no cooking. For each segment list the 0-based indexes of the recipe steps it shows and of',
      'the ingredients used in it. Every step should belong to exactly one segment when the video shows it.'
    );
  } else if (sourceType === 'post') {
    lines.push(
      'You receive a social media post whose video could not be loaded: only its caption and, when present, its cover image.',
      `The caption: """${(caption || '').slice(0, 4000)}"""`,
      'Use the caption as the main source and the cover only to recognise the dish.',
      'Return found=true only if the caption names the dish AND gives enough of the ingredients to cook it; a title and hashtags alone are NOT a recipe.'
    );
  } else if (sourceType === 'screenshot') {
    lines.push('You receive a screenshot containing a recipe. Read it and transcribe the recipe.');
  } else {
    lines.push(`You receive pasted text containing a recipe: """${(text || '').slice(0, 6000)}"""`);
  }
  const language = responseLanguage(profile);
  lines.push(
    'Estimate quantities when not stated. Estimate realistic US grocery cost per ingredient.',
    'If there is NO recipe in the content, return found=false.',
    // "Fedele" vale per il contenuto, non per la lingua: il video può
    // essere in coreano, ma chi legge ha scelto la sua lingua nell'app e
    // un titolo che non capisce è una ricetta che non ritroverà più.
    `RESPONSE LANGUAGE: write ALL user-facing text (title, ingredient names,`,
    `quantities, steps) in ${language}, TRANSLATING from whatever language the`,
    `source uses. This is mandatory even when the source is in another language.`,
    `Keep proper names of dishes recognizable, but render everything else in ${language}.`,
    'JSON field names and enum values (storeSection) stay in English regardless.'
  );
  return lines.join('\n');
}

// ---------- Fase 2: ledger personalizzato ----------

const ledgerSchema = {
  type: 'OBJECT',
  properties: {
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          originalName: { type: 'STRING', description: 'Ingredient name exactly as in the original recipe' },
          quantity: { type: 'STRING' },
          isCompatible: { type: 'BOOLEAN', description: 'true if the user can eat it as-is' },
          substitutes: {
            type: 'ARRAY',
            description: 'Empty when isCompatible. Otherwise 3-4 alternatives ranked best-first: chef-worthy swap first, store-bought "vegan X" analog last.',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING', description: 'Specific ingredient or preparation, e.g. "cashew cream", not "vegan cream"' },
                quantity: { type: 'STRING' },
                rationale: { type: 'STRING', description: 'Short phrase, 2-5 words, tied to this dish: "keeps the sauce silky"' },
                storeSection: { type: 'STRING', enum: STORE_SECTIONS },
                costUsd: { type: 'NUMBER' },
              },
              required: ['name', 'quantity', 'rationale', 'storeSection', 'costUsd'],
            },
          },
        },
        required: ['originalName', 'quantity', 'isCompatible', 'substitutes'],
      },
    },
  },
  required: ['lines'],
};

function buildLedgerPrompt(profile, recipe, goal = defaultGoal(profile)) {
  const tweak = TWEAK_GOALS[goal];
  if (tweak) return buildTweakLedgerPrompt(profile, recipe, tweak);
  return [
    "You are Cherry's swap engine: a creative plant-forward chef adapting ONE specific recipe.",
    '',
    dietSection(profileFor(profile, goal)),
    '',
    `Here is the original recipe as JSON: ${JSON.stringify(recipe)}`,
    '',
    'STEP 1 — Understand the dish. Read title, ingredients AND steps. For every non-compliant',
    'ingredient identify what it actually does HERE: fat, moisture, binding, structure,',
    'creaminess, umami, smoke, saltiness, crunch, rise, browning...',
    '',
    'STEP 2 — For EVERY ingredient set isCompatible for THIS user. Be rigorous about hidden',
    'animal ingredients (fish sauce, worcestershire, honey, gelatin, egg pasta, butter implied',
    'by the steps, parmesan "to finish"...). Do not silently wave them through.',
    '',
    'STEP 3 — For each incompatible ingredient propose 3-4 substitutes, RANKED:',
    '- FIRST: the swap a skilled plant-based chef would genuinely cook for THIS dish — specific',
    '  and interesting, built from real ingredients or technique (cashew cream, white miso +',
    '  olive oil, smoked shiitake, aquafaba, chickpea flour...), coherent with the cuisine and',
    '  the cooking method in the steps.',
    '- MIDDLE: solid alternatives with a different trade-off (cheaper, faster, milder, easier to find).',
    '- LAST, at most one: the store-bought "vegan X" analog (vegan butter, vegan cheese,',
    '  plant-based ground...). NEVER rank a commercial analog first: it is the lazy fallback,',
    '  not the recommendation.',
    '',
    "Every substitute must preserve the ingredient's function in this dish and state the",
    'adjusted quantity. rationale = 2-5 words about why it works in THIS dish',
    '("keeps the sauce silky", "adds the smoky depth"). Never suggest anything from the exclusions.',
    'All user-facing text in the RESPONSE LANGUAGE defined above.',
  ].join('\n');
}

function buildTweakLedgerPrompt(profile, recipe, tweak) {
  return [
    "You are Cherry's swap engine: a skilled home chef adapting ONE specific recipe.",
    '',
    `GOAL: "${tweak.verb}". ${tweak.aim}`,
    '',
    dietSection(profile),
    '',
    `Here is the original recipe as JSON: ${JSON.stringify(recipe)}`,
    '',
    'STEP 1 — Understand the dish. Read title, ingredients AND steps, and find the few ingredients that decide',
    'whether this dish meets the goal.',
    '',
    `STEP 2 — For EVERY ingredient set isCompatible = true when it can stay as is (${tweak.keep}),`,
    'false when changing it clearly serves the goal. Change only what matters: a good adaptation touches the',
    'ingredients that move the needle, not every line.',
    '',
    'STEP 3 — For each ingredient to change propose 2-4 substitutes, RANKED best-first: the change a good cook',
    'would really make for THIS dish first, then alternatives with a different trade-off. A substitute may keep',
    `the original and add to it (e.g. "spinach + white beans"). Useful directions: ${tweak.ideas}.`,
    '',
    "Every substitute must keep the dish working (texture, flavour, cooking method) and state the adjusted",
    `quantity. rationale = 2-5 words about what it does for the goal in THIS dish (${tweak.rationale}).`,
    'Respect the dietary profile and never suggest anything from the exclusions.',
    'All user-facing text in the RESPONSE LANGUAGE defined above.',
  ].join('\n');
}

// ---------- Fase 3: riscrittura finale ----------

const finalizeSchema = {
  type: 'OBJECT',
  properties: {
    recipe: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Adapted title that says what changed, e.g. "Vegan Carbonara"' },
        oneLiner: { type: 'STRING' },
        cuisine: { type: 'STRING' },
        costUsd: { type: 'NUMBER' },
        cookMinutes: { type: 'NUMBER' },
        servings: { type: 'NUMBER' },
        ingredients: { type: 'ARRAY', items: ingredientItem },
        steps: { type: 'ARRAY', items: { type: 'STRING' } },
        imagePrompt: {
          type: 'STRING',
          description: IMAGE_PROMPT_SCHEMA,
        },
      },
      required: ['title', 'oneLiner', 'cuisine', 'costUsd', 'cookMinutes', 'servings', 'ingredients', 'steps', 'imagePrompt'],
    },
  },
  required: ['recipe'],
};

// Quando la ricetta viene da un video diviso in passaggi: la riscrittura
// dice dove cade ogni step e ingrediente nuovo, e il codice ridistribuisce
// la ricetta sugli stessi spezzoni del video originale.
const finalizeWithSegmentsSchema = {
  ...finalizeSchema,
  properties: {
    ...finalizeSchema.properties,
    segmentTitles: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'One title per video segment, same order, rewritten for the adapted recipe',
    },
    stepSegments: {
      type: 'ARRAY',
      items: { type: 'INTEGER' },
      description: 'One entry per step of the rewritten recipe: index of the video segment it belongs to, -1 if none',
    },
    ingredientOrigins: {
      type: 'ARRAY',
      items: { type: 'INTEGER' },
      description: 'One entry per ingredient of the rewritten recipe: 0-based index of the original ingredient it is or replaces, -1 if new',
    },
  },
  required: [...finalizeSchema.required, 'segmentTitles', 'stepSegments', 'ingredientOrigins'],
};

function segmentsBrief(segments) {
  const list = segments.map((s, i) => ({ segment: i, title: s.title, originalSteps: s.steps }));
  return [
    '',
    `The original recipe comes from a video split into segments (indexes into the original steps): ${JSON.stringify(list)}`,
    'The adapted recipe is shown over the SAME video segments. Fill segmentTitles (one per segment, describing the',
    'adapted action), stepSegments (one per rewritten step: the segment showing that moment) and ingredientOrigins',
    '(one per rewritten ingredient: index of the original ingredient it is or replaces, -1 if new).',
  ];
}

function buildFinalizePrompt(profile, originalRecipe, chosenSubstitutes, goal = defaultGoal(profile), { segments } = {}) {
  const tweak = TWEAK_GOALS[goal];
  const example = (DIET_GOALS[goal] || tweak || {}).title;
  return [
    `You are Cherry. Task: "${goalVerb(profile, goal)}" — rewrite the recipe around the substitutes the user chose.`,
    ...(tweak ? ['', `GOAL: ${tweak.aim}`] : []),
    '',
    dietSection(profileFor(profile, goal)),
    '',
    `Original recipe: ${JSON.stringify(originalRecipe)}`,
    `Chosen substitutions (original -> replacement): ${JSON.stringify(chosenSubstitutes)}`,
    '',
    'Rewrite the FULL recipe: apply every substitution, adjust the steps around the new',
    'ingredients (cooking times, techniques, order), keep everything else faithful.',
    tweak
      ? 'The result must meet the goal and comply with the dietary profile even if a substitution was missed.'
      : 'The result must comply with the dietary profile even if a substitution was missed.',
    example ? `The title says what changed, like "${example}".` : '',
    ...(segments && segments.length ? segmentsBrief(segments) : []),
    '',
    photoBrief(
      tweak
        ? 'This is the ADAPTED dish: show the substitutes in place.'
        : 'This is the ADAPTED dish: show the substitutes in place. Never depict the original animal ingredients.'
    ),
    'imagePrompt is ALWAYS in English. Everything else in the RESPONSE LANGUAGE defined above.',
  ].join('\n');
}

// ---------- Copertina di una ricetta importata ----------

const coverSchema = {
  type: 'OBJECT',
  properties: {
    imagePrompt: {
      type: 'STRING',
      description:
        'English, 40-70 words, for a photo generator. THIS exact dish, finished and plated: every visible component ' +
        'with its real shape, cut, colour and cooked texture, how it is assembled, the vessel it is served in, and one hero detail. ' +
        'Only ingredients that are in the recipe. Plain sentences, no camera or style instructions. Internal.',
    },
  },
  required: ['imagePrompt'],
};

/**
 * La copertina di una ricetta salvata dai social. Gemini guarda il
 * fotogramma del video, se c'è, per capire com'è fatto davvero il piatto,
 * e scrive l'imagePrompt su quella ricetta: un brief generico dava piatti
 * che col video non c'entravano niente.
 */
function buildCoverPrompt(recipe, { hasFrame }) {
  const brief = {
    title: recipe.title,
    ingredients: (recipe.ingredients || []).map((i) => `${i.quantity ? `${i.quantity} ` : ''}${i.name}`.trim()),
    steps: recipe.steps || [],
  };
  return [
    'You brief a photo generator for the cover of a recipe someone saved from a social media video.',
    'The cover they have is a random frame of that video: this photo replaces it, and must show the SAME dish.',
    `Recipe: ${JSON.stringify(brief)}`,
    '',
    hasFrame
      ? [
          'The attached image is that video frame. Use it as the truth about what this dish looks like: its components,',
          'shapes, cuts, colours, sauce, how it is assembled, what it is served in. Ignore everything that is not the food:',
          'captions, stickers, watermarks, hands, faces, the kitchen, motion blur, bad light. If the frame does not show the',
          'finished dish (a face, raw ingredients, a mid-step, a title card), rely on the recipe instead.',
        ].join('\n')
      : 'There is no frame: work out the finished dish from the recipe.',
    '',
    'Work out from the steps how it really looks at the end — a crumble has a rough golden top, a stew is chunky, a smash',
    'burger has crisp lacy edges — and describe THAT, concretely, so the generator cannot invent a different dish.',
    'Name each visible component with its real look (e.g. "thick slices of roasted aubergine with dark charred edges",',
    'not "vegetables"). Keep it simple and believable: a real home-cooked dish at its best, not a fantasy creation.',
    '',
    photoBrief('This is the cover that makes someone stop scrolling: the most irresistible honest version of THIS exact dish, nothing added.'),
    'imagePrompt is ALWAYS in English.',
  ].join('\n');
}

module.exports = {
  buildExtractionPrompt, extractionSchema, videoExtractionSchema,
  buildSegmentsPrompt, segmentsSchema,
  buildLedgerPrompt, ledgerSchema,
  buildFinalizePrompt, finalizeSchema, finalizeWithSegmentsSchema,
  buildCoverPrompt, coverSchema,
  GOALS, defaultGoal,
};
