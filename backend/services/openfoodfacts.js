// Lookup barcode su Open Food Facts: gratuito, nessuna chiave,
// serve solo uno User-Agent identificativo.
const axios = require('axios');
const { keys } = require('../config/keys');

const TIMEOUT_MS = 15000;

const number = (value) => {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};

/** Valori per 100 g (o 100 ml). null se OFF non ha nemmeno le kcal. */
function nutritionFrom(n = {}) {
  const kcal = number(n['energy-kcal_100g'])
    ?? (number(n['energy-kj_100g']) != null ? Math.round(n['energy-kj_100g'] / 4.184) : null);
  if (kcal == null) return null;
  return {
    kcal: Math.round(kcal),
    protein: number(n.proteins_100g),
    carbs: number(n.carbohydrates_100g),
    sugars: number(n.sugars_100g),
    fat: number(n.fat_100g),
    saturatedFat: number(n['saturated-fat_100g']),
    fiber: number(n.fiber_100g),
    salt: number(n.salt_100g),
  };
}

/**
 * Ritorna i dati normalizzati del prodotto, o null se non trovato.
 * `nutrition` è sempre presente (anche null): le voci in cache senza
 * la chiave sono di prima e vanno riscaricate.
 */
async function lookupBarcode(barcode) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': keys.openFoodFacts.userAgent },
      timeout: TIMEOUT_MS,
    });
    if (response.data.status !== 1 || !response.data.product) return null;
    const p = response.data.product;
    return {
      barcode,
      name: p.product_name || p.product_name_en || 'Unknown product',
      brand: (p.brands || '').split(',')[0].trim() || null,
      imageUrl: p.image_front_url || p.image_url || null,
      ingredientsText: p.ingredients_text_en || p.ingredients_text || null,
      // Tag pronti di OFF: 'en:vegan', 'en:non-vegan', 'en:maybe-vegan',
      // 'en:vegetarian', 'en:non-vegetarian', 'en:vegetarian-status-unknown'...
      analysisTags: p.ingredients_analysis_tags || [],
      allergenTags: p.allergens_tags || [],
      quantity: p.quantity || null,
      per: /\b(ml|cl|l)\b/i.test(p.quantity || '') || p.nutrition_data_per === '100ml' ? '100 ml' : '100 g',
      nutrition: nutritionFrom(p.nutriments),
      nutriScore: /^[a-e]$/.test(p.nutriscore_grade || '') ? p.nutriscore_grade : null,
      nova: [1, 2, 3, 4].includes(Number(p.nova_group)) ? Number(p.nova_group) : null,
      ingredients: Array.isArray(p.ingredients)
        ? p.ingredients.map((i) => ({
            name: i.text || i.id || '',
            vegan: i.vegan || null,        // 'yes' | 'no' | 'maybe' | null
            vegetarian: i.vegetarian || null,
          }))
        : [],
    };
  } catch (e) {
    console.error('[off] lookup fallito:', e.message);
    return null;
  }
}

module.exports = { lookupBarcode };
