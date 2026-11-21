import { useEffect, useState, useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import {
  collection, doc, onSnapshot, orderBy, query, setDoc, deleteDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db, onUser, completeRedirectSignIn } from './firebase';
import type { Embed, GroceryList, Recipe } from './types';

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

export function useRecipes(uid?: string) {
  const [recipes, setRecipes] = useState<Recipe[] | null>(MOCK ? MOCK_RECIPES : null);
  useEffect(() => {
    if (!uid || MOCK) return;
    const q = query(collection(db, 'users', uid, 'savedRecipes'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snap) => {
      setRecipes(snap.docs.map((d) => normalize(d.id, d.data())).filter((r) => !(r as any).preset));
    }, () => setRecipes([]));
  }, [uid]);
  return recipes;
}

export function useRecipe(uid: string | undefined, id: string) {
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(MOCK ? (MOCK_RECIPES.find((r) => r.id === id) || null) : undefined);
  useEffect(() => {
    if (!uid || MOCK) return;
    return onSnapshot(doc(db, 'users', uid, 'savedRecipes', id), (snap) => {
      setRecipe(snap.exists() ? normalize(snap.id, snap.data()) : null);
    }, () => setRecipe(null));
  }, [uid, id]);
  return recipe;
}

export const deleteRecipe = (uid: string, id: string) => MOCK ? Promise.resolve() : deleteDoc(doc(db, 'users', uid, 'savedRecipes', id));
export const setFavorite = (uid: string, id: string, favorite: boolean) =>
  MOCK ? Promise.resolve() : updateDoc(doc(db, 'users', uid, 'savedRecipes', id), { favorite });

// ---------- Lista della spesa (una sola, sempre a portata) ----------

export function useList(uid?: string) {
  const [list, setList] = useState<GroceryList | null | undefined>(MOCK ? mockList : undefined);
  useEffect(() => {
    if (MOCK) { const l = () => setList(mockList); mockListeners.add(l); return () => { mockListeners.delete(l); }; }
    if (!uid) return;
    return onSnapshot(doc(db, 'users', uid, 'lists', 'current'), (snap) => {
      setList(snap.exists() ? (snap.data() as GroceryList) : null);
    }, () => setList(null));
  }, [uid]);
  return list;
}

export const saveList = (uid: string, list: GroceryList) =>
  MOCK ? (mockList = list, mockListeners.forEach((l) => l()), Promise.resolve()) : setDoc(doc(db, 'users', uid, 'lists', 'current'), { ...list, updatedAt: serverTimestamp() });

// ---------- Onboarding (prima del login vive sul telefono) ----------

const KEY = 'cherry.onboarding';
export type Answers = Record<string, string | string[]>;

export function loadAnswers(): Answers {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function saveAnswers(a: Answers) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* privato */ }
}
