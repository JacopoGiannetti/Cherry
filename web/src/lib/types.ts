export type Ingredient = {
  name: string;
  quantity?: string;
  storeSection?: string;
  costUsd?: number;
  emoji?: string;
};

export type Segment = { start: number; end: number; title?: string; steps: number[]; ingredients: number[] };

export type Embed = { type: 'tiktok'; postId: string } | { type: 'instagram'; shortcode: string };

export type Recipe = {
  id: string;
  title: string;
  status?: 'importing' | 'ready' | 'failed';
  importStage?: 'reading' | 'watching' | 'done';
  error?: string;
  sourceUrl?: string;
  platform?: 'tiktok' | 'instagram' | string;
  embed?: Embed;
  cuisine?: string | null;
  servings?: number;
  cookMinutes?: number;
  costUsd?: number;
  ingredients: Ingredient[];
  steps: string[];
  segments?: Segment[] | null;
  imageUrl?: string | null;
  createdAt?: { toMillis(): number } | null;
  favorite?: boolean;
};

export type GroceryItem = {
  id: string;
  name: string;
  quantity: string;
  section: string;
  emoji?: string;
  checked: boolean;
  recipeIds: string[];
  manual?: boolean;
};

export type GroceryList = { items: GroceryItem[]; recipeIds: string[]; updatedAt?: unknown };

/** Una spesa fatta: gli articoli spuntati, archiviati quando chiudi la spesa. */
export type Trip = { id: string; at: number; items: GroceryItem[]; recipeIds: string[] };
