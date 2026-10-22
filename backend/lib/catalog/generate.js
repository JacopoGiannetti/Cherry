// Scrittura di ricette nuove per i piatti scelti dall'atlante, e il
// controllo nel codice di quello che torna dall'IA.
const { generateJSON } = require('../../services/gemini');
const { buildGeneratePrompt, generateSchema } = require('../../prompts/catalog');
const { dietOf, violation, inferAllergens, DIET_RANK } = require('./ingredients');
const { UNITS } = require('./units');
const { emptyStats } = require('./store');
const { proteinFor } = require('./atlas');

const MARKETING = /\b(ultimate|best|perfect|easy|dreamy|loaded|cozy|cosy|creamy|epic|amazing|delicious|irresistible|healthy|quick|simple)\b\s*/gi;

function cleanTitle(title) {
  const original = String(title || '').replace(/[.!]+$/, '').trim();
  const clean = original.replace(MARKETING, '').replace(/\s{2,}/g, ' ').trim();
  if (clean.split(' ').length < 2 && original.split(' ').length > clean.split(' ').length) return original;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Perché una ricetta tornata dall'IA non si può usare (null = va bene).
 * Corregge sul posto quello che si può correggere senza chiedere.
 */
function problemsOf(recipe, brief, ctx) {
  const ingredients = recipe.ingredients || [];
  if (!recipe.title) return 'missing title';
  if (ingredients.length < 3) return 'fewer than 3 ingredients';
  if ((recipe.steps || []).length < 3) return 'fewer than 3 steps';
  for (const ing of ingredients) {
    if (!ing.name) return 'ingredient without a name';
    if (!UNITS.includes(ing.unit)) return `unknown unit "${ing.unit}" for ${ing.name}`;
    if (ing.unit !== 'to_taste' && !(ing.amount > 0)) return `no amount for ${ing.name}`;
  }
  const diet = dietOf(ingredients);
  if (DIET_RANK[diet] > DIET_RANK[brief.diet]) {
    return `${brief.dish.name}: must be ${brief.diet} but the ingredients make it ${diet}`;
  }
  if (brief.diet === 'meat' && diet !== 'meat') {
    return `${brief.dish.name}: this is the traditional version — keep its meat, it came out ${diet}`;
  }
  const allergens = [...new Set([...(recipe.allergens || []), ...inferAllergens(ingredients)])];
  const hit = violation(ctx.rules, ingredients.map((i) => i.name), allergens);
  if (hit) return `${brief.dish.name}: uses an excluded ingredient (${hit})`;
  if (ctx.appliances && ctx.appliances.length) {
    const missing = (recipe.appliances || []).filter((a) => !ctx.appliances.includes(a));
    if (missing.length) return `${brief.dish.name}: needs ${missing.join(', ')} which the cook does not have`;
  }
  recipe._diet = diet;
  recipe._allergens = allergens;
  return null;
}

/** Il documento catalog di una ricetta appena scritta (senza foto né id). */
function toEntry(recipe, brief, { uid, ctx }) {
  const d = brief.dish;
  const ingredients = recipe.ingredients.map((i) => ({
    name: String(i.name).toLowerCase().trim(),
    amount: i.unit === 'to_taste' ? 0 : Number(i.amount),
    unit: i.unit,
    storeSection: i.storeSection || 'other',
    costUsd: Math.max(0, Number(i.costUsd) || 0),
  }));
  const sum = ingredients.reduce((a, i) => a + i.costUsd, 0);
  return {
    status: 'candidate',
    origin: 'ai',
    dishKey: d.key,
    dishName: d.name,
    tiles: d.tiles,
    cuisine: d.cuisine,
    format: d.format,
    protein: proteinFor(d, brief.diet),
    method: d.method,
    appliances: [...new Set(recipe.appliances && recipe.appliances.length ? recipe.appliances : d.appliances)],
    familiarity: d.familiarity,
    effort: d.effort,
    seasons: d.seasons,
    occasions: d.occasions,
    specialty: d.specialtyIngredients || [],
    diet: recipe._diet,
    slotDiet: brief.diet,
    allergens: recipe._allergens,
    recipe: {
      title: cleanTitle(recipe.title),
      oneLiner: String(recipe.oneLiner || '').trim(),
      cookMinutes: Math.round(Number(recipe.cookMinutes) || d.cookMinutes || 30),
      servings: 2,
      costUsd: Math.round((sum > 0 ? sum : Number(recipe.costUsd) || 0) * 100) / 100,
      ingredients,
      steps: recipe.steps.map((s) => String(s).trim()).filter(Boolean),
      imagePrompt: recipe.imagePrompt || '',
    },
    imageUrl: null,
    imageUrls: [],
    translations: {},
    stats: emptyStats(),
    createdBy: uid || null,
    createdFor: ctx ? { userDiet: ctx.userDiet, tiles: ctx.tiles, occasion: ctx.occasion, adventure: ctx.adventure } : null,
  };
}

/**
 * Scrive le ricette per i brief. Una chiamata per tutti; quelle scartate
 * dal controllo si richiedono una seconda volta, con il motivo.
 * @returns {Promise<{ entries: Array<{brief, entry}>, calls: number, rejected: string[] }>}
 */
async function writeRecipes(briefs, { basket, profile, ctx, sharing, uid, label = 'catalog-recipes' }) {
  const done = [];
  const rejected = [];
  let todo = briefs;
  let notes = [];
  let calls = 0;

  for (let attempt = 0; attempt < 2 && todo.length; attempt++) {
    calls += 1;
    const result = await generateJSON({
      prompt: buildGeneratePrompt({
        briefs: todo,
        basket: [...basket, ...done.map((d) => ({ title: d.entry.recipe.title, ingredients: d.entry.recipe.ingredients.map((i) => i.name) }))],
        profile,
        exclusions: profile.exclusions || [],
        sharing,
        occasion: ctx.occasion,
        chips: ctx.chips,
        retryNotes: notes,
      }),
      schema: generateSchema,
      temperature: 0.6,
      label,
    });

    const answered = new Set();
    notes = [];
    for (const recipe of result.recipes || []) {
      const brief = todo[Math.round(recipe.brief) - 1];
      if (!brief || answered.has(brief)) continue;
      answered.add(brief);
      const problem = problemsOf(recipe, brief, ctx);
      if (problem) {
        notes.push(problem);
        rejected.push(problem);
        continue;
      }
      done.push({ brief, entry: toEntry(recipe, brief, { uid, ctx }) });
    }
    const failed = todo.filter((b) => !done.some((d) => d.brief === b));
    for (const b of failed) if (!answered.has(b)) notes.push(`${b.dish.name}: missing from the answer`);
    todo = failed;
  }
  if (rejected.length) console.warn('[catalog] ricette scartate:', rejected.join(' | '));
  return { entries: done, calls, rejected };
}

module.exports = { writeRecipes, problemsOf, toEntry, cleanTitle };
