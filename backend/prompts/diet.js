// Il dietary profile come parametro di sistema (§7 del blueprint):
// ogni prompt riceve queste regole, mai un "vegan" hardcodato.
// Valori: 'omnivore' | 'vegan' | 'vegetarian' | 'pescatarian' | 'reducer'

const RULES = {
  omnivore: {
    label: 'omnivore (no dietary restrictions)',
    rules:
      'NO DIETARY RESTRICTIONS: meat, poultry, fish, seafood, dairy, eggs and honey are all welcome. Cook every dish the way it is really made — never swap in plant-based substitutes unless asked.',
    swapVerb: 'Save it',
  },
  vegan: {
    label: 'vegan',
    rules:
      'STRICTLY VEGAN: no meat, no fish, no dairy, no eggs, no honey, no gelatin, no animal-derived ingredients of any kind.',
    swapVerb: 'Make it vegan',
  },
  vegetarian: {
    label: 'vegetarian',
    rules:
      'VEGETARIAN: no meat, no fish, no gelatin or other slaughter by-products. Dairy, eggs and honey are allowed.',
    swapVerb: 'Remove the meat',
  },
  pescatarian: {
    label: 'pescatarian',
    rules:
      'PESCATARIAN: no meat or poultry. Fish and seafood are allowed, as are dairy, eggs and honey.',
    swapVerb: 'Remove the meat',
  },
  reducer: {
    label: 'meat reducer',
    rules:
      'FLEXITARIAN (reducing meat): strongly prefer fully plant-based dishes; small amounts of meat or fish are acceptable only when clearly worth it. Aim for at least 80% of suggestions to be fully plant-based.',
    swapVerb: 'Make it plant-forward',
  },
};

/**
 * profile: {
 *   dietaryIdentity: 'omnivore'|'vegan'|'vegetarian'|'pescatarian'|'reducer',
 *   exclusions: [string],        // allergie e ingredienti odiati (dal quiz)
 *   cuisineAffinities: [string], // dal taste quiz
 *   spiceTolerance: 'mild'|'medium'|'hot',
 *   effortTolerance: 'quick'|'balanced'|'elaborate',
 * }
 */
/** Lingue supportate per le risposte (la UI dell'app resta inglese). */
const LANGUAGES = {
  en: 'English (US)',
  it: 'Italian',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
};

function responseLanguage(profile = {}) {
  return LANGUAGES[profile.language] || LANGUAGES.en;
}

function resolveUnits(profile = {}) {
  if (profile.units === 'metric' || profile.units === 'us') return profile.units;
  return profile.language && profile.language !== 'en' ? 'metric' : 'us';
}

function resolveCurrency(profile = {}) {
  if (profile.currency === 'USD' || profile.currency === 'EUR' || profile.currency === 'GBP') {
    return profile.currency;
  }
  return profile.language && profile.language !== 'en' ? 'EUR' : 'USD';
}

function currencySymbol(profile = {}) {
  return { USD: '$', EUR: '€', GBP: '£' }[resolveCurrency(profile)] || '$';
}

function dietSection(profile = {}) {
  const identity = RULES[profile.dietaryIdentity] || RULES.omnivore;
  const lines = [
    `DIETARY PROFILE (non-negotiable system parameter): the user is ${identity.label}.`,
    identity.rules,
    `RESPONSE LANGUAGE: write ALL user-facing text (titles, descriptions, steps, rationales,`,
    `ingredient names, quantities' units as customary) in ${responseLanguage(profile)}.`,
    'JSON field names, enum values (storeSection) and imagePrompt stay in English regardless.',
    ...localeLines(profile),
  ];
  if (Array.isArray(profile.exclusions) && profile.exclusions.length) {
    lines.push(
      `HARD EXCLUSIONS (allergies or strong dislikes — NEVER include, not even as garnish): ${profile.exclusions.join(', ')}.`
    );
  }
  if (profile.spiceTolerance) lines.push(`Spice tolerance: ${profile.spiceTolerance}.`);
  if (profile.effortTolerance) lines.push(`Cooking effort tolerance: ${profile.effortTolerance}.`);
  // Una ricetta che l'utente non può cucinare è una ricetta sprecata:
  // l'attrezzatura è un vincolo, non una preferenza.
  if (Array.isArray(profile.appliances) && profile.appliances.length) {
    const equipment = profile.appliances.map((a) => String(a).replace(/_/g, ' ')).join(', ');
    lines.push(
      `KITCHEN EQUIPMENT (hard constraint): the user can only cook with ${equipment}.`,
      'Every recipe and every step must be doable with exactly that equipment. Never require an appliance',
      'not on the list — no baking without an oven, no blending without a blender, and so on.'
    );
  }
  const taste = tasteHintsSection(profile);
  if (taste) lines.push('', taste);
  return lines.join('\n');
}

/**
 * Il quiz di onboarding (12 piatti "quali ami" + 12 "quali non
 * prenderesti") NON è una lista di piatti permessi e vietati: è uno
 * schizzo del palato. Molti lo compilano di corsa, quindi va letto
 * come indizio su formati, consistenze e assi di gusto — mai come
 * regola, e mai per decidere la cucina di un piatto.
 */
function tasteHintsSection(profile = {}) {
  const loved = profile.lovedDishes || profile.likedDishes;
  const hasLoved = Array.isArray(loved) && loved.length;
  const hasDisliked = Array.isArray(profile.dislikedDishes) && profile.dislikedDishes.length;
  const hasCuisines = Array.isArray(profile.cuisineAffinities) && profile.cuisineAffinities.length;
  if (!hasLoved && !hasDisliked && !hasCuisines) return '';

  const lines = [
    'TASTE SKETCH (soft signal — read it like a person, never like a rulebook):',
    'During onboarding the user was shown famous dishes from many cuisines and tapped a few.',
    'People often rush this step, so treat it as a rough sketch of their palate, NOT as a list of allowed or banned dishes.',
    'Use it to infer FORMATS (noodles, salads, stews, bakes, handheld...), TEXTURES (creamy, crunchy, brothy, crispy)',
    'and FLAVOUR AXES (fresh/briny, rich/cheesy, spicy, herby, sweet-savory) they probably enjoy — then translate',
    'those into whatever cuisine is being cooked. Example: loving noodles and Greek salad means a pasta dish and a',
    'crunchy briny salad will land well in ANY cuisine; it does not mean "serve noodles".',
  ];
  if (hasLoved) {
    lines.push(`- Tapped as "love": ${loved.join(', ')}.`);
  }
  if (hasDisliked) {
    lines.push(
      `- Tapped as "wouldn't pick": ${profile.dislikedDishes.join(', ')}.`,
      '  Read this as a MILD lean away from that dish\'s dominant trait, nothing more. Skipping "mushroom pho" means',
      '  don\'t build the plan around brothy mushroom soups — it does NOT mean "never a soup again". One skipped dish',
      '  never bans a whole category, ingredient or cuisine.'
    );
  }
  if (hasCuisines) {
    lines.push(
      `- Cuisines their loved dishes came from: ${profile.cuisineAffinities.join(', ')}.`,
      '  Only a tie-breaker when no cuisine was explicitly requested. It never overrides an explicit request.'
    );
  }
  lines.push(
    'The sketch NEVER decides the nationality of a dish: cuisine comes from the explicit request of the session',
    '(craving / scanned menu / recipe being adapted), the sketch only helps choose WHICH dishes within it.'
  );
  return lines.join('\n');
}

function localeLines(profile = {}) {
  const units = resolveUnits(profile);
  const currency = resolveCurrency(profile);
  const symbol = currencySymbol(profile);
  if (units === 'metric') {
    return [
      'MEASUREMENTS: metric only — g, kg, ml, L, °C. No cups, ounces, pounds or °F.',
      `CURRENCY: every cost number (the costUsd field included) is in ${currency} (${symbol}). Never write USD or $.`,
    ];
  }
  return [
    'MEASUREMENTS: US customary — cups, tbsp, oz, lb, °F. Grams only if the package is sold that way.',
    `CURRENCY: every cost number (the costUsd field included) is in ${currency} (${symbol}).`,
  ];
}

function swapVerb(profile = {}) {
  return (RULES[profile.dietaryIdentity] || RULES.omnivore).swapVerb;
}

/** Chi mangia di tutto: niente sostituti vegetali di default. */
function eatsEverything(profile = {}) {
  return profile.dietaryIdentity === 'omnivore';
}

/** Descrizione schema di imagePrompt — grocery e swap devono coincidere. */
const IMAGE_PROMPT_SCHEMA =
  'English, 40-70 words, for a photo generator. Describe the FINISHED dish exactly as the steps produce it: ' +
  'the visible ingredients (only ones in the recipe), their cooked state (charred edges, glossy sauce, melted, crisp, steaming), ' +
  'one single serving on one plate or bowl, neatly plated, and any garnish that is actually in the recipe. ' +
  'Pasta and noodles rest low and loose in the dish, never a tall standing nest, never lifted. ' +
  'Make it look irresistible but never add food that is not in the recipe. Internal.';

/**
 * Brief foto identico per grocery e per lo swap (TikTok / social / link).
 * Lo stile della fotocamera lo aggiunge fal; qui si decide solo COSA c'è nel piatto.
 * @param {string} [extra]  riga in più (es. "mostra i sostituti, mai gli ingredienti animali")
 */
function photoBrief(extra) {
  const lines = [
    'PHOTO BRIEF (imagePrompt): the photo must be faithful to the recipe AND make people hungry.',
    '- Describe the finished dish exactly as the last step leaves it: which ingredients are visible, how they look cooked',
    '  (blistered, glossy, caramelised, melted, crisp, steaming), the sauce, the plating.',
    '- ONE plate or bowl with ONE serving, whatever the recipe yields: never two plates, never the pot or the pan.',
    '- Plated with care like in a good restaurant: every component recognisable, clear shapes, contrasting',
    '  colours, sauce placed rather than flooded. Never a shapeless pile, a beige mush or a messy stew filling the bowl.',
    '- Pasta and noodles rest low and loose in the plate or bowl, as if just served: never twisted into a tall standing',
    '  nest or lifted in the air. Nothing is held, lifted or picked up.',
    '- Only ingredients from the ingredient list may appear. No extra garnish, no side dishes, no drinks, no herbs that',
    '  are not in the recipe, and never any animal product for a vegan profile.',
    '- Write it as a hungry food photographer would: specific textures and colours, a hero detail (a drip of sauce,',
    '  a torn piece showing the inside, a glossy sauce clinging to the noodles). 40-70 words, English, no camera/style instructions',
    '  (the app adds those).',
  ];
  if (extra) lines.push(`- ${extra}`);
  return lines.join('\n');
}

/** Sezioni del supermercato usate in tutta l'app (enum condiviso con iOS). */
const STORE_SECTIONS = [
  'produce',
  'grains_pasta',
  'proteins',
  'dairy_alternatives',
  'canned_jarred',
  'spices_condiments',
  'nuts_seeds',
  'bakery',
  'frozen',
  'other',
];

module.exports = {
  dietSection,
  tasteHintsSection,
  photoBrief,
  IMAGE_PROMPT_SCHEMA,
  swapVerb,
  eatsEverything,
  responseLanguage,
  resolveUnits,
  resolveCurrency,
  currencySymbol,
  STORE_SECTIONS,
  RULES,
};
