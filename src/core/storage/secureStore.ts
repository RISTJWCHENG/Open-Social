/**
 * Small encrypted key/value store for secrets and private data that used to
 * sit in localStorage (login session, Sia app key, profile cache, profile
 * key). Values are AES-256-GCM encrypted in IndexedDB under a non-extractable
 * key that also lives only in IndexedDB. Falls back to memory without
 * IndexedDB (tests, private modes that block it).
 */
import { IndexedDbStore, MemoryStore, type LocalStore } from '../delivery/localStore';

let store: LocalStore | null = null;

export function secureStore(): LocalStore {
  return (store ??= typeof indexedDB !== 'undefined' ? new IndexedDbStore() : new MemoryStore());
}

export const secureGet = <T>(key: string) => secureStore().getJson<T>(key);
export const secureSet = (key: string, value: unknown) => secureStore().setJson(key, value);
export const secureDelete = (key: string) => secureStore().setJson(key, null);

/** Removes every OpenSocial database and setting on this device. */
export async function wipeDevice(): Promise<void> {
  store = null;
  try {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith('opensocial:')) window.localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('opensocial');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
