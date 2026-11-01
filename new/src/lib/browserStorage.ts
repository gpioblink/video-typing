/** Persistence for the shared UI. Extension data stays in chrome.storage;
 * a normal web page uses only its own origin's localStorage. */
const WEB_STORAGE_PREFIX = 'video-typing:web:v1:';
const memory = new Map<string, string | null>();
const pendingWrites = new Set<string>();

export interface LocalStorageArea {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
}

export function hasExtensionRuntime(): boolean {
  return typeof chrome !== 'undefined'
    && typeof chrome.runtime?.id === 'string'
    && chrome.runtime.id.length > 0;
}

function readBrowserValue(key: string): unknown {
  let raw: string | null;
  if (pendingWrites.has(key)) {
    raw = memory.get(key) ?? null;
  } else {
    try {
      raw = globalThis.localStorage.getItem(WEB_STORAGE_PREFIX + key);
      memory.set(key, raw);
    } catch {
      raw = memory.get(key) ?? null;
    }
  }
  if (raw === null) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

function writeBrowserValue(key: string, raw: string | null) {
  memory.set(key, raw);
  try {
    if (raw === null) globalThis.localStorage.removeItem(WEB_STORAGE_PREFIX + key);
    else globalThis.localStorage.setItem(WEB_STORAGE_PREFIX + key, raw);
    pendingWrites.delete(key);
  } catch {
    // Storage can be disabled or full. Keep this session usable without
    // pretending that another origin or the extension shares its storage.
    pendingWrites.add(key);
  }
}

export const localStorageArea: LocalStorageArea = {
  async get(keys) {
    if (hasExtensionRuntime()) return chrome.storage.local.get(keys);
    const result: Array<[string, unknown]> = [];
    for (const key of typeof keys === 'string' ? [keys] : keys) {
      const value = readBrowserValue(key);
      if (value !== undefined) result.push([key, value]);
    }
    return Object.fromEntries(result);
  },
  async set(values) {
    if (hasExtensionRuntime()) return chrome.storage.local.set(values);
    for (const [key, value] of Object.entries(values)) {
      writeBrowserValue(key, JSON.stringify(value) ?? null);
    }
  },
  async remove(keys) {
    if (hasExtensionRuntime()) return chrome.storage.local.remove(keys);
    for (const key of typeof keys === 'string' ? [keys] : keys) writeBrowserValue(key, null);
  },
};
