// Come si compone un mazzo. Funzioni pure: niente Firestore, niente IA,
// così si possono provare da sole.
//
// 1. Il mazzo si divide in posti per tipo di ricetta (vegana, vegetariana,
//    pescetariana) secondo le quote della dieta, spostate un po' verso
//    quello che la persona tiene davvero.
// 2. Ogni posto prende la miglior ricetta in classifica che va bene per
//    questa persona, senza ripetere piatti, formati o proteine.
// 3. I posti rimasti vuoti diventano richieste all'IA: un piatto vero
//    dall'atlante, preferendo quelli che il ricettario non ha ancora.
const { allowedDiets, violation, animalCategories, DIET_RANK } = require('./ingredients');
const { localCost } = require('./render');

const SEASON_BY_MONTH = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

function currentSeason(now = new Date()) {
  return SEASON_BY_MONTH[now.getMonth()];
}

// ---------------------------------------------------------------------------
// Punteggio
// ---------------------------------------------------------------------------

/** Quota di tenute di tutta la classifica, solo da mostrare. */
function poolMean(pool) {
  let keeps = 0;
  let views = 0;
  for (const e of pool) {
    keeps += (e.stats && e.stats.keeps) || 0;
    views += (e.stats && e.stats.views) || 0;
  }
  return views ? keeps / views : 0;
}

/**
 * La quota di tenute di cui siamo ragionevolmente sicuri (limite basso
 * di Wilson): più viste ha una ricetta, più il punteggio si avvicina alla
 * sua quota vera. 2 su 2 batte 1 su 1, 670 su 1000 batte 68 su 100.
 * Stelle e riusi valgono come mezze tenute in più, fino al 100%.
 * Con il gruppo di dieta della persona quando ha abbastanza dati.
 */
function score(entry, params, userDiet) {
  const stats = entry.stats || {};
  const group = stats.groups && stats.groups[userDiet];
  const s = group && group.views >= params.groupMinViews ? group : stats;
  const n = s.views || 0;
  if (!n) return 0;
  const z = params.confidence;
  const kept = (s.keeps || 0) + (s.stars || 0) * params.bonus.star + (s.reuses || 0) * params.bonus.reuse;
  const p = Math.min(1, kept / n);
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

// ---------------------------------------------------------------------------
// Quote per tipo di ricetta
// ---------------------------------------------------------------------------

function personalQuotas(userDiet, history, params) {
  const base = params.quotas[userDiet] || { vegan: 1 };
  const diets = Object.keys(base).filter((d) => base[d] > 0);
  if (diets.length < 2) return base;

  const rate = {};
  for (const d of diets) {
    const seen = history.filter((h) => h.diet === d && (h.outcome === 'kept' || h.outcome === 'passed'));
    if (seen.length >= 5) rate[d] = seen.filter((h) => h.outcome === 'kept').length / seen.length;
  }
  const known = Object.keys(rate);
  if (known.length < 2) return base;
  const avg = known.reduce((a, d) => a + rate[d], 0) / known.length;

  const shifted = {};
  for (const d of diets) {
    const delta = d in rate ? Math.max(-1, Math.min(1, (rate[d] - avg) / Math.max(avg, 0.1))) : 0;
    shifted[d] = Math.max(0.05, base[d] + delta * params.quotaShift);
  }
  const total = Object.values(shifted).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(diets.map((d) => [d, shifted[d] / total]));
}

/** Sequenza dei posti: le diete sparse lungo il mazzo, non a blocchi. */
function slotPlan(quotas, count) {
  const diets = Object.keys(quotas).filter((d) => quotas[d] > 0);
  const raw = diets.map((d) => ({ d, exact: quotas[d] * count }));
  const counts = Object.fromEntries(raw.map((r) => [r.d, Math.floor(r.exact)]));
  let left = count - Object.values(counts).reduce((a, b) => a + b, 0);
  for (const r of [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
    if (left <= 0) break;
    counts[r.d] += 1;
    left -= 1;
  }
  const placed = Object.fromEntries(diets.map((d) => [d, 0]));
  const seq = [];
  for (let i = 1; i <= count; i++) {
    const next = diets
      .filter((d) => placed[d] < counts[d])
      .sort((a, b) => (counts[b] * i / count - placed[b]) - (counts[a] * i / count - placed[a]))[0];
    placed[next] += 1;
    seq.push(next);
  }
  return seq;
}

// ---------------------------------------------------------------------------
// Contesto della persona
// ---------------------------------------------------------------------------

/**
 * @param {object} o
 * @param {string} o.userDiet
 * @param {Array}  o.tiles         cucine scelte (vuoto = sorprendimi)
 * @param {Array}  o.appliances
 * @param {Array}  o.rules         regole di esclusione (ingredients.buildExclusionRules)
 * @param {Array}  o.history       userHistory
 * @param {Array}  o.runDishKeys   piatti già in questa run
 * @param {Array}  o.runPassedFormats
 * @param {number} o.servings
 * @param {object} o.locale        render.localeOf
 * @param {number} o.budget        budget della run (valuta utente)
 * @param {number} o.remaining
 * @param {number} o.adventure
 * @param {string} o.occasion
 * @param {Array}  o.chips
 */
function buildContext(o, params, now = new Date()) {
  const cutoff = now.getTime() - params.seenDishDays * 86400000;
  const blocked = new Set(o.runDishKeys || []);
  for (const h of o.history || []) {
    const reached = h.outcome !== 'unseen' && h.outcome !== 'forced' && h.outcome !== 'gone';
    if (h.createdAt >= cutoff && reached) blocked.add(h.dishKey);
  }
  const keptFormats = {};
  for (const h of o.history || []) if (h.outcome === 'kept' && h.format) keptFormats[h.format] = (keptFormats[h.format] || 0) + 1;
  return {
    ...o,
    allowed: allowedDiets(o.userDiet),
    blocked,
    keptFormats,
    retiredDishes: o.retiredDishes || new Map(),
    dishMaxRetired: params.dishMaxRetired,
    season: currentSeason(now),
    maxCost: Math.max(o.remaining || 0, (o.budget || 0) * 0.25),
  };
}

const FAMILIARITY = {
  1: { 1: 1.2, 2: 1.0, 3: 0.7 },
  2: { 1: 1.05, 2: 1.05, 3: 0.9 },
  3: { 1: 0.85, 2: 1.05, 3: 1.2 },
};

const PROTEIN_RICH = new Set([
  'tofu', 'beans', 'lentils', 'chickpeas', 'seitan', 'tempeh', 'fish',
  'eggs', 'cheese', 'soy_mince', 'jackfruit', 'shellfish', 'edamame_peas',
]);

/** Quanto un piatto risponde al motivo della spesa. */
function moodFactor(item, occasion) {
  let factor = (item.occasions || []).includes(occasion) ? 1.2 : 1;
  if (occasion === 'fresh') factor *= (item.tiles || []).includes('Fresh & light') ? 1.5 : 0.85;
  if (occasion === 'protein') {
    const light = item.protein === 'vegetables' || item.protein === 'grains' || item.protein === 'mushrooms';
    if (PROTEIN_RICH.has(item.protein)) factor *= 1.45;
    else if (light) factor *= 0.7;
  }
  return factor;
}

function fitsTiles(tiles, ctx) {
  return !ctx.tiles.length || (tiles || []).some((t) => ctx.tiles.includes(t));
}

function fitsAppliances(appliances, ctx) {
  if (!ctx.appliances || !ctx.appliances.length) return true;
  return (appliances || []).every((a) => ctx.appliances.includes(a));
}

/** Perché una ricetta in classifica non va bene per questa persona (null = va bene). */
function rejectReason(entry, ctx) {
  if (!ctx.allowed.includes(entry.diet)) return 'diet';
  if (!fitsTiles(entry.tiles, ctx)) return 'tile';
  if (ctx.blocked.has(entry.dishKey)) return 'seen';
  if (!fitsAppliances(entry.appliances, ctx)) return 'appliances';
  if (ctx.occasion === 'quick' && (entry.recipe.cookMinutes || 99) > 30) return 'slow';
  if (localCost(entry.recipe, ctx.servings, ctx.locale.rate) > ctx.maxCost) return 'cost';
  const texts = (entry.recipe.ingredients || []).map((i) => i.name);
  if (violation(ctx.rules, texts, entry.allergens || [])) return 'exclusion';
  return null;
}

function adjusted(entry, base, ctx) {
  let s = base;
  s *= (FAMILIARITY[ctx.adventure] || FAMILIARITY[2])[entry.familiarity || 2] || 1;
  if ((entry.seasons || []).length && !(entry.seasons || []).includes(ctx.season)) s *= 0.9;
  s *= moodFactor(entry, ctx.occasion);
  s *= 1 + Math.min(0.15, 0.05 * (ctx.keptFormats[entry.format] || 0));
  const chips = ctx.chips || [];
  if (chips.includes('too_fancy')) s *= entry.familiarity === 1 && entry.effort !== 'high' ? 1.15 : entry.familiarity === 3 ? 0.8 : 1;
  if (chips.includes('weird_ingredients') && (entry.specialty || []).length) s *= 0.8;
  if (chips.includes('not_my_taste') && (ctx.runPassedFormats || []).includes(entry.format)) s *= 0.75;
  return s * (0.92 + Math.random() * 0.16);
}

// ---------------------------------------------------------------------------
// Varietà
// ---------------------------------------------------------------------------

function capFor(protein) {
  return protein === 'vegetables' || protein === 'grains' ? 3 : 2;
}

function makeTracker(ctx, count) {
  const formats = {};
  const proteins = {};
  const tiles = Object.fromEntries((ctx.tiles || []).map((t) => [t, 0]));
  const dishes = new Set();
  // Con più cucine scelte, nessuna si prende più della sua parte: se la
  // classifica ne ha poche di una, quei posti li scrive l'IA.
  const tileCap = Object.keys(tiles).length > 1 ? Math.ceil(count / Object.keys(tiles).length) : Infinity;
  return {
    ok(item) {
      if (dishes.has(item.dishKey)) return false;
      if ((formats[item.format] || 0) >= 2) return false;
      if ((proteins[item.protein] || 0) >= capFor(item.protein)) return false;
      if (tileCap !== Infinity && !(item.tiles || []).some((t) => t in tiles && tiles[t] < tileCap)) return false;
      return true;
    },
    /** La cucina scelta che ha meno piatti finora: si prova a servirla per prima. */
    neediestTile() {
      const keys = Object.keys(tiles);
      if (keys.length < 2) return null;
      return keys.sort((a, b) => tiles[a] - tiles[b])[0];
    },
    add(item) {
      dishes.add(item.dishKey);
      formats[item.format] = (formats[item.format] || 0) + 1;
      proteins[item.protein] = (proteins[item.protein] || 0) + 1;
      const tile = (item.tiles || []).filter((t) => t in tiles && tiles[t] < tileCap).sort((a, b) => tiles[a] - tiles[b])[0]
        || (item.tiles || []).find((t) => t in tiles);
      if (tile) tiles[tile] += 1;
    },
  };
}

function dietFits(itemDiet, slotDiet) {
  return DIET_RANK[itemDiet] <= DIET_RANK[slotDiet];
}

/** Un posto vegetariano lo riempie prima una ricetta vegetariana, poi una vegana. */
function bestFor(slotDiet, list, tracker, extra = () => true) {
  const tile = tracker.neediestTile();
  const usable = list.filter((c) => !c.used && dietFits(c.entry.diet, slotDiet) && tracker.ok(c.entry) && extra(c));
  const exact = usable.filter((c) => c.entry.diet === slotDiet);
  const pools = [exact, usable];
  for (const pool of pools) {
    if (!pool.length) continue;
    if (tile) {
      const forTile = pool.find((c) => (c.entry.tiles || []).includes(tile));
      if (forTile) return forTile;
    }
    return pool[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Il mazzo
// ---------------------------------------------------------------------------

/**
 * @returns {{ slots: string[], picks: Array<{slot, entry, score, young}>, missing: Array<{slot, diet}>, quotas, skipped }}
 */
function pickFromPool(pool, ctx, params, count) {
  const quotas = personalQuotas(ctx.userDiet, ctx.history || [], params);
  const slots = slotPlan(quotas, count);

  const skipped = {};
  const candidates = [];
  for (const entry of pool) {
    const reason = rejectReason(entry, ctx);
    if (reason) {
      skipped[reason] = (skipped[reason] || 0) + 1;
      continue;
    }
    const base = score(entry, params, ctx.userDiet);
    candidates.push({ entry, base, score: adjusted(entry, base, ctx), young: ((entry.stats || {}).views || 0) < params.youngViews });
  }
  candidates.sort((a, b) => b.score - a.score);

  const maxRanked = Math.max(0, count - (params.minAiPerDeck || 0));
  const tracker = makeTracker(ctx, count);
  const picks = [];
  const missing = [];

  // Prima i posti per le ricette giovani, sparsi nel mazzo.
  const youngPositions = new Set();
  for (let k = 0; k < (params.youngSlots || 0) && k < slots.length; k++) {
    youngPositions.add(Math.min(slots.length - 1, 2 + k * 3));
  }

  slots.forEach((slotDiet, i) => {
    if (picks.length >= maxRanked) {
      missing.push({ slot: i, diet: slotDiet });
      return;
    }
    let choice = null;
    if (youngPositions.has(i)) choice = bestFor(slotDiet, candidates, tracker, (c) => c.young);
    if (!choice) choice = bestFor(slotDiet, candidates, tracker, (c) => !c.young || !youngPositions.size);
    if (!choice) choice = bestFor(slotDiet, candidates, tracker);
    if (!choice) {
      missing.push({ slot: i, diet: slotDiet });
      return;
    }
    choice.used = true;
    tracker.add(choice.entry);
    picks.push({ slot: i, entry: choice.entry, score: choice.base, young: choice.young });
  });

  return { slots, picks, missing, quotas, skipped, tracker };
}

/** Il piatto dell'atlante si adatta alla dieta del posto? */
function dishFitsDiet(dish, diet) {
  if (!(dish.versions || []).includes(diet)) return false;
  // Un posto vegetariano vuole formaggio o uova veri, non un piatto vegano.
  if (diet === 'vegetarian') return dish.traditionalDiet !== 'vegan';
  if (diet === 'pescatarian') return dish.traditionalDiet === 'pescatarian' || dish.traditionalDiet === 'meat';
  return true;
}

function dishExcluded(dish, diet, ctx) {
  // Gli ingredienti animali di un piatto tradizionale spariscono nella
  // versione vegana: non devono bloccarlo.
  const texts = (dish.keyIngredients || []).filter((t) => {
    if (diet === 'pescatarian') return true;
    const cats = animalCategories(t);
    if (!cats.length) return true;
    if (diet === 'vegetarian') return !cats.some((c) => c === 'meat' || c === 'fish' || c === 'shellfish');
    return false;
  });
  return Boolean(violation(ctx.rules, texts, []));
}

/**
 * Sceglie i piatti dell'atlante per i posti vuoti. Prima quelli che il
 * ricettario non ha ancora per quella dieta, così il ricettario cresce in
 * larghezza e non sempre sugli stessi piatti.
 */
function pickBriefs(missing, dishes, ctx, coverage, tracker) {
  const briefs = [];
  for (const slot of missing) {
    const options = dishes.filter((d) => {
      if (!dishFitsDiet(d, slot.diet)) return false;
      if (!fitsTiles(d.tiles, ctx)) return false;
      if (ctx.blocked.has(d.key)) return false;
      if (ctx.dishMaxRetired && (ctx.retiredDishes.get(`${d.key}|${slot.diet}`) || 0) >= ctx.dishMaxRetired) return false;
      if (!fitsAppliances(d.appliances, ctx)) return false;
      if (ctx.occasion === 'quick' && d.cookMinutes > 30) return false;
      if (!tracker.ok({ dishKey: d.key, format: d.format, protein: d.protein, tiles: d.tiles })) return false;
      return !dishExcluded(d, slot.diet, ctx);
    });
    if (!options.length) continue;

    const tile = tracker.neediestTile();
    const scored = options.map((d) => {
      let s = (FAMILIARITY[ctx.adventure] || FAMILIARITY[2])[d.familiarity] || 1;
      if (!(d.seasons || []).includes(ctx.season)) s *= 0.8;
      s *= moodFactor(d, ctx.occasion);
      if (tile && d.tiles.includes(tile)) s *= 1.5;
      const have = coverage.get(`${d.key}|${slot.diet}`) || 0;
      s *= have === 0 ? 1.4 : have < 3 ? 1 : 0.6;
      if ((ctx.chips || []).includes('too_fancy') && d.familiarity === 1) s *= 1.3;
      if ((ctx.chips || []).includes('weird_ingredients') && (d.specialtyIngredients || []).length) s *= 0.6;
      return { d, s: s * (0.75 + Math.random() * 0.5) };
    });
    scored.sort((a, b) => b.s - a.s);
    const dish = scored[0].d;
    tracker.add({ dishKey: dish.key, format: dish.format, protein: dish.protein, tiles: dish.tiles });
    briefs.push({ slot: slot.slot, diet: slot.diet, dish });
  }
  return briefs;
}

/**
 * Ordine nel mazzo: le migliori della classifica in testa, poi le
 * giovani e le nuove alternate alle altre, così le nuove vengono viste.
 */
function deckOrder(items) {
  const established = items.filter((i) => i.source === 'ranked' && !i.young).sort((a, b) => b.score - a.score);
  const fresh = items.filter((i) => i.source !== 'ranked' || i.young);
  const out = established.slice(0, 2);
  let e = 2;
  let f = 0;
  while (e < established.length || f < fresh.length) {
    if (f < fresh.length) out.push(fresh[f++]);
    if (e < established.length) out.push(established[e++]);
  }
  return out;
}

module.exports = {
  currentSeason,
  score,
  poolMean,
  personalQuotas,
  slotPlan,
  buildContext,
  rejectReason,
  pickFromPool,
  pickBriefs,
  dishFitsDiet,
  deckOrder,
};
