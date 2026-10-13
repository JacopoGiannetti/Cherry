// Il paracadute in corsia (§4.2): "non trovo il tempeh" → sostituti
// immediati con rationale di due parole + step riscritti in background.
const { dietSection, STORE_SECTIONS } = require('./diet');

const substituteSchema = {
  type: 'OBJECT',
  properties: {
    substitutes: {
      type: 'ARRAY',
      description: '2-4 alternatives, best first',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'STRING' },
          rationale: { type: 'STRING', description: 'ONE or two words: "cheaper", "same texture"' },
          storeSection: { type: 'STRING', enum: STORE_SECTIONS },
          costUsd: { type: 'NUMBER' },
        },
        required: ['name', 'quantity', 'rationale', 'storeSection', 'costUsd'],
      },
    },
    rewrittenRecipes: {
      type: 'ARRAY',
      description: 'For each affected recipe, the steps rewritten with the FIRST substitute',
      items: {
        type: 'OBJECT',
        properties: {
          recipeId: { type: 'STRING' },
          steps: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['recipeId', 'steps'],
      },
    },
  },
  required: ['substitutes', 'rewrittenRecipes'],
};

function buildSubstitutePrompt(profile, ingredientName, affectedRecipes) {
  return [
    'You are Cherry. The user is standing in a grocery aisle RIGHT NOW and cannot find an ingredient.',
    '',
    dietSection(profile),
    '',
    `Missing ingredient: "${ingredientName}"`,
    `Recipes that depend on it (id, title, ingredients, steps): ${JSON.stringify(affectedRecipes)}`,
    '',
    'Propose 2-4 substitutes any US supermarket carries, best first, each with a',
    'one-or-two-word rationale. Then rewrite the steps of every affected recipe',
    'using the FIRST substitute. All user-facing text in the RESPONSE LANGUAGE defined above.',
  ].join('\n');
}

module.exports = { buildSubstitutePrompt, substituteSchema };
