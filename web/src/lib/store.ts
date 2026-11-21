import { useCallback, useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import {
  collection, doc, onSnapshot, orderBy, query, setDoc, deleteDoc, updateDoc, serverTimestamp, limit,
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

export function useList(uid?: string): GroceryList | null | undefined {
  const sub = useCallback((l: () => void) => { mockListeners.add(l); return () => { mockListeners.delete(l); }; }, []);
  const mock = useSyncExternalStore(sub, () => mockList);
  const live = useFeed<GroceryList | null | undefined>(!MOCK && uid ? `list:${uid}` : null, undefined, (set) =>
    onSnapshot(doc(db, 'users', uid!, 'lists', 'current'), (snap) => set(snap.exists() ? (snap.data() as GroceryList) : null), () => set(null)));
  return MOCK ? mock : live;
}

export const saveList = (uid: string, list: GroceryList) =>
  MOCK ? (mockList = list, mockListeners.forEach((l) => l()), Promise.resolve()) : setDoc(doc(db, 'users', uid, 'lists', 'current'), { ...list, updatedAt: serverTimestamp() });

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
