import { countDictionaryEntries, importDictionaryTsv, type DictionaryImportResult } from './dictionary';

export const DEFAULT_DICTIONARY = {
  name: 'EJDict-hand',
  url: './dictionaries/ejdict-2dd9e71.tsv',
  sourceName: 'EJDict-hand@2dd9e71ffcefce89b4d946ce07bf51fa0573aac0',
  sourceUrl: 'https://github.com/kujirahand/EJDict/tree/2dd9e71ffcefce89b4d946ce07bf51fa0573aac0',
  license: 'CC0 1.0',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  bytes: 4_499_966,
  entries: 46_916,
  sha256: '1a4888c1c4777b296c6519622a7b68712a10d7069d330c9895de7a83fcad4cf7',
} as const;

const PENDING_IMPORT_KEY = 'videoTypingDefaultDictionaryPending';
const IMPORT_LOCK = 'video-typing-default-english-dictionary';

export interface DefaultDictionaryResult {
  status: 'imported' | 'existing';
  count: number;
}

interface DefaultDictionaryDependencies {
  count: () => Promise<number>;
  import: (sourceName: string, text: string) => Promise<DictionaryImportResult>;
  fetch: typeof globalThis.fetch;
  recover: () => Promise<void>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  withLock: (work: () => Promise<DefaultDictionaryResult>) => Promise<DefaultDictionaryResult>;
}

function optionalStorage() {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** The existing importer commits in batches. On failure, remove only entries
 * stamped with this exact bundled source; never clear a user's dictionary.
 * This is recovery for the existing English DB schema, not another importer. */
async function removeIncompleteDefaultImport(): Promise<void> {
  const db = await new Promise<IDBDatabase | undefined>((resolve, reject) => {
    let absent = false;
    const request = indexedDB.open('videoTypingDictionary');
    // If browser storage was cleared but the marker survived, do not create an
    // empty version-1 DB without the schema owned by dictionary.ts.
    request.onupgradeneeded = () => { absent = true; request.transaction?.abort(); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => absent ? resolve(undefined) : reject(request.error);
  });
  if (!db) return;
  try {
    if (!db.objectStoreNames.contains('entries')) return;
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('entries', 'readwrite');
      const request = transaction.objectStore('entries').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.value?.sourceName === DEFAULT_DICTIONARY.sourceName) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('辞書の復旧を中止しました。'));
    });
  } finally { db.close(); }
}

async function browserLock(work: () => Promise<DefaultDictionaryResult>): Promise<DefaultDictionaryResult> {
  return typeof navigator !== 'undefined' && navigator.locks
    ? await navigator.locks.request(IMPORT_LOCK, work) : await work();
}

/** Factory keeps lifecycle tests independent of IndexedDB/browser globals. */
export function createDefaultDictionaryInitializer(overrides: Partial<DefaultDictionaryDependencies> = {}) {
  const dependencies: DefaultDictionaryDependencies = {
    count: () => countDictionaryEntries('english'),
    import: (name, text) => importDictionaryTsv(name, text, undefined, DEFAULT_DICTIONARY.entries, undefined, 'english'),
    fetch: (...args) => globalThis.fetch(...args),
    recover: removeIncompleteDefaultImport,
    storage: optionalStorage(),
    withLock: browserLock,
    ...overrides,
  };
  const marker = {
    get: () => { try { return dependencies.storage?.getItem(PENDING_IMPORT_KEY); } catch { return undefined; } },
    set: () => { try { dependencies.storage?.setItem(PENDING_IMPORT_KEY, DEFAULT_DICTIONARY.sourceName); } catch { /* Count remains the reload guard. */ } },
    clear: () => { try { dependencies.storage?.removeItem(PENDING_IMPORT_KEY); } catch { /* Optional recovery metadata. */ } },
  };
  let pending: Promise<DefaultDictionaryResult> | undefined;
  const initialize = async (): Promise<DefaultDictionaryResult> => {
    // An interrupted tab may have left a partial batch. Recover only our own
    // source entries, then honor any custom dictionary the user has imported.
    if (marker.get() === DEFAULT_DICTIONARY.sourceName) {
      await dependencies.recover();
      marker.clear();
    }
    const count = await dependencies.count();
    if (count > 0) return { status: 'existing', count };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let text: string;
    try {
      const response = await dependencies.fetch(DEFAULT_DICTIONARY.url, { signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error('標準辞書を読み込めませんでした。もう一度お試しください。');
      if (Number(response.headers.get('content-length')) > DEFAULT_DICTIONARY.bytes) throw new Error('標準辞書のサイズが正しくありません。');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== DEFAULT_DICTIONARY.bytes) throw new Error('標準辞書のサイズが正しくありません。');
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== DEFAULT_DICTIONARY.sha256) throw new Error('標準辞書の内容を確認できませんでした。');
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } finally { clearTimeout(timer); }
    // A user can import their preferred dictionary while the asset downloads.
    const latestCount = await dependencies.count();
    if (latestCount > 0) return { status: 'existing', count: latestCount };
    marker.set();
    try {
      const result = await dependencies.import(DEFAULT_DICTIONARY.sourceName, text);
      if (result.imported !== DEFAULT_DICTIONARY.entries) throw new Error('標準辞書の取り込みを完了できませんでした。');
      marker.clear();
      return { status: 'imported', count: result.total };
    } catch (error) {
      // Keep the marker if recovery itself fails so a later call can retry it.
      await dependencies.recover();
      marker.clear();
      throw error;
    }
  };
  return function ensureDefaultDictionary(): Promise<DefaultDictionaryResult> {
    if (!pending) pending = dependencies.withLock(initialize).finally(() => { pending = undefined; });
    return pending;
  };
}

/** Called by the Web demo only. An existing English dictionary always wins. */
export const ensureDefaultDictionary = createDefaultDictionaryInitializer();
