// La vista dinamica: il video originale diviso in spezzoni, ognuno con
// gli step e gli ingredienti che mostra. I tempi si calcolano una volta
// sola, in estrazione; dopo una trasformazione cambiano solo gli indici.
//
// Uno spezzone: { start, end, title, steps: [int], ingredients: [int] },
// indici nella ricetta a cui è attaccato.

const MIN_SECONDS = 1.5;
const MIN_SEGMENTS = 2;

function indexes(list, size) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const n of list) {
    if (Number.isInteger(n) && n >= 0 && n < size && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Quello che arriva da Gemini, reso affidabile: in ordine, senza
 * sovrapposizioni, indici validi. Gli spezzoni troppo corti si fondono
 * col precedente. null se non resta abbastanza per una vista dinamica.
 */
function cleanSegments(raw, recipe) {
  if (!Array.isArray(raw) || !recipe) return null;
  const nSteps = (recipe.steps || []).length;
  const nIngredients = (recipe.ingredients || []).length;

  const sorted = raw
    .map((s) => ({
      start: Number(s?.start),
      end: Number(s?.end),
      title: typeof s?.title === 'string' ? s.title.trim() : '',
      steps: indexes(s?.steps, nSteps),
      ingredients: indexes(s?.ingredients, nIngredients),
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const out = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && s.start < prev.end) s.start = prev.end;
    if (s.end - s.start < MIN_SECONDS && prev) {
      prev.end = Math.max(prev.end, s.end);
      prev.steps = indexes([...prev.steps, ...s.steps], nSteps);
      prev.ingredients = indexes([...prev.ingredients, ...s.ingredients], nIngredients);
      continue;
    }
    if (s.end - s.start < MIN_SECONDS) continue;
    out.push(s);
  }

  const useful = out.filter((s) => s.steps.length);
  return useful.length >= MIN_SEGMENTS ? useful : null;
}

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * Gli spezzoni dell'originale riportati sulla ricetta trasformata. Il
 * video e i tempi restano quelli; step e ingredienti diventano quelli
 * nuovi, dove li ha messi la riscrittura (`stepSegments`,
 * `ingredientOrigins`). Senza quelle indicazioni, se gli step sono
 * rimasti tanti quanti erano si tiene la stessa posizione; gli
 * ingredienti si ritrovano per nome o tramite il sostituto scelto.
 */
function remapSegments(original, final, hints = {}, chosen = []) {
  const segments = original?.segments;
  if (!Array.isArray(segments) || !segments.length || !final) return null;
  const finalSteps = final.steps || [];
  const finalIngredients = final.ingredients || [];
  const originalIngredients = original.ingredients || [];

  let stepSegment = Array.isArray(hints.stepSegments) && hints.stepSegments.length === finalSteps.length
    ? hints.stepSegments
    : null;
  if (!stepSegment && finalSteps.length === (original.steps || []).length) {
    stepSegment = finalSteps.map((_, i) => segments.findIndex((s) => s.steps.includes(i)));
  }
  if (!stepSegment) return null;

  const byName = new Map(originalIngredients.map((ing, i) => [norm(ing.name), i]));
  for (const c of chosen || []) {
    const from = byName.get(norm(c.originalName));
    if (from != null && c.substituteName) byName.set(norm(c.substituteName), from);
  }
  const hinted = Array.isArray(hints.ingredientOrigins) && hints.ingredientOrigins.length === finalIngredients.length
    ? hints.ingredientOrigins
    : null;
  const origin = finalIngredients.map((ing, i) => {
    const h = hinted ? hinted[i] : -1;
    if (Number.isInteger(h) && h >= 0 && h < originalIngredients.length) return h;
    const byNameHit = byName.get(norm(ing.name));
    return byNameHit == null ? -1 : byNameHit;
  });

  const titles = Array.isArray(hints.segmentTitles) && hints.segmentTitles.length === segments.length
    ? hints.segmentTitles
    : null;

  const remapped = segments.map((s, k) => ({
    start: s.start,
    end: s.end,
    title: (titles && typeof titles[k] === 'string' && titles[k].trim()) || s.title,
    steps: stepSegment.map((seg, i) => (seg === k ? i : -1)).filter((i) => i >= 0),
    ingredients: origin.map((o, i) => (o >= 0 && s.ingredients.includes(o) ? i : -1)).filter((i) => i >= 0),
  }));

  const useful = remapped.filter((s) => s.steps.length);
  return useful.length >= MIN_SEGMENTS ? useful : null;
}

/** La ricetta senza spezzoni: per i prompt che non ne hanno bisogno. */
function withoutSegments(recipe) {
  if (!recipe || !recipe.segments) return recipe;
  const { segments, ...rest } = recipe;
  return rest;
}

module.exports = { cleanSegments, remapSegments, withoutSegments };
