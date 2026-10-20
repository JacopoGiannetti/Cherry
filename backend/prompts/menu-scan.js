// Menu scan (§5.1): la risposta è "cosa ordino?", non un menu decorato.
// Solo buone notizie: best bets (verdi) e ask-for-these (gialle con la
// frase pronta per il cameriere). Il resto del menu non appare.
// Ogni piatto porta anche una stima dei valori e se è vegano: l'app
// riordina la lista (leggero, proteico, low-carb, vegano) senza
// rifare la scansione.
const { dietSection, eatsEverything } = require('./diet');

// Il formato con cui Gemini localizza davvero: [ymin, xmin, ymax, xmax]
// in 0-1000. L'app vuole {x, y, w, h} in 0-1: converte `toAppBox`.
const box_2d = {
  type: 'ARRAY',
  items: { type: 'INTEGER' },
  description:
    'Bounding box of the dish NAME text only on its photo, as [ymin, xmin, ymax, xmax] normalized to 0-1000. ' +
    'Tight around the printed name of THIS dish: not its description, not its price, never another dish.',
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
          box_2d,
          ...estimates,
        },
        required: ['dishName', 'description', 'photoIndex', 'box_2d', 'kcal', 'proteinG', 'carbsG', 'vegan'],
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
          box_2d,
          ...estimates,
        },
        required: ['dishName', 'waiterPhrase', 'photoIndex', 'box_2d', 'kcal', 'proteinG', 'carbsG', 'vegan'],
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
    'READ THE WHOLE MENU FIRST. Go through every photo, every section and every line, top to bottom, column by column,',
    'including small print, side columns, boxed specials and dishes written in another language. Do not stop after',
    'the first sections: a dish you skipped is a dish the user never sees. Then decide.',
    '',
    'Answer the only question that matters: WHAT DO I ORDER?',
    '- bestBets: dishes already compatible with the profile as written on the menu.',
    '  Order them by how much THIS user will enjoy them, using the taste profile above:',
    '  a dish close to what they love goes first, a dish close to what they reject goes last or not at all.',
    '- askForThese: dishes ONE simple modification away, each with a ready-to-say waiter phrase.',
    ...(omnivore
      ? [
        '  With no dietary restrictions, modifications are only needed for the hard exclusions above.',
        '  Skip drinks and plain sides.',
      ]
      : []),
    'Only include dishes you can actually see on the menu. Never invent dishes.',
    'Do NOT list incompatible dishes at all — only good news.',
    'If genuinely nothing fits, return empty arrays.',
    'Include EVERY dish that fits, not a selection.',
    'For every dish, report which photo it appears in (photoIndex, 0-based) and box_2d: the box of its NAME on that',
    'photo, [ymin, xmin, ymax, xmax] in 0-1000. The box hugs the printed name only — usually one line, as wide as the',
    'words and as tall as the letters. Small print gets a small box. It never covers the description, the price or a',
    'neighbouring dish; two dishes never share a box.',
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

/** box_2d di Gemini → il box {x, y, w, h} in 0-1 che legge l'app. null se non è un box valido. */
function toAppBox(box2d) {
  if (!Array.isArray(box2d) || box2d.length !== 4 || !box2d.every(Number.isFinite)) return null;
  const clamp = (v) => Math.min(1, Math.max(0, v / 1000));
  const [y0, x0, y1, x1] = box2d.map(clamp);
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/** Il piatto come lo salva Firestore: `box` nel formato dell'app, senza `box_2d`. */
function toAppDish({ box_2d: box2d, ...dish }) {
  const box = toAppBox(box2d);
  return box ? { ...dish, box } : dish;
}

module.exports = { buildMenuScanPrompt, menuScanSchema, toAppDish };
