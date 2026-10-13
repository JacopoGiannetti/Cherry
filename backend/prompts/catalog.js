// Prompt del ricettario condiviso. Le ricette si scrivono UNA volta, in
// inglese, per 2 persone, in metrico e in dollari: le scala e le traduce
// il codice per ogni utente. Il piatto non lo inventa l'IA, lo sceglie il
// codice dall'atlante; qui si chiede solo di scriverlo bene.
const { STORE_SECTIONS, photoBrief, IMAGE_PROMPT_SCHEMA } = require('./diet');
const { UNITS } = require('../lib/catalog/units');
const { ALLERGENS } = require('../lib/catalog/ingredients');

const APPLIANCES = ['stovetop', 'oven', 'microwave', 'freezer', 'blender', 'air_fryer', 'pressure_cooker', 'slow_cooker', 'food_processor', 'grill'];

const LANGUAGE_NAMES = { it: 'Italian', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese (Portugal)' };

const ingredientSchema = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: 'Plain English shopping name, lowercase, no prep notes: "canned chickpeas", "extra virgin olive oil", "fresh rosemary"' },
    amount: { type: 'NUMBER', description: 'Amount for 2 servings in `unit`. 0 only with unit "to_taste".' },
    unit: { type: 'STRING', enum: UNITS },
    storeSection: { type: 'STRING', enum: STORE_SECTIONS },
    costUsd: { type: 'NUMBER', description: 'US supermarket cost of the amount used (pantry staples prorated)' },
  },
  required: ['name', 'amount', 'unit', 'storeSection', 'costUsd'],
};

const recipeProperties = {
  title: { type: 'STRING', description: 'English name of the dish, max 6 words, no marketing adjectives. Never the cuisine\'s own language.' },
  oneLiner: { type: 'STRING', description: 'Plain description of what is on the plate, max 14 words, no hype' },
  cookMinutes: { type: 'NUMBER', description: 'Honest total time, prep included' },
  costUsd: { type: 'NUMBER', description: 'Sum of the ingredient costs' },
  ingredients: { type: 'ARRAY', items: ingredientSchema },
  steps: { type: 'ARRAY', items: { type: 'STRING' } },
  allergens: { type: 'ARRAY', items: { type: 'STRING', enum: ALLERGENS } },
  appliances: { type: 'ARRAY', items: { type: 'STRING', enum: APPLIANCES } },
  imagePrompt: { type: 'STRING', description: IMAGE_PROMPT_SCHEMA },
};
const recipeRequired = ['title', 'oneLiner', 'cookMinutes', 'costUsd', 'ingredients', 'steps', 'allergens', 'appliances', 'imagePrompt'];

const generateSchema = {
  type: 'OBJECT',
  properties: {
    recipes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { brief: { type: 'NUMBER', description: 'Number of the brief this recipe answers' }, ...recipeProperties },
        required: ['brief', ...recipeRequired],
      },
    },
  },
  required: ['recipes'],
};

const VERSION_RULES = {
  vegan: 'VEGAN version: no meat, fish, seafood, dairy, eggs, honey, gelatin, fish sauce, anchovy, worcestershire or any animal product. Follow the vegan approach in the brief; keep the dish recognisable.',
  vegetarian: 'VEGETARIAN version: no meat, fish, seafood, gelatin, anchovy, fish sauce or worcestershire. KEEP the dairy and eggs that make this dish what it is (the cheese, the butter, the eggs, the yogurt) — do not make it vegan.',
  pescatarian: 'PESCATARIAN version: no meat or poultry, no meat stock, no lard or bacon. The fish or seafood is the point of this dish — keep it (or use the closest fish/seafood if the original is meat). Dairy and eggs are fine where traditional.',
};

function briefLine(brief, index) {
  const d = brief.dish;
  const parts = [
    `BRIEF ${index + 1} — ${d.name}${d.nameEn && d.nameEn !== d.name ? ` (${d.nameEn})` : ''}, ${d.cuisine}${d.region ? `, ${d.region}` : ''}.`,
    `   ${VERSION_RULES[brief.diet]}`,
    `   Format: ${d.format.replace(/_/g, ' ')}. Traditional key ingredients: ${(d.keyIngredients || []).join(', ')}.`,
  ];
  if (brief.diet === 'vegan' && d.veganApproach) parts.push(`   Vegan approach: ${d.veganApproach}`);
  if (d.technique) parts.push(`   Technique: ${d.technique}`);
  parts.push(`   Typical time: ~${d.cookMinutes} min.`);
  return parts.join('\n');
}

/**
 * @param {object} opts
 * @param {Array}  opts.briefs       [{ dish (atlante), diet }]
 * @param {Array}  opts.basket       ricette già nel mazzo [{ title, ingredients: [nomi] }]
 * @param {object} opts.profile
 * @param {Array}  opts.rules        esclusioni (etichette)
 * @param {boolean} opts.sharing     condivisione ingredienti attiva
 * @param {string} opts.occasion
 * @param {Array}  opts.chips
 * @param {Array}  [opts.retryNotes] perché un tentativo precedente è stato scartato
 */
function buildGeneratePrompt({ briefs, basket = [], profile = {}, exclusions = [], sharing = true, occasion = 'everyday', chips = [], retryNotes = [], now = new Date() }) {
  const month = now.toLocaleString('en-US', { month: 'long' });
  const lines = [
    'You are the recipe writer of Vego, a cookbook of REAL dishes that home cooks trust.',
    `Write exactly ${briefs.length} recipe${briefs.length === 1 ? '' : 's'}, one per brief below. Each brief names a real, documented dish: write THAT dish, the way a good cook from that place would make it at home.`,
    '',
    'QUALITY BAR — these recipes go into a shared cookbook and are judged by real people:',
    '- Authentic: the ingredients, technique and flavour of the real dish. No fusion, no "healthy twist", no invented garnishes.',
    '- Cookable on the first try: exact amounts, heat levels, times AND visual cues ("until the onion is soft and golden, 8-10 minutes").',
    '- 5 to 9 steps, prep included (chopping, draining, boiling water). Each step is one clear block of action.',
    '- A real dinner for 2: generous main-course portions (about 550-750 kcal per serving), not a side dish.',
    '- Ingredients: every single thing used, including oil, salt and water if measured. No optional ingredients, no "or" choices.',
    '- Ordinary supermarket ingredients first. A specialty ingredient only when the dish needs it.',
    '',
    'NAMING:',
    '- title is ALWAYS English, the name an English cookbook uses: "Pasta and beans", "Chickpea pasta", "Eggplant parmesan".',
    '- A name English speakers do not translate can stay: "Pad thai", "Ramen", "Chana masala", "Mapo tofu".',
    '- Never write the title in the cuisine\'s language: not "Pasta e fagioli", not "Parmigiana di melanzane".',
    '- When the version changes the defining ingredient, say it plainly: "Mushroom bourguignon", "Vegan carbonara", "Tofu katsu curry".',
    '- No adjectives like creamy, ultimate, easy, cozy, best, perfect, loaded, dreamy. No emojis.',
    '- oneLiner = what is on the plate, plain words: "Short pasta and chickpeas in a rosemary and garlic broth."',
    '',
    'FORMAT (strict — the app scales and translates these recipes automatically):',
    '- English. Quantities for exactly 2 servings. Metric units only: g, ml, or tsp/tbsp for small amounts; piece, clove, can, bunch, pinch, slice, sprig, sheet, handful for counted things; to_taste with amount 0.',
    '- Cans: unit "can" means a standard 400 g / 400 ml can.',
    '- Costs in USD at a US supermarket.',
    '- In steps, NEVER write a number with a unit directly. Use tokens instead:',
    '  {{t:200}} = an oven or oil temperature in °C (write just the number);',
    '  {{l:2}} = a size in cm ("cut into {{l:2}} pieces");',
    '  {{q:150 ml}} = an amount of an ingredient used in a step, only when you split an ingredient between steps or for water/stock.',
    '  Otherwise just name the ingredient ("add the chickpeas"). Times in minutes are plain text ("8-10 minutes").',
    `- allergens: every allergen present (${ALLERGENS.join(', ')}). appliances: everything the recipe needs.`,
    '',
    `SEASON: it is ${month} in the Northern Hemisphere. Keep the dish as it is, but pick in-season vegetables where the dish allows a choice.`,
  ];

  const occasionLine = {
    hosting: 'OCCASION: hosting friends. Write it so it looks generous on the table.',
    date: 'OCCASION: date night at home. Careful plating, a finishing touch that belongs to the dish.',
    mealprep: 'OCCASION: meal prep. Mention how it keeps in the fridge in the last step.',
    protein: 'OCCASION: high protein. The beans, lentils, tofu, tempeh or seitan must be a generous, obvious part of the plate, about a third of the meal.',
    fresh: 'OCCASION: light and fresh. Keep it bright: herbs, crisp vegetables, a light sauce. No cream and no deep-frying as the main method.',
    quick: 'OCCASION: minimal effort. Shortcuts that real cooks use are fine (canned beans, ready stock); keep it under 30 minutes.',
    comfort: 'OCCASION: comfort food. Do not hold back on the richness the dish traditionally has.',
  }[occasion];
  if (occasionLine) lines.push(occasionLine);

  if (profile.spiceTolerance === 'mild') lines.push('SPICE: the user likes it mild — keep the heat gentle, even in dishes that are usually hot.');
  if (profile.spiceTolerance === 'hot') lines.push('SPICE: the user likes heat — use the full traditional heat.');

  if (exclusions.length) {
    lines.push(`HARD EXCLUSIONS (allergies or dislikes — never use them, not even as garnish or in a sauce): ${exclusions.join(', ')}.`);
  }
  if (Array.isArray(profile.appliances) && profile.appliances.length) {
    lines.push(`KITCHEN: the cook only has ${profile.appliances.map((a) => a.replace(/_/g, ' ')).join(', ')}. Every step must work with that.`);
  }

  const chipLines = {
    too_fancy: 'CORRECTION: the user found earlier dishes too fancy — keep these simple and humble.',
    weird_ingredients: 'CORRECTION: the user found the ingredients weird — only mainstream ingredients.',
  };
  for (const chip of chips) if (chipLines[chip]) lines.push(chipLines[chip]);

  if (basket.length) {
    lines.push('', 'ALREADY IN THIS DECK (other recipes the user is choosing from):');
    for (const r of basket) lines.push(`- ${r.title}: ${r.ingredients.slice(0, 10).join(', ')}`);
  }
  if (sharing) {
    lines.push(
      '',
      'SHARED SHOPPING: where it is natural for the dish, reuse ingredients from the deck above and across your recipes (the same herbs, the same can of coconut milk, the same block of tofu) so the shopping list overlaps.',
      'Never change a dish to force a share. Across the whole deck use at most 3 specialty ingredients (things a normal shopper does not already have).'
    );
  }

  if (retryNotes.length) {
    lines.push('', 'A PREVIOUS ATTEMPT WAS REJECTED — fix this:', ...retryNotes.map((n) => `- ${n}`));
  }

  lines.push('', 'BRIEFS:', ...briefs.map(briefLine), '', photoBrief());
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Critico: passa sopra ogni ricetta che entra in classifica.
// ---------------------------------------------------------------------------

const criticSchema = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING', enum: ['pass', 'fix', 'reject'] },
    score: { type: 'NUMBER', description: '1-10, how good and how authentic the recipe is' },
    issues: { type: 'ARRAY', items: { type: 'STRING' } },
    fixed: { type: 'OBJECT', properties: recipeProperties, required: recipeRequired },
  },
  required: ['verdict', 'score', 'issues'],
};

function buildCriticPrompt({ recipe, dish, diet }) {
  return [
    'You are the strict editor of a cookbook of real dishes. A recipe is about to be published to every user.',
    `It must be ${dish ? `a faithful ${diet} version of ${dish.name} (${dish.cuisine})` : `a real ${diet} dish`}.`,
    dish ? `Reference: format ${dish.format}; traditional key ingredients ${(dish.keyIngredients || []).join(', ')}.${dish.veganApproach && diet === 'vegan' ? ` Vegan approach: ${dish.veganApproach}` : ''}` : '',
    '',
    'Check, in this order:',
    `1. Diet: is it truly ${diet}? (${VERSION_RULES[diet]})`,
    '2. Authenticity: would a cook from that place recognise the dish? Wrong technique, wrong key ingredient, invented fusion = problem.',
    '3. Cookability: amounts for 2 servings that make sense together, every ingredient used in the steps and every step ingredient listed, heat/time/visual cues, honest total time.',
    '4. Portion: a real dinner for 2, not a side dish.',
    '5. Naming: real dish name, no marketing adjectives; plain oneLiner.',
    '6. Format: English, metric units, tokens {{t:°C}}, {{l:cm}}, {{q:amount unit}} instead of numbers with units in steps; costs in USD.',
    '',
    'verdict: "pass" if it is ready as is; "fix" if the problems are fixable — then return the COMPLETE corrected recipe in `fixed` (same format); "reject" if it is not this dish or not salvageable.',
    'issues: short notes, empty when it passes.',
    '',
    'RECIPE:',
    JSON.stringify(recipe, null, 1),
  ].filter((l) => l !== null).join('\n');
}

// ---------------------------------------------------------------------------
// Traduzione: una volta per ricetta e lingua, poi resta in cache.
// ---------------------------------------------------------------------------

const translateSchema = {
  type: 'OBJECT',
  properties: {
    recipes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          title: { type: 'STRING' },
          oneLiner: { type: 'STRING' },
          cuisine: { type: 'STRING' },
          ingredients: { type: 'ARRAY', items: { type: 'STRING' } },
          steps: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['id', 'title', 'oneLiner', 'cuisine', 'ingredients', 'steps'],
      },
    },
  },
  required: ['recipes'],
};

function buildTranslatePrompt(lang, entries) {
  const language = LANGUAGE_NAMES[lang] || lang;
  return [
    `Translate these recipes into ${language}, the way a good cookbook from that country would write them.`,
    '- title: the name cooks in that country actually use. Into Italian, "Pasta e fagioli", not "Pasta and beans". Into English, keep the English title. Names nobody translates stay as they are ("Pad thai", "Ramen").',
    '- ingredients: the name a shopper would look for in a supermarket in that country, lowercase, no quantities. Same order, same number of items.',
    '- steps: same number of steps, same order. Copy every {{...}} token EXACTLY as it is, untouched, in the right place of the sentence.',
    '- cuisine: the cuisine name in that language.',
    '- Keep the id.',
    '',
    JSON.stringify(entries.map((e) => ({
      id: e.id,
      title: e.recipe.title,
      oneLiner: e.recipe.oneLiner,
      cuisine: e.cuisine,
      ingredients: e.recipe.ingredients.map((i) => i.name),
      steps: e.recipe.steps,
    }))),
  ].join('\n');
}

// Esclusioni scritte a mano dall'utente, in qualunque lingua → parole inglesi.
const termsSchema = {
  type: 'OBJECT',
  properties: {
    terms: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          input: { type: 'STRING' },
          english: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['input', 'english'],
      },
    },
  },
  required: ['terms'],
};

function buildTermsPrompt(inputs) {
  return [
    'Each input is an ingredient (or food group) a user cannot or will not eat, written in any language.',
    'For each, list the English ingredient names that would appear in a recipe containing it: the word itself, plurals,',
    'common varieties and products made from it (e.g. "peperoni" → bell pepper, bell peppers, red pepper, roasted peppers).',
    'Lowercase. Do not add unrelated foods. Keep the input exactly as given.',
    '',
    JSON.stringify(inputs),
  ].join('\n');
}

module.exports = {
  APPLIANCES,
  generateSchema,
  buildGeneratePrompt,
  criticSchema,
  buildCriticPrompt,
  translateSchema,
  buildTranslatePrompt,
  termsSchema,
  buildTermsPrompt,
};
