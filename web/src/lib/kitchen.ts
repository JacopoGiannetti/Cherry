import type { GroceryItem, GroceryList, Recipe, Trip } from './types';

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

// ---------- Articoli aggiunti a mano: emoji e corsia indovinate dal nome ----------

const GUESS: [RegExp, string, string][] = [
  [/milk|latte/i, '🥛', 'dairy_eggs'], [/egg|uova/i, '🥚', 'dairy_eggs'], [/cheese|parmesan|mozzarella|feta|formaggio/i, '🧀', 'dairy_eggs'],
  [/butter|burro/i, '🧈', 'dairy_eggs'], [/yog(h)?urt/i, '🥛', 'dairy_eggs'], [/cream|panna/i, '🥛', 'dairy_eggs'],
  [/bread|pane|bun|bagel|baguette|dough|impasto|pizza base|pastry|focaccia/i, '🍞', 'bakery'], [/tortilla|wrap/i, '🌮', 'bakery'],
  [/banana/i, '🍌', 'produce'], [/apple|mela/i, '🍎', 'produce'], [/lemon|lime|limone/i, '🍋', 'produce'], [/orange|arancia/i, '🍊', 'produce'],
  [/berr|fragol/i, '🍓', 'produce'], [/grape|uva/i, '🍇', 'produce'], [/avocado/i, '🥑', 'produce'], [/tomato|pomodor/i, '🍅', 'produce'],
  [/onion|cipoll|shallot/i, '🧅', 'produce'], [/garlic|aglio/i, '🧄', 'produce'], [/potato|patat/i, '🥔', 'produce'], [/carrot|carot/i, '🥕', 'produce'],
  [/pepper|peperon/i, '🫑', 'produce'], [/salad|lettuce|spinach|kale|insalat|basil|parsley|cilantro|herb/i, '🥬', 'produce'],
  [/mushroom|fungh/i, '🍄', 'produce'], [/cucumber|cetriol|zucchin/i, '🥒', 'produce'], [/broccoli/i, '🥦', 'produce'], [/corn|mais/i, '🌽', 'produce'],
  [/chicken|pollo/i, '🍗', 'meat_seafood'], [/beef|steak|manzo|mince|ground/i, '🥩', 'meat_seafood'], [/bacon|ham|prosciutto|sausage|salsicc/i, '🥓', 'meat_seafood'],
  [/salmon|tuna|fish|pesce|shrimp|prawn|gamber/i, '🐟', 'meat_seafood'],
  [/pasta|spaghetti|penne|noodle/i, '🍝', 'grains_pasta'], [/rice|riso/i, '🍚', 'grains_pasta'], [/flour|farina|oat/i, '🌾', 'grains_pasta'],
  [/coffee|caff/i, '☕', 'snacks_drinks'], [/tea\b|tè/i, '🍵', 'snacks_drinks'], [/water|acqua/i, '💧', 'snacks_drinks'], [/juice|succo/i, '🧃', 'snacks_drinks'],
  [/wine|vino/i, '🍷', 'snacks_drinks'], [/beer|birra/i, '🍺', 'snacks_drinks'], [/chocolate|cioccolat/i, '🍫', 'snacks_drinks'], [/chips|crisps|snack|cookie|biscott/i, '🍪', 'snacks_drinks'],
  [/oil|olio/i, '🫒', 'spices_condiments'], [/salt|sale|pepper|spice|sauce|salsa|ketchup|mayo|mustard|vinegar|aceto|honey|miele|sugar|zucchero/i, '🧂', 'spices_condiments'],
  [/frozen|ice cream|gelato|surgel/i, '🧊', 'frozen'], [/can|beans|fagiol|chickpea|ceci|tomato sauce|passata/i, '🥫', 'canned_jarred'],
  [/nut|almond|mandorl|peanut|walnut|seed/i, '🥜', 'nuts_seeds'],
  [/soap|detergent|paper|tissue|sponge|toilet|shampoo|toothpaste|sapone|carta/i, '🧻', 'other'],
];

export function guessItem(name: string) {
  for (const [re, emoji, sectionKey] of GUESS) if (re.test(name)) return { emoji, section: sectionKey };
  return { emoji: undefined, section: 'other' };
}

export const itemEmoji = (item: { emoji?: string; section?: string }) => item.emoji || section(item.section).emoji;

/** Ciò che compri spesso: contato sulle spese passate, escluso quanto è già da comprare. */
export function recurring(trips: Trip[] | null, list: GroceryList | null | undefined, max = 12) {
  const open = new Set((list?.items || []).filter((i) => !i.checked).map((i) => i.name.toLowerCase().trim()));
  const seen = new Map<string, { item: GroceryItem; count: number; last: number }>();
  for (const t of trips || []) {
    for (const i of t.items) {
      const key = i.name.toLowerCase().trim();
      if (!key || open.has(key)) continue;
      const hit = seen.get(key);
      if (hit) hit.count++;
      else seen.set(key, { item: i, count: 1, last: t.at });
    }
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, max);
}
