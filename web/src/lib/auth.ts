import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut as fbSignOut, type User,
} from 'firebase/auth';

// Solo app + login: la landing lo usa per "Sign in" senza portarsi dietro Firestore.
const env = import.meta.env;

export const firebaseApp = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID || undefined,
});

export const auth = getAuth(firebaseApp);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

/** Le app installate sulla Home (standalone) gestiscono male i popup: lì si usa il redirect. */
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

/** Popup di Google. Va chiamato dentro il tocco, senza await prima, o il browser lo blocca. */
export function signInWithGooglePopup() {
  return signInWithPopup(auth, provider);
}

export async function signInWithGoogle() {
  if (isStandalone()) return signInWithRedirect(auth, provider);
  try {
    return await signInWithPopup(auth, provider);
  } catch (e: any) {
    if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}

export function completeRedirectSignIn() {
  return getRedirectResult(auth).catch(() => null);
}

export function onUser(cb: (u: User | null) => void) {
  return onAuthStateChanged(auth, cb);
}

export const signOut = () => fbSignOut(auth);
