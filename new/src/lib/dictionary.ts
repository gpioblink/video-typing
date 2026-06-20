import type { DictionaryEntry } from '../types';

const DB_NAME = 'videoTypingDictionary';
const DB_VERSION = 1;
const STORE_NAME = 'entries';
const NORMALIZED_HEADWORD_INDEX = 'normalizedHeadword';
const MAX_SEARCH_RESULTS = 10;

export interface ParsedDictionaryTsv {
  entries: Array<Pick<DictionaryEntry, 'headword' | 'normalizedHeadword' | 'body'>>;
  skipped: number;
}

export interface DictionaryImportResult {
  imported: number;
  skipped: number;
  total: number;
}

export interface DictionaryImportProgress {
  processed: number;
  totalEntries: number;
  imported: number;
  percent: number;
}

const IMPORT_PROGRESS_INTERVAL = 1000;
const IMPORT_BATCH_SIZE = 5000;

export function normalizeDictionaryHeadword(value: string) {
  return value.trim().toLowerCase();
}

export function parseDictionaryTsv(text: string): ParsedDictionaryTsv {
  const entries: ParsedDictionaryTsv['entries'] = [];
  let skipped = 0;

  for (const line of iterateDictionaryTsvLines(text)) {
    const parsedLine = parseDictionaryTsvLine(line);

    if (!parsedLine) {
      skipped += 1;
      continue;
    }

    entries.push(parsedLine);
  }

  return { entries, skipped };
}

export async function importDictionaryTsv(
  fileName: string,
  text: string,
  onProgress?: (progress: DictionaryImportProgress) => void,
  totalEntriesHint?: number,
  skippedHint?: number,
): Promise<DictionaryImportResult> {
  const db = await openDictionaryDb();
  const importedAt = Date.now();
  const totalEntries = totalEntriesHint ?? countValidDictionaryTsvEntries(text);
  const skipped = skippedHint ?? countSkippedDictionaryTsvEntries(text);
  let imported = 0;
  let processed = 0;
  let batch: DictionaryEntry[] = [];

  onProgress?.({
    processed: 0,
    totalEntries,
    imported: 0,
    percent: totalEntries === 0 ? 100 : 0,
  });

  for (const line of iterateDictionaryTsvLines(text)) {
    const parsedLine = parseDictionaryTsvLine(line);

    if (!parsedLine) {
      continue;
    }

    batch.push({
      ...parsedLine,
      key: createDictionaryEntryKey(parsedLine.normalizedHeadword, parsedLine.body),
      sourceName: fileName,
      importedAt,
    });

    if (batch.length < IMPORT_BATCH_SIZE) {
      continue;
    }

    imported += await importDictionaryBatch(db, batch);
    processed += batch.length;
    batch = [];

    if (shouldReportImportProgress(processed, totalEntries)) {
      onProgress?.(createImportProgress(processed, totalEntries, imported));
    }
  }

  if (batch.length > 0) {
    imported += await importDictionaryBatch(db, batch);
    processed += batch.length;
  }

  db.close();

  onProgress?.(createImportProgress(processed, totalEntries, imported));

  return {
    imported,
    skipped,
    total: await countDictionaryEntries(),
  };
}

export async function countDictionaryEntries() {
  const db = await openDictionaryDb();

  return runTransaction(db, 'readonly', async (store) => {
    return requestToPromise<number>(store.count());
  });
}

export async function searchDictionary(query: string): Promise<DictionaryEntry[]> {
  const normalizedQuery = normalizeDictionaryHeadword(query);

  if (!normalizedQuery) {
    return [];
  }

  const exactMatches = await getEntriesByNormalizedHeadword(normalizedQuery);

  if (exactMatches.length > 0) {
    return exactMatches.slice(0, MAX_SEARCH_RESULTS);
  }

  return getEntriesByHeadwordPrefix(normalizedQuery, MAX_SEARCH_RESULTS);
}

function createDictionaryEntryKey(normalizedHeadword: string, body: string) {
  return `${normalizedHeadword}\u0000${body}`;
}

function countValidDictionaryTsvEntries(text: string) {
  let count = 0;

  for (const line of iterateDictionaryTsvLines(text)) {
    if (parseDictionaryTsvLine(line)) {
      count += 1;
    }
  }

  return count;
}

function countSkippedDictionaryTsvEntries(text: string) {
  let skipped = 0;

  for (const line of iterateDictionaryTsvLines(text)) {
    if (!parseDictionaryTsvLine(line)) {
      skipped += 1;
    }
  }

  return skipped;
}

function shouldReportImportProgress(processed: number, totalEntries: number) {
  return processed === totalEntries || processed % IMPORT_PROGRESS_INTERVAL === 0;
}

function createImportProgress(
  processed: number,
  totalEntries: number,
  imported: number,
): DictionaryImportProgress {
  return {
    processed,
    totalEntries,
    imported,
    percent: totalEntries === 0 ? 100 : Math.min(100, (processed / totalEntries) * 100),
  };
}

function parseDictionaryTsvLine(line: string) {
  if (!line.trim()) {
    return null;
  }

  const tabIndex = line.indexOf('\t');

  if (tabIndex === -1) {
    return null;
  }

  const headword = line.slice(0, tabIndex).trim();
  const body = line.slice(tabIndex + 1).trim();
  const normalizedHeadword = normalizeDictionaryHeadword(headword);

  if (!headword || !body || !normalizedHeadword) {
    return null;
  }

  return {
    headword,
    normalizedHeadword,
    body,
  };
}

function* iterateDictionaryTsvLines(text: string) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  let start = 0;

  for (let index = 0; index <= normalized.length; index += 1) {
    const isLineBreak = index === normalized.length || normalized[index] === '\n';

    if (!isLineBreak) {
      continue;
    }

    yield normalized.slice(start, index);
    start = index + 1;
  }
}

async function importDictionaryBatch(db: IDBDatabase, batch: DictionaryEntry[]) {
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  let imported = 0;

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);

    batch.forEach((entry) => {
      const request = store.add(entry);
      request.onsuccess = () => {
        imported += 1;
      };
      request.onerror = (event) => {
        const isDuplicate = request.error?.name === 'ConstraintError';

        if (isDuplicate) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        reject(request.error);
      };
    });
  });

  return imported;
}
function openDictionaryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: 'key' });

      if (store && !store.indexNames.contains(NORMALIZED_HEADWORD_INDEX)) {
        store.createIndex(NORMALIZED_HEADWORD_INDEX, 'normalizedHeadword', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const transaction = db.transaction(STORE_NAME, mode);
  const store = transaction.objectStore(STORE_NAME);

  try {
    const result = await callback(store);
    await transactionToPromise(transaction);
    return result;
  } finally {
    db.close();
  }
}

function getEntriesByNormalizedHeadword(normalizedHeadword: string) {
  return queryDictionaryIndex(IDBKeyRange.only(normalizedHeadword), MAX_SEARCH_RESULTS);
}

function getEntriesByHeadwordPrefix(prefix: string, limit: number) {
  return queryDictionaryIndex(IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, false), limit);
}

function queryDictionaryIndex(range: IDBKeyRange, limit: number): Promise<DictionaryEntry[]> {
  return openDictionaryDb().then((db) => (
    runTransaction(db, 'readonly', async (store) => {
      const index = store.index(NORMALIZED_HEADWORD_INDEX);
      const results: DictionaryEntry[] = [];

      await new Promise<void>((resolve, reject) => {
        const request = index.openCursor(range);

        request.onsuccess = () => {
          const cursor = request.result;

          if (!cursor || results.length >= limit) {
            resolve();
            return;
          }

          results.push(cursor.value as DictionaryEntry);
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });

      return results;
    })
  ));
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
