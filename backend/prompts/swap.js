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

function buildExtractionPrompt({ sourceType, caption, text, profile }) {
  const lines = [
    'You are a precise recipe transcriber.',
    'Reconstruct the recipe FAITHFULLY as shown — do NOT modify, substitute or improve anything yet.',
  ];
  if (sourceType === 'video') {
    lines.push('You receive a cooking video from social media. Watch it and transcribe the recipe.');
    if (caption) lines.push(`The post caption (may contain the ingredient list): """${caption.slice(0, 2000)}"""`);
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

function buildFinalizePrompt(profile, originalRecipe, chosenSubstitutes, goal = defaultGoal(profile)) {
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
  properties: { imagePrompt: { type: 'STRING', description: IMAGE_PROMPT_SCHEMA } },
  required: ['imagePrompt'],
};

/** La foto che sostituisce il fotogramma del video: la ricetta resta quella. */
function buildCoverPrompt(recipe) {
  const brief = {
    title: recipe.title,
    ingredients: (recipe.ingredients || []).map((i) => i.name),
    steps: recipe.steps || [],
  };
  return [
    'You brief a photo generator for the cover of a recipe someone saved from social media.',
    'The video frame they had is a random, unappetising still: this photo replaces it.',
    `Recipe: ${JSON.stringify(brief)}`,
    '',
    photoBrief('This is the cover that makes someone stop scrolling: the most irresistible honest version of THIS exact dish, nothing added.'),
    'imagePrompt is ALWAYS in English.',
  ].join('\n');
}

module.exports = {
  buildExtractionPrompt, extractionSchema,
  buildLedgerPrompt, ledgerSchema,
  buildFinalizePrompt, finalizeSchema,
  buildCoverPrompt, coverSchema,
  GOALS, defaultGoal,
};
