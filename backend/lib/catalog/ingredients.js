// Dieta, allergeni ed esclusioni letti dagli ingredienti, nel codice.
// Il tag dieta non lo decide l'IA: una ricetta "vegan" con il miele
// davanti a un vegano è l'errore più grave che il ricettario possa fare.

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Un ingrediente che si dichiara vegetale non va più controllato.
const PLANT_MARKER = /\b(vegan|plant ?based|plant-based|dairy ?free|dairy-free|non ?dairy|non-dairy|vegetarian|meatless|meat ?free|egg ?free|eggless|fishless|mock|faux)\b/;

// Parole che contengono un termine animale senza esserlo.
const FALSE_FRIENDS = [
  'peanut butter', 'almond butter', 'cashew butter', 'nut butter', 'seed butter', 'sunflower butter',
  'sesame butter', 'cocoa butter', 'shea butter', 'apple butter', 'coconut butter',
  'butter bean', 'butter beans', 'butternut', 'butterhead', 'butter lettuce',
  'eggplant', 'eggplants', 'egg replacer', 'flax egg', 'flax eggs', 'chia egg', 'chia eggs',
  'oyster mushroom', 'oyster mushrooms', 'king oyster', 'king oyster mushroom', 'mushroom oyster sauce',
  'coconut milk', 'coconut cream', 'coconut yogurt', 'coconut yoghurt', 'oat milk', 'soy milk', 'soya milk',
  'almond milk', 'rice milk', 'cashew milk', 'oat cream', 'soy cream', 'cashew cream', 'soy yogurt',
  'soy yoghurt', 'almond yogurt', 'oat yogurt', 'cashew cheese', 'nut cheese', 'cashew ricotta',
  'tofu ricotta', 'almond ricotta', 'tofu feta', 'cashew parmesan', 'almond parmesan', 'cashew mozzarella',
  'nutritional yeast', 'cream of tartar', 'bean curd', 'milk thistle', 'jackfruit', 'banana blossom',
  'heart of palm', 'hearts of palm', 'cream crackers', 'ice cream bean',
];

const ANIMAL = {
  meat: [
    'chicken', 'beef', 'pork', 'lamb', 'mutton', 'veal', 'goat', 'turkey', 'duck', 'goose', 'rabbit',
    'bacon', 'pancetta', 'guanciale', 'prosciutto', 'ham', 'salami', 'chorizo', 'sausage', 'sausages',
    'lard', 'gelatin', 'gelatine', 'bone broth', 'meat', 'minced meat', 'ground beef', 'ground pork',
    'steak', 'liver', 'suet', 'speck', 'mortadella', 'pepperoni', 'nduja', 'lardo', 'oxtail', 'tripe',
    'beef stock', 'chicken stock', 'chicken broth', 'beef broth', 'pork belly', 'brisket', 'venison',
  ],
  fish: [
    'fish', 'salmon', 'tuna', 'cod', 'salt cod', 'anchovy', 'anchovies', 'sardine', 'sardines', 'mackerel',
    'trout', 'tilapia', 'halibut', 'sea bass', 'snapper', 'haddock', 'swordfish', 'bonito', 'katsuobushi',
    'fish sauce', 'eel', 'catfish', 'herring', 'pollock', 'monkfish', 'bream', 'sea bream', 'hake',
    'roe', 'caviar', 'mentaiko', 'tobiko', 'branzino', 'worcestershire sauce', 'dried shrimp',
    'fish stock', 'bottarga', 'colatura', 'mahi mahi', 'barramundi', 'grouper', 'perch', 'pike',
  ],
  shellfish: [
    'shrimp', 'shrimps', 'prawn', 'prawns', 'crab', 'lobster', 'clam', 'clams', 'mussel', 'mussels',
    'oyster', 'oysters', 'oyster sauce', 'scallop', 'scallops', 'squid', 'octopus', 'calamari',
    'crawfish', 'crayfish', 'langoustine', 'langoustines', 'shrimp paste', 'cuttlefish', 'sea urchin',
    'cockle', 'cockles', 'abalone', 'arselle', 'vongole',
  ],
  dairy: [
    'milk', 'whole milk', 'butter', 'cheese', 'cream', 'heavy cream', 'yogurt', 'yoghurt', 'ghee',
    'paneer', 'ricotta', 'mozzarella', 'parmesan', 'parmigiano', 'pecorino', 'feta', 'halloumi',
    'mascarpone', 'buttermilk', 'kefir', 'whey', 'creme fraiche', 'labneh', 'burrata', 'gruyere',
    'cheddar', 'gorgonzola', 'provolone', 'queso', 'cotija', 'sour cream', 'half-and-half', 'custard',
    'mizithra', 'kefalotyri', 'manchego', 'emmental', 'fontina', 'taleggio', 'stracchino', 'scamorza',
    'caciocavallo', 'quark', 'skyr', 'condensed milk', 'evaporated milk', 'khoa', 'khoya', 'malai',
    'queso fresco', 'oaxaca cheese', 'goat cheese', 'blue cheese', 'stilton', 'roquefort', 'brie',
    'camembert', 'graviera', 'kasseri', 'anari', 'halloumi cheese', 'curd', 'curds', 'dahi',
  ],
  eggs: ['egg', 'eggs', 'egg yolk', 'egg yolks', 'egg white', 'egg whites', 'mayonnaise', 'mayo', 'meringue', 'egg noodles', 'egg noodle'],
  honey: ['honey'],
};

function termRegex(terms) {
  const sorted = [...terms].sort((a, b) => b.length - a.length).map((t) => t.replace(/[-]/g, '[- ]?'));
  return new RegExp(`\\b(${sorted.join('|')})\\b`);
}

const ANIMAL_RE = Object.fromEntries(Object.entries(ANIMAL).map(([k, v]) => [k, termRegex(v)]));

function stripFalseFriends(text) {
  let out = ` ${text} `;
  for (const phrase of FALSE_FRIENDS) {
    out = out.split(` ${phrase} `).join(' ');
    out = out.split(` ${phrase}`).join(' ');
  }
  return out.trim();
}

/** Categorie animali presenti in un testo di ingrediente. */
function animalCategories(text) {
  const n = normalize(text);
  if (!n || PLANT_MARKER.test(n)) return [];
  const cleaned = stripFalseFriends(n);
  return Object.entries(ANIMAL_RE).filter(([, re]) => re.test(cleaned)).map(([k]) => k);
}

const DIET_RANK = { vegan: 0, vegetarian: 1, pescatarian: 2, meat: 3 };

/** La dieta più restrittiva che una ricetta rispetta, dai suoi ingredienti. */
function dietOf(ingredients) {
  let rank = 0;
  for (const ing of ingredients || []) {
    for (const cat of animalCategories(`${ing.name || ''} ${ing.key || ''}`)) {
      const r = cat === 'meat' ? 3 : cat === 'fish' || cat === 'shellfish' ? 2 : 1;
      rank = Math.max(rank, r);
    }
  }
  return Object.keys(DIET_RANK).find((k) => DIET_RANK[k] === rank);
}

/** Diete dell'utente → tipi di ricetta che può ricevere. */
function allowedDiets(userDiet) {
  if (userDiet === 'vegetarian') return ['vegan', 'vegetarian'];
  if (userDiet === 'pescatarian' || userDiet === 'reducer') return ['vegan', 'vegetarian', 'pescatarian'];
  return ['vegan'];
}

/** I profili vecchi "reducer" non si offrono più: si trattano da pescetariani. */
function userDietOf(profile = {}) {
  const d = profile.dietaryIdentity;
  if (d === 'vegetarian' || d === 'pescatarian') return d;
  if (d === 'reducer') return 'pescatarian';
  return 'vegan';
}

// ---------------------------------------------------------------------------
// Allergeni ed esclusioni
// ---------------------------------------------------------------------------

const ALLERGENS = ['gluten', 'soy', 'tree_nuts', 'peanuts', 'sesame', 'corn', 'coconut', 'dairy', 'eggs', 'fish', 'shellfish', 'mustard', 'celery'];

const GLUTEN_TERMS = [
  'wheat', 'flour', 'all-purpose flour', 'bread flour', 'pasta', 'spaghetti', 'penne', 'rigatoni', 'fusilli',
  'linguine', 'fettuccine', 'tagliatelle', 'lasagna', 'lasagne', 'macaroni', 'orzo', 'ditalini', 'orecchiette',
  'gnocchi', 'couscous', 'bulgur', 'freekeh', 'barley', 'rye', 'farro', 'spelt', 'semolina', 'bread', 'breadcrumbs',
  'panko', 'pita', 'flatbread', 'tortilla flour', 'flour tortilla', 'naan', 'roti', 'chapati', 'seitan', 'udon',
  'ramen', 'ramen noodles', 'soba', 'wheat noodles', 'noodles', 'soy sauce', 'shoyu', 'phyllo', 'filo', 'puff pastry',
  'pastry', 'dough', 'baguette', 'bun', 'buns', 'crackers', 'beer', 'malt', 'vital wheat gluten', 'gluten', 'trahana',
  'pici', 'pizza dough', 'wonton wrappers', 'dumpling wrappers', 'gyoza wrappers', 'fregola', 'tteok',
];
const SOY_TERMS = [
  'soy', 'soya', 'soybean', 'soybeans', 'tofu', 'tempeh', 'edamame', 'miso', 'soy sauce', 'tamari', 'shoyu',
  'soy milk', 'yuba', 'natto', 'doenjang', 'gochujang', 'tvp', 'textured vegetable protein', 'soy curls',
  'bean curd', 'doubanjiang', 'hoisin', 'black bean sauce', 'fermented black beans', 'tofu skin', 'aburaage',
];
const TREE_NUT_TERMS = [
  'almond', 'almonds', 'cashew', 'cashews', 'walnut', 'walnuts', 'pecan', 'pecans', 'pistachio', 'pistachios',
  'hazelnut', 'hazelnuts', 'macadamia', 'pine nut', 'pine nuts', 'pignoli', 'brazil nut', 'brazil nuts',
  'almond milk', 'cashew cream', 'nut butter', 'marzipan', 'praline',
];
const CORN_TERMS = ['corn', 'maize', 'polenta', 'cornmeal', 'cornstarch', 'corn starch', 'cornflour', 'masa', 'masa harina', 'corn tortilla', 'corn tortillas', 'tortilla chips', 'grits', 'hominy', 'popcorn', 'elote', 'tostada', 'tostadas', 'sweetcorn'];
const SESAME_TERMS = ['sesame', 'sesame oil', 'sesame seeds', 'tahini', 'gomasio', 'za\'atar', 'zaatar', 'furikake'];
const CHILI_TERMS = [
  'chili', 'chilies', 'chile', 'chiles', 'chilli', 'chillies', 'jalapeno', 'jalapenos', 'serrano', 'habanero',
  'cayenne', 'chili flakes', 'red pepper flakes', 'gochugaru', 'gochujang', 'sriracha', 'harissa', 'chipotle',
  'sambal', 'chili oil', 'bird\'s eye', 'thai chili', 'aleppo pepper', 'urfa', 'guajillo', 'ancho', 'arbol',
  'pasilla', 'peperoncino', 'kashmiri chili', 'scotch bonnet', 'doubanjiang', 'chili paste', 'curry paste',
  'piri piri', 'nduja', 'szechuan pepper', 'sichuan pepper', 'paprika hot', 'hot sauce',
];
const MUSHROOM_TERMS = ['mushroom', 'mushrooms', 'shiitake', 'porcini', 'cremini', 'portobello', 'chanterelle', 'chanterelles', 'enoki', 'maitake', 'oyster mushroom', 'oyster mushrooms', 'king oyster', 'wood ear', 'morel', 'morels', 'button mushroom', 'champignon', 'shimeji', 'nameko', 'mushroom oyster sauce'];
const SEAWEED_TERMS = ['seaweed', 'nori', 'kombu', 'wakame', 'kelp', 'dulse', 'hijiki', 'laver', 'gim', 'miyeok', 'arame', 'sea lettuce', 'aonori', 'furikake', 'dashi'];

/** Voci del quiz (già minuscole) → parole chiave e allergeni. */
const EXCLUSION_MAP = {
  garlic: { terms: ['garlic', 'garlic powder', 'black garlic'] },
  onion: { terms: ['onion', 'onions', 'shallot', 'shallots', 'scallion', 'scallions', 'spring onion', 'spring onions', 'green onion', 'green onions', 'onion powder'] },
  cilantro: { terms: ['cilantro', 'fresh coriander', 'coriander leaves', 'coriander leaf'] },
  'chili heat': { terms: CHILI_TERMS },
  chili: { terms: CHILI_TERMS },
  spicy: { terms: CHILI_TERMS },
  artichokes: { terms: ['artichoke', 'artichokes', 'artichoke hearts'] },
  mushrooms: { terms: MUSHROOM_TERMS },
  olives: { terms: ['olive', 'olives', 'tapenade', 'kalamata'], except: ['olive oil'] },
  eggplant: { terms: ['eggplant', 'eggplants', 'aubergine', 'aubergines', 'brinjal', 'baingan'] },
  seaweed: { terms: SEAWEED_TERMS },
  'blue cheese': { terms: ['blue cheese', 'gorgonzola', 'roquefort', 'stilton', 'dolcelatte'] },
  tofu: { terms: ['tofu', 'bean curd', 'yuba', 'tofu skin', 'aburaage'] },
  coconut: { terms: ['coconut', 'coconut milk', 'coconut cream', 'coconut oil'], allergens: ['coconut'] },
  beets: { terms: ['beet', 'beets', 'beetroot', 'beetroots'] },
  peanuts: { terms: ['peanut', 'peanuts', 'peanut butter', 'groundnut'], allergens: ['peanuts'] },
  pickles: { terms: ['pickle', 'pickles', 'pickled', 'gherkin', 'gherkins', 'cornichon', 'cornichons'] },
  gluten: { terms: GLUTEN_TERMS, allergens: ['gluten'] },
  soy: { terms: SOY_TERMS, allergens: ['soy'] },
  nuts: { terms: TREE_NUT_TERMS, allergens: ['tree_nuts'] },
  'tree nuts': { terms: TREE_NUT_TERMS, allergens: ['tree_nuts'] },
  sesame: { terms: SESAME_TERMS, allergens: ['sesame'] },
  dairy: { terms: ANIMAL.dairy, allergens: ['dairy'], animal: 'dairy' },
  shellfish: { terms: ANIMAL.shellfish, allergens: ['shellfish'], animal: 'shellfish' },
  fish: { terms: ANIMAL.fish, allergens: ['fish'], animal: 'fish' },
  eggs: { terms: ANIMAL.eggs, allergens: ['eggs'], animal: 'eggs' },
  egg: { terms: ANIMAL.eggs, allergens: ['eggs'], animal: 'eggs' },
  corn: { terms: CORN_TERMS, allergens: ['corn'] },
  mustard: { terms: ['mustard', 'mustard seeds', 'dijon'], allergens: ['mustard'] },
  celery: { terms: ['celery', 'celeriac'], allergens: ['celery'] },
};

function singular(word) {
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('es') && /(ch|sh|x|o)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Le esclusioni del profilo trasformate in regole controllabili.
 * `translated` = mappa termine libero → parole inglesi (vedi terms.js).
 */
function buildExclusionRules(exclusions = [], translated = {}) {
  const rules = [];
  for (const raw of exclusions) {
    const label = normalize(raw);
    if (!label) continue;
    const mapped = EXCLUSION_MAP[label] || EXCLUSION_MAP[singular(label)] || EXCLUSION_MAP[`${label}s`];
    if (mapped) {
      rules.push({ label, terms: mapped.terms, except: mapped.except || [], allergens: mapped.allergens || [], animal: mapped.animal || null });
      continue;
    }
    const english = (translated[label] || []).map(normalize).filter(Boolean);
    const terms = [...new Set([label, singular(label), ...english, ...english.map(singular)])];
    const extra = english.map((e) => EXCLUSION_MAP[e] || EXCLUSION_MAP[singular(e)]).filter(Boolean);
    rules.push({
      label,
      terms: [...terms, ...extra.flatMap((m) => m.terms)],
      except: extra.flatMap((m) => m.except || []),
      allergens: extra.flatMap((m) => m.allergens || []),
      animal: (extra.find((m) => m.animal) || {}).animal || null,
    });
  }
  return rules.map((r) => ({ ...r, re: termRegex(r.terms.map(normalize)) }));
}

/** Prima regola violata da un insieme di testi e allergeni, o null. */
function violation(rules, texts, allergens = []) {
  if (!rules.length) return null;
  const pieces = texts.map(normalize).filter(Boolean);
  for (const rule of rules) {
    if (rule.allergens.some((a) => allergens.includes(a))) return rule.label;
    for (const piece of pieces) {
      let text = piece;
      for (const ex of rule.except) text = text.split(normalize(ex)).join(' ');
      if (rule.animal && PLANT_MARKER.test(text)) continue;
      if (rule.animal) text = stripFalseFriends(text);
      if (rule.re.test(text)) return rule.label;
    }
  }
  return null;
}

/** Allergeni deducibili dai nomi, da unire a quelli dichiarati dall'IA. */
function inferAllergens(ingredients) {
  const found = new Set();
  const checks = [
    ['gluten', termRegex(GLUTEN_TERMS)],
    ['soy', termRegex(SOY_TERMS)],
    ['tree_nuts', termRegex(TREE_NUT_TERMS)],
    ['peanuts', termRegex(['peanut', 'peanuts', 'peanut butter', 'groundnut'])],
    ['sesame', termRegex(SESAME_TERMS)],
    ['corn', termRegex(CORN_TERMS)],
    ['coconut', termRegex(['coconut', 'coconut milk', 'coconut cream', 'coconut oil'])],
  ];
  for (const ing of ingredients || []) {
    const text = normalize(`${ing.name || ''} ${ing.key || ''}`);
    for (const [allergen, re] of checks) {
      if (allergen === 'gluten' && /\b(gluten[- ]free|rice noodles|rice paper|glass noodles|tamari)\b/.test(text)) continue;
      if (re.test(text)) found.add(allergen);
    }
    for (const cat of animalCategories(text)) {
      if (cat === 'dairy') found.add('dairy');
      if (cat === 'eggs') found.add('eggs');
      if (cat === 'fish') found.add('fish');
      if (cat === 'shellfish') found.add('shellfish');
    }
  }
  return [...found];
}

module.exports = {
  normalize,
  animalCategories,
  dietOf,
  allowedDiets,
  userDietOf,
  buildExclusionRules,
  violation,
  inferAllergens,
  ALLERGENS,
  DIET_RANK,
  EXCLUSION_MAP,
};
