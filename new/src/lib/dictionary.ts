import type { DictionaryEntry } from '../types';

export type DictionaryKind = 'english' | 'chinese';

const DB_VERSION = 1;
const STORE_NAME = 'entries';
const NORMALIZED_HEADWORD_INDEX = 'normalizedHeadword';
const MAX_SEARCH_RESULTS = 10;
const IMPORT_PROGRESS_INTERVAL = 1000;
const IMPORT_BATCH_SIZE = 5000;
const MAX_CHINESE_LOOKUP_LENGTH = 39;

const DB_NAMES: Record<DictionaryKind, string> = {
  english: 'videoTypingDictionary',
  chinese: 'videoTypingChineseDictionary',
};

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

export function normalizeDictionaryHeadword(value: string, kind: DictionaryKind = 'english') {
  const trimmed = value.trim();

  return kind === 'english' ? trimmed.toLowerCase() : trimmed;
}

export function parseDictionaryTsv(text: string, kind: DictionaryKind = 'english'): ParsedDictionaryTsv {
  const entries: ParsedDictionaryTsv['entries'] = [];
  let skipped = 0;

  for (const line of iterateDictionaryTsvLines(text)) {
    const parsedLine = parseDictionaryTsvLine(line, kind);

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
  kind: DictionaryKind = 'english',
): Promise<DictionaryImportResult> {
  const db = await openDictionaryDb(kind);
  const importedAt = Date.now();
  const totalEntries = totalEntriesHint ?? countValidDictionaryTsvEntries(text, kind);
  const skipped = skippedHint ?? countSkippedDictionaryTsvEntries(text, kind);
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
    const parsedLine = parseDictionaryTsvLine(line, kind);

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
    total: await countDictionaryEntries(kind),
  };
}

export async function countDictionaryEntries(kind: DictionaryKind = 'english') {
  const db = await openDictionaryDb(kind);

  return runTransaction(db, 'readonly', async (store) => {
    return requestToPromise<number>(store.count());
  });
}

export async function searchDictionary(
  query: string,
  kind: DictionaryKind = 'english',
): Promise<DictionaryEntry[]> {
  const normalizedQuery = normalizeDictionaryHeadword(query, kind);

  if (!normalizedQuery) {
    return [];
  }

  const exactMatches = await getEntriesByNormalizedHeadword(normalizedQuery, kind);

  if (exactMatches.length > 0) {
    return exactMatches.slice(0, MAX_SEARCH_RESULTS);
  }

  return getEntriesByHeadwordPrefix(normalizedQuery, MAX_SEARCH_RESULTS, kind);
}

export async function searchChineseDictionary(
  query: string,
  contextText = '',
): Promise<DictionaryEntry[]> {
  const normalizedQuery = normalizeDictionaryHeadword(query, 'chinese');

  if (normalizedQuery) {
    const exactMatches = await getEntriesByNormalizedHeadword(normalizedQuery, 'chinese');

    if (exactMatches.length > 0) {
      return exactMatches.slice(0, MAX_SEARCH_RESULTS);
    }
  }

  const candidates = createChineseLookupCandidates(normalizedQuery, contextText);
  const seenKeys = new Set<string>();
  const results: DictionaryEntry[] = [];

  for (const candidate of candidates) {
    const entries = await getEntriesByNormalizedHeadword(candidate, 'chinese');

    for (const entry of entries) {
      if (seenKeys.has(entry.key)) {
        continue;
      }

      seenKeys.add(entry.key);
      results.push(entry);

      if (results.length >= MAX_SEARCH_RESULTS) {
        return results;
      }
    }
  }

  return results;
}

function createDictionaryEntryKey(normalizedHeadword: string, body: string) {
  return `${normalizedHeadword}\u0000${body}`;
}

function countValidDictionaryTsvEntries(text: string, kind: DictionaryKind) {
  let count = 0;

  for (const line of iterateDictionaryTsvLines(text)) {
    if (parseDictionaryTsvLine(line, kind)) {
      count += 1;
    }
  }

  return count;
}

function countSkippedDictionaryTsvEntries(text: string, kind: DictionaryKind) {
  let skipped = 0;

  for (const line of iterateDictionaryTsvLines(text)) {
    if (!parseDictionaryTsvLine(line, kind)) {
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

function parseDictionaryTsvLine(line: string, kind: DictionaryKind) {
  if (!line.trim()) {
    return null;
  }

  const tabIndex = line.indexOf('\t');

  if (tabIndex === -1) {
    return null;
  }

  const headword = line.slice(0, tabIndex).trim();
  const rawBody = line.slice(tabIndex + 1).trim();
  const body = kind === 'chinese' ? rawBody.replace(/\\n/g, '\n') : rawBody;
  const normalizedHeadword = normalizeDictionaryHeadword(headword, kind);

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

function createChineseLookupCandidates(query: string, contextText: string) {
  const cleanedContext = removeBracketedCaptionText(contextText).replace(/\s+/g, '');
  const candidateTexts = query && cleanedContext.includes(query)
    ? [query, cleanedContext]
    : [cleanedContext, query];
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const text of candidateTexts) {
    const normalizedText = normalizeDictionaryHeadword(text, 'chinese');

    if (!normalizedText) {
      continue;
    }

    const queryIndex = query ? normalizedText.indexOf(query) : -1;
    const preferredStarts = queryIndex >= 0
      ? [queryIndex, ...createNumberRange(0, normalizedText.length).filter((index) => index !== queryIndex)]
      : createNumberRange(0, normalizedText.length);

    for (const start of preferredStarts) {
      const maxLength = Math.min(MAX_CHINESE_LOOKUP_LENGTH, normalizedText.length - start);

      for (let length = maxLength; length >= 1; length -= 1) {
        const candidate = normalizedText.slice(start, start + length);

        if (!candidate || seen.has(candidate) || !hasChineseIdeograph(candidate)) {
          continue;
        }

        seen.add(candidate);
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

function hasChineseIdeograph(text: string) {
  return /[\u3400-\u9fff]/u.test(text);
}

function removeBracketedCaptionText(text: string) {
  return text.replace(
    /\[[^\]\r\n]*\]|【[^】\r\n]*】|\([^\)\r\n]*\)|（[^）\r\n]*）/g,
    '',
  );
}

function createNumberRange(start: number, endExclusive: number) {
  const values: number[] = [];

  for (let value = start; value < endExclusive; value += 1) {
    values.push(value);
  }

  return values;
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

function openDictionaryDb(kind: DictionaryKind): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAMES[kind], DB_VERSION);

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

function getEntriesByNormalizedHeadword(normalizedHeadword: string, kind: DictionaryKind) {
  return queryDictionaryIndex(IDBKeyRange.only(normalizedHeadword), MAX_SEARCH_RESULTS, kind);
}

function getEntriesByHeadwordPrefix(prefix: string, limit: number, kind: DictionaryKind) {
  return queryDictionaryIndex(IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, false), limit, kind);
}

function queryDictionaryIndex(
  range: IDBKeyRange,
  limit: number,
  kind: DictionaryKind,
): Promise<DictionaryEntry[]> {
  return openDictionaryDb(kind).then((db) => (
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
