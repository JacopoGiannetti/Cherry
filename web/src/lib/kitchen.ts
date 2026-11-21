import type { GroceryItem, GroceryList, Recipe } from './types';

// ---------- Corsie ----------

export const SECTIONS: Record<string, { label: string; emoji: string; order: number }> = {
  produce: { label: 'Produce', emoji: '🥬', order: 0 },
  meat_seafood: { label: 'Meat & seafood', emoji: '🥩', order: 1 },
  proteins: { label: 'Proteins', emoji: '🍗', order: 1 },
  dairy_eggs: { label: 'Dairy & eggs', emoji: '🧀', order: 2 },
  dairy_alternatives: { label: 'Dairy & eggs', emoji: '🧀', order: 2 },
  bakery: { label: 'Bakery', emoji: '🥖', order: 3 },
  grains_pasta: { label: 'Pasta, rice & grains', emoji: '🍝', order: 4 },
  canned_jarred: { label: 'Cans & jars', emoji: '🥫', order: 5 },
  spices_condiments: { label: 'Spices & condiments', emoji: '🧂', order: 6 },
  nuts_seeds: { label: 'Nuts & seeds', emoji: '🥜', order: 7 },
  frozen: { label: 'Frozen', emoji: '🧊', order: 8 },
  snacks_drinks: { label: 'Snacks & drinks', emoji: '🥤', order: 9 },
  other: { label: 'Everything else', emoji: '🛒', order: 10 },
};

export const section = (key?: string) => SECTIONS[key || 'other'] || SECTIONS.other;

// ---------- Porzioni: "1 1/2 cups" × 2 = "3 cups" ----------

const UNICODE_FRACTIONS: Record<string, number> = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125 };

function parseLeadingNumber(q: string): { value: number; rest: string } | null {
  const s = q.trim().replace(/[½⅓⅔¼¾⅛]/g, (c) => ` ${UNICODE_FRACTIONS[c]}`).trim();
  const m = s.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+)|\s+(0?\.\d+))?|^(\d+)\/(\d+)/);
  if (!m) return null;
  let value = 0;
  if (m[5]) value = +m[5] / +m[6];
  else {
    value = parseFloat(m[1]);
    if (m[2]) value += +m[2] / +m[3];
    if (m[4]) value += parseFloat(m[4]);
  }
  return { value, rest: s.slice(m[0].length) };
}

function pretty(n: number) {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  const fracs: [number, string][] = [[0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']];
  if (frac < 0.06) return String(whole || (n > 0 ? '⅛' : 0));
  if (frac > 0.94) return String(whole + 1);
  const [, sym] = fracs.reduce((best, f) => (Math.abs(f[0] - frac) < Math.abs(best[0] - frac) ? f : best));
  return whole ? `${whole}${sym}` : sym;
}

export function scaleQuantity(quantity: string | undefined, factor: number) {
  if (!quantity || factor === 1) return quantity || '';
  // Intervalli: "2-3 tbsp" → si scalano tutti e due i numeri.
  const range = quantity.trim().match(/^([\d.\/\s½⅓⅔¼¾⅛]+?)\s*[-–]\s*([\d.\/½⅓⅔¼¾⅛]+)(.*)$/);
  if (range) {
    const lo = parseLeadingNumber(range[1]);
    const hi = parseLeadingNumber(range[2]);
    if (lo && hi) return `${pretty(lo.value * factor)}–${pretty(hi.value * factor)}${range[3]}`;
  }
  const parsed = parseLeadingNumber(quantity);
  if (!parsed) return quantity;
  return `${pretty(parsed.value * factor)}${parsed.rest.startsWith(' ') || !parsed.rest ? '' : ' '}${parsed.rest}`.trim();
}

// ---------- Lista della spesa: ricette → corsie (come /runs/from-recipes) ----------

export function mergeIntoList(list: GroceryList | null, recipes: Recipe[]): GroceryList {
  const items: GroceryItem[] = list ? list.items.map((i) => ({ ...i, recipeIds: [...i.recipeIds] })) : [];
  const recipeIds = new Set(list?.recipeIds || []);
  const byName = new Map(items.map((i) => [i.name.toLowerCase().trim(), i]));
  for (const r of recipes) {
    if (recipeIds.has(r.id)) continue;
    recipeIds.add(r.id);
    for (const g of r.ingredients || []) {
      const key = (g.name || '').toLowerCase().trim();
      if (!key) continue;
      const hit = byName.get(key);
      if (hit) {
        if (g.quantity && !hit.quantity.includes(g.quantity)) hit.quantity = hit.quantity ? `${hit.quantity} + ${g.quantity}` : g.quantity;
        if (!hit.recipeIds.includes(r.id)) hit.recipeIds.push(r.id);
        hit.checked = false;
      } else {
        const item: GroceryItem = {
          id: crypto.randomUUID(),
          name: g.name,
          quantity: g.quantity || '',
          section: g.storeSection || 'other',
          emoji: g.emoji,
          checked: false,
          recipeIds: [r.id],
        };
        items.push(item);
        byName.set(key, item);
      }
    }
  }
  return { items, recipeIds: [...recipeIds] };
}

export function removeRecipeFromList(list: GroceryList, recipeId: string): GroceryList {
  const items = list.items
    .map((i) => ({ ...i, recipeIds: i.recipeIds.filter((id) => id !== recipeId) }))
    .filter((i) => i.manual || i.recipeIds.length);
  return { items, recipeIds: list.recipeIds.filter((id) => id !== recipeId) };
}

// ---------- Link ----------

export function isSocialLink(text: string) {
  return /https?:\/\/[^\s]*(tiktok\.com|instagram\.com|instagr\.am)\/[^\s]+/i.test(text);
}

export function extractLink(text: string) {
  const m = text.match(/https?:\/\/[^\s]*(tiktok\.com|instagram\.com|instagr\.am)\/[^\s]+/i);
  return m ? m[0] : null;
}

export function fmtTime(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function minutes(n?: number) {
  if (!n) return null;
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
