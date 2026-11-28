export type Ingredient = {
  name: string;
  quantity?: string;
  storeSection?: string;
  costUsd?: number;
  emoji?: string;
};

export type Segment = { start: number; end: number; title?: string; steps: number[]; ingredients: number[] };

export type Embed =
  | { type: 'tiktok'; postId: string }
  | { type: 'instagram'; shortcode: string }
  /** Un video caricato da te (ricette scritte a mano). */
  | { type: 'file'; url: string };

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
  /** Instagram: per ogni step 1–4 fotogrammi dal video (prima, durante, dopo), al posto del loop. */
  stepFrames?: { step: number; frames: { url: string; caption: string }[] }[] | null;
  imageUrl?: string | null;
  createdAt?: { toMillis(): number } | null;
  favorite?: boolean;
  /** 'manual' = scritta a mano nell'app. */
  origin?: string;
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

export type GroceryList = {
  items: GroceryItem[];
  recipeIds: string[];
  updatedAt?: unknown;
  /** Solo sulle liste condivise: chi l'ha creata e le ricette, per chi apre il link senza account. */
  ownerUid?: string;
  ownerName?: string;
  recipes?: { id: string; title: string; imageUrl?: string | null }[];
};

/** Una spesa fatta: gli articoli spuntati, archiviati quando chiudi la spesa. */
export type Trip = { id: string; at: number; items: GroceryItem[]; recipeIds: string[] };

/** Una categoria del ricettario, creata da te. */
export type Category = { id: string; name: string; emoji?: string; recipeIds: string[]; createdAt?: number };
