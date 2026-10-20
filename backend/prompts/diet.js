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
  'English, 40-70 words, for a photo generator: THIS dish exactly as the steps produce it, ' +
  'following the PHOTO BRIEF. Only things that are in the photo. Internal.';

/**
 * Brief foto identico per grocery e per lo swap (TikTok / social / link).
 * Lo stile della fotocamera lo aggiunge fal; qui si decide solo COSA c'è nel piatto.
 * Le regole per tipo di piatto le applica Gemini: il modello foto non legge
 * condizioni, quindi non devono mai finire nello style prompt.
 * @param {string} [extra]  riga in più (es. "mostra i sostituti, mai gli ingredienti animali")
 */
function photoBrief(extra) {
  const lines = [
    'PHOTO BRIEF (imagePrompt): the most realistic AND mouth-watering version of this dish, freshly served,',
    'as a good home cook would plate it. You write for an image model that draws every word literally,',
    'ignores negation ("no pasta" draws pasta) and does not understand conditions. So you decide, it only draws.',
    '',
    'HOW TO WRITE IT',
    '- Start with the dish and its vessel, then the main component, then the rest. Most important things first.',
    '- Describe ONLY what is in the photo. Never name anything that is absent, not even to exclude it.',
    '- Use the name of the food as it looks on the plate, not the shopping-list name: "tomato sauce", not',
    '  "canned peeled tomatoes"; but keep names that tell foods apart: "cherry tomatoes", never "cherries".',
    '- Give each component its real colour, shape, size and texture: "tiny pine nuts", "thin garlic slices",',
    '  "smooth bright-red tomato sauce". Avoid words that suggest another food: "chunky" or "rich" on a tomato',
    '  sauce draws meat ragù; "broth" on a pan sauce draws soup.',
    '- One plate or bowl, one serving. Only ingredients from the recipe. Never any animal product for a vegan profile.',
    '- "steaming" only for a dish served hot; never for cold or room-temperature food.',
    '- 40-70 words, English, plain sentences, no camera or style words (the app adds those).',
    '',
    'WHAT EACH KIND OF DISH LOOKS LIKE (use only the one that matches this recipe)',
    '- Pasta: name the exact shape once. The sauce coats the pasta and is the colour the steps make it',
    '  (an olive-oil pan sauce makes the pasta glossy; a tomato sauce is smooth and bright red). Loose, low in the plate.',
    '- Risotto: creamy and loose, gently spreading across a flat plate, grains bound in a velvety sauce, never dry or separate.',
    '- Asian noodles: describe the noodle by its look ("wide flat translucent rice noodles", "thin yellow egg noodles"),',
    '  never just "noodles" or "spaghetti". Stir-fried noodles are glossy and tossed with their toppings, with no liquid.',
    '- Soup or velvety soup: the surface and its colour, the garnish on top. Stew or curry: the sauce consistency and',
    '  the pieces in it; rice or bread beside it only if the recipe serves it.',
    '- Salad: crisp, fresh, raw cuts with their real shapes; dressing as a light sheen, never a puddle.',
    '- Burger or sandwich: side view of the stack, every layer named in order from bottom to top.',
    '- Eggs: the yolk as the steps leave it (runny, jammy, set) and the whites.',
    '- Dessert: the real colour of every part ("dark chocolate-brown molten centre"), the garnish, the plate.',
    '- Bowl (poke, grain bowl): each component in its own section over the base.',
    '- Baked or stuffed dishes: the golden or crisp top and what the filling looks like inside.',
    '- Anything served in its pan or pot by the recipe (shakshuka, paella) is shown in it.',
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
