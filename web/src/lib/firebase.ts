import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { firebaseApp } from './auth';

export * from './auth';

// Cache locale: la collezione e la lista della spesa si aprono anche
// senza rete (al supermercato capita).
export const db = initializeFirestore(
  firebaseApp,
  { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), ignoreUndefinedProperties: true },
  import.meta.env.VITE_FIRESTORE_DATABASE || '(default)',
);
