import { type FingerprintKind, GROWTH_VERSION, N } from "./growth";

/**
 * Each print is grown once per Mac: its U and V, quantized to 16 bits, kept
 * by seed, kind and growth version. The drawing always reads the quantized
 * values, fresh or cached, so a print looks the same on its first day and
 * every day after.
 */

export function fingerprintCacheKey(seed: number, kind: FingerprintKind) {
  return `v${GROWTH_VERSION}:${seed >>> 0}:${kind}`;
}

/** Interleaved U, V in [0, 1] → 16-bit steps. */
export function quantizeUV(uv: Float32Array): Uint16Array {
  const out = new Uint16Array(uv.length);
  for (let i = 0; i < uv.length; i++) {
    out[i] = Math.round(Math.min(1, Math.max(0, uv[i])) * 65535);
  }
  return out;
}

export function dequantizeUV(q: Uint16Array): Float32Array {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] / 65535;
  return out;
}

export interface FingerprintStore {
  get(key: string): Promise<Uint16Array | null>;
  put(key: string, value: Uint16Array): Promise<void>;
}

/** A print's stored shape is checked before it is trusted. */
export function isStoredPrint(value: unknown): value is Uint16Array {
  return value instanceof Uint16Array && value.length === N * N * 2;
}

export class MemoryFingerprintStore implements FingerprintStore {
  private readonly prints = new Map<string, Uint16Array>();

  async get(key: string) {
    const value = this.prints.get(key);
    return value ? value.slice() : null;
  }

  async put(key: string, value: Uint16Array) {
    this.prints.set(key, value.slice());
  }
}

const DB_NAME = "luca-agent-fingerprints";
const STORE = "prints";

/** IndexedDB, this origin's own; any failure reads as a miss. */
export class IndexedDbFingerprintStore implements FingerprintStore {
  private db: Promise<IDBDatabase | null> | null = null;

  private open(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.db;
  }

  async get(key: string): Promise<Uint16Array | null> {
    const db = await this.open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const request = db.transaction(STORE).objectStore(STORE).get(key);
        request.onsuccess = () =>
          resolve(isStoredPrint(request.result) ? request.result : null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async put(key: string, value: Uint16Array): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

/** The store a browser offers: IndexedDB where it exists, else memory. */
export function defaultFingerprintStore(): FingerprintStore {
  return typeof indexedDB === "undefined"
    ? new MemoryFingerprintStore()
    : new IndexedDbFingerprintStore();
}
