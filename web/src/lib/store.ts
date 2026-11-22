import { useCallback, useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import {
  collection, doc, onSnapshot, orderBy, query, setDoc, deleteDoc, updateDoc, serverTimestamp, limit, getDoc, runTransaction,
} from 'firebase/firestore';
import { db, onUser, completeRedirectSignIn } from './firebase';
import type { Embed, GroceryList, Recipe, Trip } from './types';

/**
 * Le ricette salvate dall'app iOS non hanno `status` né `embed`: sono pronte,
 * e il video si ricava dal link del post (i link corti TikTok li risolve il backend).
 */
export function embedFromUrl(url?: string): Embed | undefined {
  if (!url) return undefined;
  const ig = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
  if (ig) return { type: 'instagram', shortcode: ig[1] };
  const tt = url.match(/tiktok\.com\/.*?\/(?:video|photo)\/(\d{8,})/i) || url.match(/[?&]item_id=(\d{8,})/);
  if (tt) return { type: 'tiktok', postId: tt[1] };
  return undefined;
}

function normalize(id: string, data: any): Recipe {
  const r = { id, ...data } as Recipe;
  if (!r.status) r.status = 'ready';
  if (!r.embed) r.embed = embedFromUrl(r.sourceUrl);
  if (!r.platform && r.sourceUrl) r.platform = /tiktok/i.test(r.sourceUrl) ? 'tiktok' : /instagram|instagr\.am/i.test(r.sourceUrl) ? 'instagram' : undefined;
  r.ingredients = r.ingredients || [];
  r.steps = r.steps || [];
  return r;
}
import demoRecipe from './demo.json';

// ---------- Solo in sviluppo: /app/?mock apre l'app con dati finti, senza account ----------
const MOCK = import.meta.env.DEV && (() => {
  try {
    if (new URLSearchParams(location.search).has('mock')) sessionStorage.setItem('cherry.mock', '1');
    return sessionStorage.getItem('cherry.mock') === '1';
  } catch { return false; }
})();
const plate = (n: string) => `/assets/plates/${n}.jpg`;
const base = demoRecipe as unknown as Recipe;
const MOCK_RECIPES: Recipe[] = [
  { ...base, id: 'demo', imageUrl: '/assets/steps/serve.jpg', favorite: true },
  { ...base, id: 'm2', title: 'Crispy Mushroom Tacos', cuisine: 'Mexican', cookMinutes: 25, imageUrl: plate('tacos') },
  { ...base, id: 'm3', title: 'Miso Ramen with Tofu', cuisine: 'Japanese', cookMinutes: 40, imageUrl: plate('ramen') },
  { ...base, id: 'm4', title: 'Smash Burger', cuisine: 'American', cookMinutes: 20, imageUrl: plate('burger') },
  { ...base, id: 'm6', title: 'Salmon (Instagram)', cuisine: 'Japanese', cookMinutes: 15, imageUrl: plate('poke'), sourceUrl: 'https://www.instagram.com/reel/Ddr2zmbSeGj/', platform: 'instagram', embed: { type: 'instagram', shortcode: 'Ddr2zmbSeGj' } },
  { ...base, id: 'm5', title: 'Reading the video…', status: 'importing', importStage: 'watching', imageUrl: null },
];
let mockList: GroceryList | null = null;
const mockListeners = new Set<() => void>();
const mockItem = (name: string, section: string, emoji: string, quantity = '') => ({ id: crypto.randomUUID(), name, quantity, section, emoji, checked: true, recipeIds: [], manual: true });
let mockTrips: Trip[] = [
  { id: 't1', at: Date.now() - 3 * 864e5, recipeIds: ['m2'], items: [mockItem('Milk', 'dairy_eggs', '🥛'), mockItem('Bananas', 'produce', '🍌', '6'), mockItem('Coffee', 'snacks_drinks', '☕'), mockItem('Corn tortillas', 'bakery', '🌮', '12')] },
  { id: 't2', at: Date.now() - 10 * 864e5, recipeIds: [], items: [mockItem('Milk', 'dairy_eggs', '🥛'), mockItem('Bananas', 'produce', '🍌'), mockItem('Eggs', 'dairy_eggs', '🥚', '12'), mockItem('Coffee', 'snacks_drinks', '☕')] },
];


// ---------- Dati in tempo reale, condivisi tra le schermate ----------
// Una sola sottoscrizione per dato, tenuta viva finché l'utente resta lo stesso:
// tornando a una schermata le ricette sono già lì, niente scheletri né foto che ricaricano.

type Feed = { value: any; subs: Set<() => void>; stop: () => void };
const feeds = new Map<string, Feed>();

function feed<T>(key: string, initial: T, start: (set: (v: T) => void) => () => void): Feed {
  let f = feeds.get(key);
  if (!f) {
    const nf: Feed = { value: initial, subs: new Set(), stop: () => {} };
    feeds.set(key, nf);
    nf.stop = start((v) => { nf.value = v; nf.subs.forEach((l) => l()); });
    f = nf;
  }
  return f;
}

function useFeed<T>(key: string | null, initial: T, start: (set: (v: T) => void) => () => void): T {
  const f = key ? feed(key, initial, start) : null;
  const sub = useCallback((l: () => void) => { if (!f) return () => {}; f.subs.add(l); return () => { f.subs.delete(l); }; }, [f]);
  return useSyncExternalStore(sub, () => (f ? (f.value as T) : initial));
}

function resetFeeds() {
  feeds.forEach((f) => f.stop());
  feeds.clear();
}

// ---------- Sessione: utente Firebase + documento utente in tempo reale ----------

type Session = {
  ready: boolean;
  user: User | null;
  doc: Record<string, any> | null;
  entitled: boolean;
};

let session: Session = { ready: false, user: null, doc: null, entitled: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let stopDoc: (() => void) | null = null;

function entitledFrom(d: Record<string, any> | null) {
  if (!d) return false;
  if (['active', 'trialing', 'past_due'].includes(d.stripe?.status)) return true;
  return d.subscription?.status === 'active';
}

let started = false;
export function startSession() {
  if (started) return;
  started = true;
  if (MOCK) {
    session = {
      ready: true, entitled: true,
      user: { uid: 'mock', displayName: 'Jacopo Demo', email: 'demo@example.com', photoURL: null } as unknown as User,
      doc: { stripe: { status: 'active', interval: 'year', customerId: 'cus_mock', currentPeriodEnd: Date.now() + 200 * 864e5 }, webProfile: { household: '2' } },
    };
    return;
  }
  completeRedirectSignIn();
  onUser((user) => {
    if (user?.uid !== session.user?.uid) resetFeeds();
    stopDoc?.();
    stopDoc = null;
    if (!user) {
      session = { ready: true, user: null, doc: null, entitled: false };
      return emit();
    }
    session = { ...session, user, ready: false };
    emit();
    stopDoc = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        const d = snap.exists() ? snap.data() : null;
        session = { ready: true, user, doc: d, entitled: entitledFrom(d) };
        emit();
      },
      () => {
        session = { ready: true, user, doc: null, entitled: false };
        emit();
      },
    );
  });
}

export function useSession() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => session,
  );
}

// ---------- Ricette ----------

export function useRecipes(uid?: string): Recipe[] | null {
  return useFeed<Recipe[] | null>(MOCK ? null : uid ? `recipes:${uid}` : null, MOCK ? MOCK_RECIPES : null, (set) => {
    const q = query(collection(db, 'users', uid!, 'savedRecipes'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      set(snap.docs.map((d) => normalize(d.id, d.data())).filter((r) => !(r as any).preset));
    }, () => set([]));
  });
}

/** Dalla raccolta già in memoria; solo se manca (ricette senza data) la si legge da sola. */
export function useRecipe(uid: string | undefined, id: string): Recipe | null | undefined {
  const all = useRecipes(uid);
  const hit = all?.find((r) => r.id === id);
  const single = useFeed<Recipe | null | undefined>(!MOCK && uid && all && !hit ? `recipe:${uid}:${id}` : null, undefined, (set) =>
    onSnapshot(doc(db, 'users', uid!, 'savedRecipes', id), (snap) => set(snap.exists() ? normalize(snap.id, snap.data()) : null), () => set(null)));
  if (hit) return hit;
  if (!all) return undefined;
  return MOCK ? null : single;
}

export const deleteRecipe = (uid: string, id: string) => MOCK ? Promise.resolve() : deleteDoc(doc(db, 'users', uid, 'savedRecipes', id));
export const setFavorite = (uid: string, id: string, favorite: boolean) =>
  MOCK ? Promise.resolve() : updateDoc(doc(db, 'users', uid, 'savedRecipes', id), { favorite });

// ---------- Lista della spesa (una sola, sempre a portata) ----------

// La lista è privata (users/{uid}/lists/current) finché non la condividi: allora vive in
// sharedLists/{id}, e un puntatore (users/{uid}/lists/share) dice all'app dove guardare.
// Chi ha il link legge e spunta senza account; le regole limitano cosa può cambiare.

let mockShareId: string | null = null;
const mockShared = new Map<string, GroceryList>();
const mockEmit = () => mockListeners.forEach((l) => l());
const mockSub = (l: () => void) => { mockListeners.add(l); return () => { mockListeners.delete(l); }; };

export function useShareId(uid?: string): string | null | undefined {
  const mock = useSyncExternalStore(mockSub, () => mockShareId);
  const live = useFeed<string | null | undefined>(!MOCK && uid ? `share:${uid}` : null, undefined, (set) =>
    onSnapshot(doc(db, 'users', uid!, 'lists', 'share'), (snap) => set((snap.exists() && snap.data().id) || null), () => set(null)));
  return MOCK ? mock : live;
}

/** La lista condivisa, in tempo reale. null = non esiste (più). */
export function useSharedList(id?: string | null): GroceryList | null | undefined {
  const mock = useSyncExternalStore(mockSub, () => (id ? mockShared.get(id) ?? null : null));
  const live = useFeed<GroceryList | null | undefined>(!MOCK && id ? `shared:${id}` : null, undefined, (set) =>
    onSnapshot(doc(db, 'sharedLists', id!), (snap) => set(snap.exists() ? (snap.data() as GroceryList) : null), () => set(null)));
  return MOCK ? mock : live;
}

export function useList(uid?: string): GroceryList | null | undefined {
  const mock = useSyncExternalStore(mockSub, () => mockList);
  const shareId = useShareId(uid);
  const shared = useSharedList(shareId);
  const own = useFeed<GroceryList | null | undefined>(!MOCK && uid && shareId === null ? `list:${uid}` : null, undefined, (set) =>
    onSnapshot(doc(db, 'users', uid!, 'lists', 'current'), (snap) => set(snap.exists() ? (snap.data() as GroceryList) : null), () => set(null)));
  if (shareId) return shared;
  if (MOCK) return mock;
  return shareId === undefined ? undefined : own;
}

/** Cambia subito sullo schermo, poi salva: al supermercato la spunta non deve aspettare la rete. */
function optimistic(key: string, next: GroceryList) {
  const f = feeds.get(key);
  if (f) { f.value = next; f.subs.forEach((l) => l()); }
}

const snapRecipes = (uid: string, ids: string[]) => {
  const all = feeds.get(`recipes:${uid}`)?.value as Recipe[] | null | undefined;
  if (!all) return undefined;
  return ids.map((id) => all.find((r) => r.id === id)).filter(Boolean).map((r) => ({ id: r!.id, title: r!.title, imageUrl: r!.imageUrl || null }));
};

/**
 * Modifica una lista condivisa dentro una transazione: si rilegge l'ultima versione e si
 * applica il cambiamento lì sopra, così due persone che spuntano insieme non si cancellano a vicenda.
 */
export async function editShared(id: string, fn: (l: GroceryList) => GroceryList, extra: Partial<GroceryList> = {}) {
  if (MOCK) {
    const cur = mockShared.get(id);
    if (cur) { mockShared.set(id, { ...cur, ...fn(cur), ...extra }); mockEmit(); }
    return;
  }
  const key = `shared:${id}`;
  const seen = feeds.get(key)?.value as GroceryList | null | undefined;
  if (seen) optimistic(key, { ...seen, ...fn(seen), ...extra });
  const ref = doc(db, 'sharedLists', id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('This list is no longer shared.');
    const next = fn(snap.data() as GroceryList);
    tx.set(ref, { items: next.items, recipeIds: next.recipeIds || [], ...extra, updatedAt: serverTimestamp() }, { merge: true });
  });
}

async function currentShareId(uid: string): Promise<string | null> {
  if (MOCK) return mockShareId;
  const cached = feeds.get(`share:${uid}`)?.value;
  if (cached !== undefined) return cached;
  const snap = await getDoc(doc(db, 'users', uid, 'lists', 'share'));
  return (snap.exists() && snap.data().id) || null;
}

/** L'unico modo di cambiare la lista: riceve la versione più recente e ne restituisce una nuova. */
export async function editList(uid: string, fn: (l: GroceryList) => GroceryList) {
  const shareId = await currentShareId(uid);
  if (shareId) {
    return editShared(shareId, fn, {}).then(async () => {
      const recipes = snapRecipes(uid, (feeds.get(`shared:${shareId}`)?.value as GroceryList | undefined)?.recipeIds || []);
      if (recipes && !MOCK) await updateDoc(doc(db, 'sharedLists', shareId), { recipes }).catch(() => {});
    });
  }
  const empty: GroceryList = { items: [], recipeIds: [] };
  if (MOCK) { mockList = fn(mockList || empty); mockEmit(); return; }
  const key = `list:${uid}`;
  const next = fn((feeds.get(key)?.value as GroceryList | null | undefined) || empty);
  optimistic(key, next);
  return setDoc(doc(db, 'users', uid, 'lists', 'current'), { items: next.items, recipeIds: next.recipeIds || [], updatedAt: serverTimestamp() });
}

/** Sostituisce la lista intera (usato dove il nuovo stato è già calcolato). */
export const saveList = (uid: string, list: GroceryList) => editList(uid, () => list);

const newId = () => {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('').slice(0, 16);
};

/** Mette la lista online: da qui in poi la modificano tutti quelli che hanno il link. */
export async function shareList(uid: string, ownerName: string): Promise<string> {
  const existing = await currentShareId(uid);
  if (existing) return existing;
  const id = newId();
  if (MOCK) {
    mockShared.set(id, { ...(mockList || { items: [], recipeIds: [] }), ownerUid: uid, ownerName, recipes: snapRecipes(uid, mockList?.recipeIds || []) || MOCK_RECIPES.filter((r) => mockList?.recipeIds.includes(r.id)).map((r) => ({ id: r.id, title: r.title, imageUrl: r.imageUrl })) });
    mockShareId = id; mockEmit();
    return id;
  }
  const own = (await getDoc(doc(db, 'users', uid, 'lists', 'current'))).data() as GroceryList | undefined;
  await setDoc(doc(db, 'sharedLists', id), {
    items: own?.items || [], recipeIds: own?.recipeIds || [], recipes: snapRecipes(uid, own?.recipeIds || []) || [],
    ownerUid: uid, ownerName, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'users', uid, 'lists', 'share'), { id });
  return id;
}

/** Riporta la lista in privato: il link smette di funzionare, la lista resta com'è. */
export async function stopSharing(uid: string) {
  const id = await currentShareId(uid);
  if (!id) return;
  if (MOCK) { const l = mockShared.get(id); mockList = l ? { items: l.items, recipeIds: l.recipeIds } : mockList; mockShared.delete(id); mockShareId = null; mockEmit(); return; }
  const snap = await getDoc(doc(db, 'sharedLists', id));
  const l = snap.data() as GroceryList | undefined;
  await setDoc(doc(db, 'users', uid, 'lists', 'current'), { items: l?.items || [], recipeIds: l?.recipeIds || [], updatedAt: serverTimestamp() });
  await deleteDoc(doc(db, 'users', uid, 'lists', 'share'));
  await deleteDoc(doc(db, 'sharedLists', id));
}

export const shareUrl = (id: string) => `${location.origin}${import.meta.env.DEV ? '/app/l/' : '/l/'}${id}`;

// ---------- Spese passate: ciò che hai comprato, per ritrovarlo e ricomprarlo ----------

export function useTrips(uid?: string): Trip[] | null {
  const sub = useCallback((l: () => void) => { mockListeners.add(l); return () => { mockListeners.delete(l); }; }, []);
  const mock = useSyncExternalStore(sub, () => mockTrips);
  const live = useFeed<Trip[] | null>(!MOCK && uid ? `trips:${uid}` : null, null, (set) =>
    onSnapshot(query(collection(db, 'users', uid!, 'trips'), orderBy('at', 'desc'), limit(30)),
      (snap) => set(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Trip)), () => set([])));
  return MOCK ? mock : live;
}

export function saveTrip(uid: string, trip: Omit<Trip, 'id'>) {
  if (MOCK) { mockTrips = [{ ...trip, id: crypto.randomUUID() }, ...mockTrips]; mockListeners.forEach((l) => l()); return Promise.resolve(); }
  return setDoc(doc(collection(db, 'users', uid, 'trips')), trip);
}

export const deleteTrip = (uid: string, id: string) => {
  if (MOCK) { mockTrips = mockTrips.filter((t) => t.id !== id); mockListeners.forEach((l) => l()); return Promise.resolve(); }
  return deleteDoc(doc(db, 'users', uid, 'trips', id));
};

// ---------- Onboarding (prima del login vive sul telefono) ----------

const KEY = 'cherry.onboarding';
export type Answers = Record<string, string | string[]>;

export function loadAnswers(): Answers {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function saveAnswers(a: Answers) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* privato */ }
}

// ---------- Come il modello scrive le ricette: lingua e misure ----------

export type RecipePrefs = { language: string; units: 'us' | 'metric' };
export const LANGUAGES: [string, string, string][] = [
  ['en', 'English', '🇺🇸'], ['it', 'Italiano', '🇮🇹'], ['es', 'Español', '🇪🇸'],
  ['fr', 'Français', '🇫🇷'], ['de', 'Deutsch', '🇩🇪'], ['pt', 'Português', '🇧🇷'],
];

export function recipePrefsOf(d: Record<string, any> | null): RecipePrefs {
  const language = d?.recipePrefs?.language || 'en';
  const units = d?.recipePrefs?.units || (language === 'en' ? 'us' : 'metric');
  return { language, units };
}

export async function setRecipePrefs(uid: string, prefs: Partial<RecipePrefs>) {
  if (MOCK) { session = { ...session, doc: { ...session.doc, recipePrefs: { ...recipePrefsOf(session.doc), ...prefs } } }; emit(); return; }
  const cur = recipePrefsOf(session.doc);
  await setDoc(doc(db, 'users', uid), { recipePrefs: { ...cur, ...prefs } }, { merge: true });
}
