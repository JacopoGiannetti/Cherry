// Menu scan (§5.1): la risposta è "cosa ordino?", non un menu decorato.
// Solo buone notizie: best bets (verdi) e ask-for-these (gialle con la
// frase pronta per il cameriere). Il resto del menu non appare.
// Ogni piatto porta anche una stima dei valori e se è vegano: l'app
// riordina la lista (leggero, proteico, low-carb, vegano) senza
// rifare la scansione.
const { dietSection, eatsEverything } = require('./diet');

const box = {
  type: 'OBJECT',
  description: 'Approximate location of the dish name in the photo, normalized 0-1',
  properties: {
    x: { type: 'NUMBER' }, y: { type: 'NUMBER' },
    w: { type: 'NUMBER' }, h: { type: 'NUMBER' },
  },
  required: ['x', 'y', 'w', 'h'],
};

const estimates = {
  kcal: { type: 'NUMBER', description: 'Estimated kcal for one restaurant portion' },
  proteinG: { type: 'NUMBER', description: 'Estimated grams of protein for one portion' },
  carbsG: { type: 'NUMBER', description: 'Estimated grams of carbohydrates for one portion' },
  vegan: {
    type: 'STRING',
    enum: ['yes', 'ask', 'no'],
    description: 'yes = vegan as written; ask = vegan with ONE simple request; no = not realistically',
  },
  veganPhrase: { type: 'STRING', description: 'Only when vegan is "ask": the ready-to-say request that makes it vegan' },
};

const menuScanSchema = {
  type: 'OBJECT',
  properties: {
    restaurantName: { type: 'STRING', description: 'If visible on the menu, else empty' },
    bestBets: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          dishName: { type: 'STRING', description: 'Exactly as written on the menu' },
          description: { type: 'STRING', description: 'Max 10 words, why it is good' },
          priceText: { type: 'STRING', description: 'Price as printed, or empty' },
          photoIndex: { type: 'NUMBER', description: '0-based index of the photo containing the dish' },
          box,
          ...estimates,
        },
        required: ['dishName', 'description', 'photoIndex', 'box', 'kcal', 'proteinG', 'carbsG', 'vegan'],
      },
    },
    askForThese: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          dishName: { type: 'STRING' },
          waiterPhrase: {
            type: 'STRING',
            description: 'Ready-to-say sentence, e.g. "Margherita — ask for no mozzarella, add mushrooms"',
          },
          priceText: { type: 'STRING' },
          photoIndex: { type: 'NUMBER' },
          box,
          ...estimates,
        },
        required: ['dishName', 'waiterPhrase', 'photoIndex', 'box', 'kcal', 'proteinG', 'carbsG', 'vegan'],
      },
    },
  },
  required: ['bestBets', 'askForThese'],
};

function buildMenuScanPrompt(profile, photoCount) {
  const omnivore = eatsEverything(profile);
  return [
    'You are Cherry, helping someone order at a restaurant RIGHT NOW, with the waiter approaching.',
    `You receive ${photoCount} photo(s) of a menu (multiple pages of the SAME menu — merge them).`,
    '',
    dietSection(profile),
    '',
    'Answer the only question that matters: WHAT DO I ORDER?',
    '- bestBets: dishes already compatible with the profile as written on the menu.',
    '  Order them by how much THIS user will enjoy them, using the taste profile above:',
    '  a dish close to what they love goes first, a dish close to what they reject goes last or not at all.',
    '- askForThese: dishes ONE simple modification away, each with a ready-to-say waiter phrase.',
    ...(omnivore
      ? [
        '  With no dietary restrictions, modifications are only needed for the hard exclusions above.',
        'List up to 24 dishes across both arrays, skipping drinks and plain sides.',
      ]
      : []),
    'Only include dishes you can actually see on the menu. Never invent dishes.',
    'Do NOT list incompatible dishes at all — only good news.',
    'If genuinely nothing fits, return empty arrays.',
    'For every dish, report which photo it appears in (photoIndex, 0-based) and the approximate',
    'normalized bounding box of the dish name on that photo.',
    '',
    'For every dish also estimate, for ONE restaurant portion as it would be served (after the requested',
    'modification, if any): kcal, proteinG and carbsG. Restaurant portions are generous and cooked with',
    'oil and butter — estimate honestly, do not lowball. Round kcal to the nearest 10.',
    'And mark whether it is vegan: "yes" as written, "ask" with one simple request (then give veganPhrase,',
    'ready to say), or "no".',
    '',
    'All user-facing text in the RESPONSE LANGUAGE defined above. Keep descriptions extremely short.',
  ].join('\n');
}

module.exports = { buildMenuScanPrompt, menuScanSchema };
