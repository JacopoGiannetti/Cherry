// Fusione di due liste della spesa (run multiple, §4): l'AI unifica
// gli ingredienti uguali o quasi-uguali ("red onion" + "onions"),
// sommando le quantità in modo sensato. checked e recipeIds NON
// passano dall'AI: vengono ricostruiti deterministicamente dopo.
const { STORE_SECTIONS } = require('./diet');

const mergeSchema = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'STRING' },
          storeSection: { type: 'STRING', enum: STORE_SECTIONS },
          costUsd: { type: 'NUMBER' },
          mergedFrom: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'EXACT names of the input items this line covers (1 or more)',
          },
        },
        required: ['name', 'quantity', 'storeSection', 'costUsd', 'mergedFrom'],
      },
    },
  },
  required: ['items'],
};

function describeItems(items) {
  return items
    .map((i) => `- ${i.name} | ${i.quantity || 'n/a'} | ${i.storeSection || 'other'} | $${i.costUsd || 0}`)
    .join('\n');
}

function buildMergePrompt(itemsA, itemsB) {
  return [
    'You merge two grocery shopping lists into one, like an experienced home cook would.',
    '',
    'LIST A:',
    describeItems(itemsA),
    '',
    'LIST B:',
    describeItems(itemsB),
    '',
    'Rules:',
    '- Combine items that are the SAME ingredient even under different names or forms',
    '  ("red onion" + "onions", "garlic cloves" + "garlic"). Sum quantities sensibly',
    '  (e.g. "200 g" + "150 g" = "350 g"; mixed units: keep both, "2 cups + 100 g").',
    '- Cost of a combined line = the larger of the two costs, NOT the sum (you buy once).',
    '- Items that appear in only one list pass through unchanged.',
    '- Do NOT invent, remove or substitute anything.',
    '- mergedFrom must contain the EXACT original names covered by each line.',
    '- Keep each item name in the language it was written in.',
  ].join('\n');
}

module.exports = { buildMergePrompt, mergeSchema };
