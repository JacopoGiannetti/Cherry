// Prompt e schema per la generazione batch delle ricette del Grocery Run.
// Regola §10.4: ogni batch porta con sé tutto il contesto — profilo,
// keeps/passes della run, budget residuo, chip di correzione.
const { dietSection, STORE_SECTIONS, resolveUnits, currencySymbol, resolveCurrency, photoBrief, IMAGE_PROMPT_SCHEMA, eatsEverything } = require('./diet');

const recipeSchema = {
  type: 'OBJECT',
  properties: {
    recipes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING', description: 'Appetizing dish name, max 5 words' },
          oneLiner: { type: 'STRING', description: 'One tempting sentence, max 12 words' },
          cuisine: { type: 'STRING' },
          costUsd: { type: 'NUMBER', description: 'Realistic US grocery cost for the whole recipe' },
          cookMinutes: { type: 'NUMBER' },
          servings: { type: 'NUMBER', description: 'Must equal the requested household size' },
          ingredients: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                quantity: { type: 'STRING', description: 'e.g. "200 g", "2 tbsp"' },
                storeSection: { type: 'STRING', enum: STORE_SECTIONS },
                costUsd: { type: 'NUMBER' },
              },
              required: ['name', 'quantity', 'storeSection', 'costUsd'],
            },
          },
          steps: { type: 'ARRAY', items: { type: 'STRING' } },
          imagePrompt: {
            type: 'STRING',
            description: IMAGE_PROMPT_SCHEMA,
          },
        },
        required: ['title', 'oneLiner', 'cuisine', 'costUsd', 'cookMinutes', 'servings', 'ingredients', 'steps', 'imagePrompt'],
      },
    },
  },
  required: ['recipes'],
};

/**
 * @param {object} opts
 * @param {object} opts.profile        taste profile utente
 * @param {Array}  opts.cravings       cucine scelte al Beat 1 (vuoto = libero)
 * @param {number} opts.budgetUsd      budget totale della run
 * @param {number} opts.remainingUsd   budget residuo
 * @param {number} opts.servings       per quante persone si cucina
 * @param {number} opts.count          quante ricette generare
 * @param {Array}  opts.keeps          titoli già tenuti (con ingredienti principali)
 * @param {Array}  opts.passes         titoli scartati
 * @param {Array}  opts.exclude        titoli da non ripetere
 * @param {Array}  opts.correctionChips  'too_fancy' | 'weird_ingredients' | 'not_my_taste'
 * @param {Array}  opts.history        ultimi verdetti swipe, anche di run passate
 * @param {Date}   [opts.now]          data corrente (per la stagionalità)
 */
function buildRecipesPrompt(opts) {
  const {
    profile, cravings = [], budgetUsd, remainingUsd, count, servings = 2,
    keeps = [], passes = [], exclude = [], correctionChips = [], history = [],
    adventure = 2, occasion = 'everyday', now = new Date(),
  } = opts;

  // Il costo per ricetta scala con le porzioni: 2 persone ≈ $6-14.
  const lowCost = Math.round(3 * servings);
  const highCost = Math.round(7 * servings);

  // La cucina la decide SOLO il craving. Il quiz e lo storico servono a
  // scegliere quali piatti di quella cucina, non a cambiarla.
  const cravingLine = (() => {
    if (!cravings.length) {
      return [
        'CUISINE: the user asked to be surprised — no cuisine was requested.',
        'Vary cuisines freely; the taste sketch and taste history are your best guide to what will land.',
      ].join(' ');
    }
    if (cravings.length === 1) {
      return [
        `CUISINE (explicit request, overrides everything else about cuisine): the user is craving ${cravings[0]}.`,
        `EVERY recipe must be a genuine ${cravings[0]} dish. Variety comes from WITHIN that cuisine — different formats`,
        '(pasta/noodles vs salads vs stews vs bakes vs street food), regions, textures — never from switching cuisine.',
        'Do not sneak in dishes from other cuisines because the taste sketch or history mentions them: translate those',
        `signals into their ${cravings[0]} equivalents instead.`,
      ].join(' ');
    }
    return [
      `CUISINE (explicit request, overrides everything else about cuisine): the user picked ${cravings.join(', ')}.`,
      'Every recipe must belong to one of those cuisines. Spread the batch across ALL of them — roughly balanced,',
      'no cuisine left with a single token dish — while still making the recipes share ingredients across cuisine lines.',
      'Never add a cuisine that was not requested.',
    ].join(' ');
  })();

  // Slider comfort/sperimentale scelto insieme al budget (1–3).
  // "Avventura" si muove dentro la cucina richiesta, non fuori.
  const scope = cravings.length ? 'within the requested cuisine(s)' : 'across cuisines';
  const adventureLine = {
    1: `ADVENTUROUSNESS 1/3 (comfort mode): ONLY safe bets ${scope}. The well-known classics everyone recognises, close to the formats and flavors this user has shown they enjoy. No unusual ingredients, zero experiments.`,
    2: `ADVENTUROUSNESS 2/3 (balanced): mostly recognisable dishes ${scope} that fit what this user enjoys, plus 1-2 less obvious dishes ${scope} that still share flavors with what they like.`,
    3: `ADVENTUROUSNESS 3/3 (surprise me): the user explicitly asked to explore ${scope}. Go for regional, lesser-known or bolder dishes they have probably never cooked — while still respecting hard exclusions.`,
  }[adventure] || '';

  // Stagionalità: niente zuppe pesanti ad agosto, niente gazpacho a dicembre.
  // Si assume emisfero nord (utenti US/EU); è un orientamento, non un divieto.
  const month = now.toLocaleString('en-US', { month: 'long' });
  const seasonLine = [
    `SEASON: it is ${month} (assume Northern Hemisphere).`,
    'Favour produce in season and dish formats that make sense right now: no heavy stews, hot soups or baked comfort',
    'casseroles as the core of a summer batch; no watermelon salads, gazpacho or cold noodle bowls in deep winter.',
    'This is a lean, not a ban — a light soup in summer or a fresh salad in winter is fine when the dish calls for it.',
  ].join(' ');

  // La vibe scelta nel wizard: che tipo di spesa è questa.
  const omnivore = eatsEverything(profile);
  const occasionLine = {
    everyday: 'OCCASION: regular weeknight home cooking. Comforting, practical dinners that fit real life.',
    hosting: omnivore
      ? 'OCCASION: the user is hosting friends. Favor crowd-pleasers and shareable dishes that scale well and look generous on the table.'
      : 'OCCASION: the user is hosting friends. Favor crowd-pleasers and shareable dishes that scale well, look generous on the table, and impress non-vegan guests.',
    date: 'OCCASION: a date night at home. Favor slightly elevated, beautiful-to-plate dishes with a special feel — this is not weekday food.',
    mealprep: 'OCCASION: meal prep for the week. Favor recipes that keep and reheat well, batch-cook nicely, and share overlapping ingredients to minimize waste.',
    protein: omnivore
      ? 'OCCASION: high protein. Every dish needs a generous, obvious protein portion — chicken, beef, fish, eggs, Greek yogurt or legumes — about a third of the plate.'
      : 'OCCASION: high protein. Every dish needs a generous, obvious portion of beans, lentils, tofu, tempeh or seitan — about a third of the plate.',
    fresh: 'OCCASION: light and fresh. Bright dishes: herbs, crisp vegetables, a light sauce. No cream and no deep-frying as the main method.',
    quick: 'OCCASION: the user wants minimal effort. Every recipe should take under 25 minutes with few steps and little cleanup.',
    comfort: omnivore
      ? 'OCCASION: comfort food mode. Rich, cozy, indulgent dishes — what people crave on a couch evening.'
      : 'OCCASION: comfort food mode. Rich, cozy, indulgent dishes — the plant-based versions of what people crave on a couch evening.',
  }[occasion] || '';

  const symbol = currencySymbol(profile);
  const currency = resolveCurrency(profile);
  const market = resolveUnits(profile) === 'metric' ? 'European supermarket' : 'US supermarket';
  const lines = [
    omnivore ? 'You are Vego, a meal planner and home cook.' : 'You are Vego, a plant-forward meal planner and home cook.',
    'Generate COMPLETE, realistic, genuinely delicious recipes for a grocery shopping run.',
    `These are real dinners people crave — not "health bowls". Use common ${market} ingredients.`,
    '',
    dietSection(profile),
    '',
    cravingLine,
    '',
    adventureLine,
    '',
    occasionLine,
    '',
    seasonLine,
    '',
    `HOUSEHOLD: every recipe must serve exactly ${servings} ${servings === 1 ? 'person' : 'people'}.`,
    `Set "servings" to ${servings} and scale ingredient quantities accordingly — quantities and costs are for ${servings} ${servings === 1 ? 'serving' : 'servings'}, not per person.`,
    '',
    `BUDGET GAME: total run budget is ${symbol}${budgetUsd}. Remaining budget: ${symbol}${remainingUsd}.`,
    `Generate exactly ${count} recipes. Individual recipe costs should mostly sit between ${symbol}${lowCost} and ${symbol}${highCost} so several recipes fit the remaining budget. Estimate costs realistically in ${currency}.`,
    '',
    'INTERLOCKING RULE (the core of Vego): recipes must be DESIGNED TO SHARE INGREDIENTS,',
    omnivore
      ? 'especially the expensive or unusual ones (a pack of chicken thighs, parmesan, tahini, miso...).'
      : 'especially the expensive or unusual ones (tahini, tempeh, nutritional yeast, miso...).',
    'A specialty ingredient must appear in at least 2 recipes of the batch or not at all.',
  ];

  // Gusti dimostrati: cosa questo utente ha davvero tenuto e scartato,
  // anche in run precedenti (ultimi ~35 verdetti). Un "kept" pesa molto:
  // ha scelto quel piatto con soldi veri. Un "passed" pesa poco: in un
  // deck si scarta anche per budget, umore, o perché ne aveva già tre.
  const loved = history.filter((entry) => entry.verdict === 'kept');
  const rejected = history.filter((entry) => entry.verdict === 'passed');
  if (loved.length || rejected.length) {
    lines.push('', 'TASTE HISTORY — what THIS user actually did in past grocery runs (demonstrated taste, stronger than the quiz sketch).');
    if (loved.length) {
      const described = loved
        .slice(0, 20)
        .map((entry) => {
          const cuisine = entry.cuisine ? ` [${entry.cuisine}]` : '';
          const mains = entry.mains.length ? ` — ${entry.mains.slice(0, 3).join(', ')}` : '';
          return `${entry.title}${cuisine}${mains}`;
        })
        .join(' | ');
      lines.push(
        `KEPT (strong signal — they committed to cooking these): ${described}`,
        'Infer what they enjoy: formats, hero ingredients, comfort vs fresh, effort level, how bold. Reuse those patterns.'
      );
    }
    if (rejected.length) {
      lines.push(
        `PASSED (weak signal — a swipe-away can mean budget, mood, or "already have three of these"): ${rejected.slice(0, 20).map((entry) => entry.title).join(', ')}`,
        'Only act on it when several passed dishes clearly share a trait (e.g. three creamy curries passed → ease off',
        'creamy curries). A single pass never bans a format, ingredient or cuisine.'
      );
    }
    lines.push(
      'The cuisine tags in the history describe what was on offer back then; they do NOT change the cuisine requested',
      'in this session. Never reuse those exact titles.'
    );
  }

  if (keeps.length) {
    lines.push(
      '',
      `RECIPES ALREADY IN THE BASKET (create new recipes that reuse their ingredients): ${keeps.join(' | ')}`
    );
  }
  if (passes.length) {
    lines.push(`Recipes the user swiped away IN THIS RUN (don't offer near-duplicates of these; other dishes of the same format are fine): ${passes.join(', ')}`);
  }
  if (exclude.length) {
    lines.push(`Do NOT repeat these titles or close variants: ${exclude.join(', ')}`);
  }

  const chipInstructions = {
    too_fancy: 'CORRECTION — the user said "too fancy": simpler everyday dishes, fewer steps, humble ingredients.',
    weird_ingredients: `CORRECTION — the user said "weird ingredients": only mainstream ingredients any ${market} carries.`,
    not_my_taste: 'CORRECTION — the user said "not my taste": change direction within the requested cuisine — different formats, textures and flavor axes, closer to what their taste sketch and KEPT history suggest.',
  };
  for (const chip of correctionChips) {
    if (chipInstructions[chip]) lines.push('', chipInstructions[chip]);
  }

  lines.push(
    '',
    photoBrief(),
    '',
    'Every recipe must include ALL fields. Steps are complete and cookable (6-10 steps).',
    'imagePrompt is ALWAYS in English. Everything else in the RESPONSE LANGUAGE defined above.'
  );

  return lines.join('\n');
}

module.exports = { buildRecipesPrompt, recipeSchema };
