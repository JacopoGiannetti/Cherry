// Da ricetta del ricettario (inglese, 2 persone, metrico, dollari) al
// documento che l'app legge già oggi: stessi campi di una ricetta IA,
// più qualche campo in più che le versioni vecchie dell'app ignorano.
const { quantityText, fillTokens } = require('./units');
const { resolveUnits, resolveCurrency } = require('../../prompts/diet');

function localeOf(profile = {}, params) {
  const lang = ['en', 'it', 'es', 'fr', 'de', 'pt'].includes(profile.language) ? profile.language : 'en';
  const currency = resolveCurrency(profile);
  return {
    lang,
    units: resolveUnits(profile),
    currency,
    rate: (params.currency || {})[currency] || 1,
  };
}

function money(value) {
  return Math.round(value * 100) / 100;
}

/** Costo dell'intera ricetta per le porzioni e la valuta dell'utente. */
function localCost(recipe, servings, rate) {
  return money((recipe.costUsd || 0) * (servings / 2) * rate);
}

/**
 * @param {object} entry   documento catalog (con id)
 * @param {object} opts    { servings, locale, source }
 */
function renderForApp(entry, { servings, locale, source }) {
  const recipe = entry.recipe || {};
  const tr = (locale.lang !== 'en' && entry.translations && entry.translations[locale.lang]) || null;
  const factor = servings / 2;
  const fill = { servings, units: locale.units, lang: locale.lang };

  const ingredients = (recipe.ingredients || []).map((ing, i) => ({
    name: (tr && tr.ingredients && tr.ingredients[i]) || ing.name,
    quantity: quantityText(ing.amount, ing.unit, fill),
    storeSection: ing.storeSection || 'other',
    costUsd: money((ing.costUsd || 0) * factor * locale.rate),
  }));
  const steps = ((tr && tr.steps && tr.steps.length === (recipe.steps || []).length ? tr.steps : recipe.steps) || [])
    .map((step) => fillTokens(step, fill));

  return {
    title: (tr && tr.title) || recipe.title,
    oneLiner: (tr && tr.oneLiner) || recipe.oneLiner || '',
    cuisine: (tr && tr.cuisine) || entry.cuisine || '',
    costUsd: localCost(recipe, servings, locale.rate),
    cookMinutes: Math.round(recipe.cookMinutes || 30),
    servings,
    ingredients,
    steps,
    imageUrl: entry.imageUrl || null,
    imageStatus: entry.imageUrl ? 'ready' : 'failed',
    catalogId: entry.id,
    source,
    dishKey: entry.dishKey || null,
    diet: entry.diet || null,
  };
}

module.exports = { localeOf, localCost, renderForApp };
