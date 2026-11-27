/**
 * Local storage for device keys and messages.
 *
 * Browser: IndexedDB. Device private keys are non-extractable CryptoKeys
 * stored as-is (IndexedDB can hold them; JavaScript can't read their bytes).
 * Other records are JSON encrypted with AES-256-GCM under a non-extractable
 * key that also lives only in IndexedDB.
 */
import { fromBase64, fromUtf8, randomBytes, toBase64, utf8 } from '../crypto/bytes';
import type { LocalIdentity } from '../crypto/identity';

export interface StoredDevice {
  deviceId: string;
  identity: LocalIdentity;
}

export interface LocalStore {
  loadDevice(account: string): Promise<StoredDevice | null>;
  saveDevice(account: string, device: StoredDevice): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  setJson(key: string, value: unknown): Promise<void>;
  /** Binary data (attachments), encrypted at rest like JSON. */
  getBytes(key: string): Promise<Uint8Array | null>;
  setBytes(key: string, value: Uint8Array): Promise<void>;
  /** Deletes every binary entry whose key starts with `prefix` (a file and its chunks). */
  deleteBytes(prefix: string): Promise<void>;
}

/** In-memory store (tests, or browsers without IndexedDB). */
export class MemoryStore implements LocalStore {
  private devices = new Map<string, StoredDevice>();
  private kv = new Map<string, string>();
  async loadDevice(account: string) {
    return this.devices.get(account) ?? null;
  }
  async saveDevice(account: string, device: StoredDevice) {
    this.devices.set(account, device);
  }
  async getJson<T>(key: string) {
    const v = this.kv.get(key);
    return v ? (JSON.parse(v) as T) : null;
  }
  async setJson(key: string, value: unknown) {
    this.kv.set(key, JSON.stringify(value));
  }
  private bin = new Map<string, Uint8Array>();
  async getBytes(key: string) {
    return this.bin.get(key) ?? null;
  }
  async setBytes(key: string, value: Uint8Array) {
    this.bin.set(key, value);
  }
  async deleteBytes(prefix: string) {
    for (const k of [...this.bin.keys()]) if (k.startsWith(prefix)) this.bin.delete(k);
  }
}

const DB = 'opensocial';
const VERSION = 2;

/**
 * Opening normally takes milliseconds. If another tab keeps an older version
 * open, the browser holds our request (and every later one, queued behind it)
 * until that tab closes: give up after this long with a clear message.
 */
const OPEN_TIMEOUT_MS = 8_000;

export const DB_BLOCKED_MESSAGE =
  'OpenSocial is open in another tab with an older version. Close the other OpenSocial tabs, then reload this page.';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    const timer = setTimeout(() => reject(new Error(DB_BLOCKED_MESSAGE)), OPEN_TIMEOUT_MS);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('devices')) db.createObjectStore('devices');
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      // A newer version (another tab, or deleting the account) needs the
      // database: close ours instead of blocking it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error);
    };
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = f(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbStore implements LocalStore {
  private db: Promise<IDBDatabase> | null = null;
  private key: Promise<CryptoKey> | null = null;

  private conn() {
    return (this.db ??= open().catch((e) => {
      this.db = null; // retry next time
      throw e;
    }));
  }

  /**
   * At-rest key: generated once, non-extractable, kept in IndexedDB. Created
   * with `add`, so if two tabs race, the second one adopts the first one's key
   * instead of overwriting it.
   */
  private aes(): Promise<CryptoKey> {
    return (this.key ??= (async () => {
      const db = await this.conn();
      const existing = await tx<CryptoKey | undefined>(db, 'meta', 'readonly', (s) => s.get('at-rest-key'));
      if (existing) return existing;
      const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      try {
        await tx(db, 'meta', 'readwrite', (s) => s.add(k, 'at-rest-key'));
        return k;
      } catch {
        const winner = await tx<CryptoKey | undefined>(db, 'meta', 'readonly', (s) => s.get('at-rest-key'));
        if (!winner) throw new Error('Could not create the device key.');
        return winner;
      }
    })()).catch((e) => {
      this.key = null; // retry next time (e.g. after the other tab closed)
      throw e;
    });
  }

  async loadDevice(account: string): Promise<StoredDevice | null> {
    const db = await this.conn();
    return (await tx<StoredDevice | undefined>(db, 'devices', 'readonly', (s) => s.get(account))) ?? null;
  }

  async saveDevice(account: string, device: StoredDevice): Promise<void> {
    const db = await this.conn();
    await tx(db, 'devices', 'readwrite', (s) => s.put(device, account));
  }

  async getJson<T>(key: string): Promise<T | null> {
    const db = await this.conn();
    const raw = await tx<string | undefined>(db, 'kv', 'readonly', (s) => s.get(key));
    if (!raw) return null;
    const [iv, ct] = raw.split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv!) }, await this.aes(), fromBase64(ct!));
    return JSON.parse(fromUtf8(new Uint8Array(pt))) as T;
  }

  async getBytes(key: string): Promise<Uint8Array | null> {
    const db = await this.conn();
    const raw = await tx<{ iv: Uint8Array; ct: ArrayBuffer } | undefined>(db, 'files', 'readonly', (s) => s.get(key));
    if (!raw) return null;
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.iv }, await this.aes(), raw.ct));
  }

  async setBytes(key: string, value: Uint8Array): Promise<void> {
    const iv = randomBytes(12);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.aes(), value);
    const db = await this.conn();
    await tx(db, 'files', 'readwrite', (s) => s.put({ iv, ct }, key));
  }

  async deleteBytes(prefix: string): Promise<void> {
    const db = await this.conn();
    await tx(db, 'files', 'readwrite', (s) => s.delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`)));
  }

  async setJson(key: string, value: unknown): Promise<void> {
    const iv = randomBytes(12);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.aes(), utf8(JSON.stringify(value))),
    );
    const db = await this.conn();
    await tx(db, 'kv', 'readwrite', (s) => s.put(`${toBase64(iv)}.${toBase64(ct)}`, key));
  }
}
