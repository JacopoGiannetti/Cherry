// Verdetto prodotto (§5.2): mai un "vegan ✓" hardcodato, sempre
// "fits your diet" parametrizzato sul profilo. La classificazione del
// prodotto (flags) è indipendente dal profilo, quindi cacheable per barcode.
const { generateJSON } = require('../services/gemini');

const flagsSchema = {
  type: 'OBJECT',
  properties: {
    containsMeat: { type: 'BOOLEAN' },
    containsFish: { type: 'BOOLEAN' },
    containsDairy: { type: 'BOOLEAN' },
    containsEgg: { type: 'BOOLEAN' },
    containsHoney: { type: 'BOOLEAN' },
    containsOtherAnimal: { type: 'BOOLEAN', description: 'gelatin, carmine, shellac, lard...' },
    offendingIngredients: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          category: { type: 'STRING', enum: ['meat', 'fish', 'dairy', 'egg', 'honey', 'other_animal'] },
        },
        required: ['name', 'category'],
      },
    },
  },
  required: ['containsMeat', 'containsFish', 'containsDairy', 'containsEgg', 'containsHoney', 'containsOtherAnimal', 'offendingIngredients'],
};

/**
 * Deriva i flag animali dai tag di Open Food Facts quando conclusivi.
 * Ritorna null se i dati non bastano (serve il fallback Gemini).
 */
function flagsFromOffTags(product) {
  const tags = product.analysisTags || [];
  if (tags.includes('en:vegan')) {
    return {
      containsMeat: false, containsFish: false, containsDairy: false,
      containsEgg: false, containsHoney: false, containsOtherAnimal: false,
      offendingIngredients: [],
    };
  }
  // Per i casi non-vegan i tag OFF non distinguono carne/pesce/latticini:
  // servono gli ingredienti. Se abbiamo la lista testuale usiamo Gemini.
  return null;
}

/** Classificazione via Gemini della lista ingredienti (profile-independent). */
async function classifyWithGemini(product) {
  const prompt = [
    'Classify this food product\'s ingredient list for animal-derived content.',
    `Product: ${product.name} ${product.brand ? `by ${product.brand}` : ''}`,
    `Ingredients: """${product.ingredientsText || 'unknown'}"""`,
    `Open Food Facts analysis tags: ${JSON.stringify(product.analysisTags || [])}`,
    `Allergen tags: ${JSON.stringify(product.allergenTags || [])}`,
    'Be conservative: when an ingredient is ambiguous (e.g. "natural flavors"), do NOT flag it.',
    'List every offending ingredient with its category.',
  ].join('\n');
  return generateJSON({ prompt, schema: flagsSchema, temperature: 0.2, label: 'product-flags' });
}

/**
 * Verdetto finale per il profilo dell'utente.
 * Ritorna { fits: boolean, label, offendingIngredients: [{name, category}] }
 */
function verdictFor(dietaryIdentity, flags) {
  const offending = flags.offendingIngredients || [];
  const pick = (...categories) => offending.filter((o) => categories.includes(o.category));

  switch (dietaryIdentity) {
    case 'omnivore':
      return { fits: true, label: 'No restrictions', offendingIngredients: [] };
    case 'vegan': {
      const bad = offending;
      return { fits: bad.length === 0, label: bad.length === 0 ? 'Fits your diet' : 'Not for your diet', offendingIngredients: bad };
    }
    case 'vegetarian': {
      const bad = pick('meat', 'fish', 'other_animal');
      return { fits: bad.length === 0, label: bad.length === 0 ? 'Fits your diet' : 'Not for your diet', offendingIngredients: bad };
    }
    case 'pescatarian': {
      const bad = pick('meat', 'other_animal');
      return { fits: bad.length === 0, label: bad.length === 0 ? 'Fits your diet' : 'Not for your diet', offendingIngredients: bad };
    }
    case 'reducer': {
      // Il reducer può mangiare tutto: il verdetto diventa informativo.
      const animal = pick('meat', 'fish');
      return {
        fits: animal.length === 0,
        label: animal.length === 0 ? 'Plant-based choice' : 'Contains meat or fish',
        offendingIngredients: animal,
      };
    }
    default:
      return { fits: offending.length === 0, label: 'Fits your diet', offendingIngredients: offending };
  }
}

/**
 * Le etichette in cima allo scan, uguali per tutti i profili.
 * true / false / null (non si sa). Proteico = almeno il 20% delle
 * calorie dalle proteine, la soglia UE per "high protein".
 */
function badgesFor(flags, nutrition) {
  const animal = flags
    ? {
      meat: flags.containsMeat || flags.containsFish || flags.containsOtherAnimal,
      any: flags.containsMeat || flags.containsFish || flags.containsOtherAnimal
        || flags.containsDairy || flags.containsEgg || flags.containsHoney
        || (flags.offendingIngredients || []).length > 0,
    }
    : null;
  const proteinShare = nutrition && nutrition.protein != null && nutrition.kcal > 0
    ? (nutrition.protein * 4) / nutrition.kcal
    : null;
  return {
    vegan: animal ? !animal.any : null,
    vegetarian: animal ? !animal.meat : null,
    highProtein: proteinShare == null ? null : proteinShare >= 0.2,
  };
}

module.exports = { flagsFromOffTags, classifyWithGemini, verdictFor, badgesFor };
