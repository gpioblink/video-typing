import type { DictionaryEntry } from '../types';

export type DictionaryKind = 'english' | 'chinese';

const DB_VERSION = 1;
const STORE_NAME = 'entries';
const NORMALIZED_HEADWORD_INDEX = 'normalizedHeadword';
const MAX_SEARCH_RESULTS = 10;
const IMPORT_PROGRESS_INTERVAL = 1000;
const IMPORT_BATCH_SIZE = 5000;
const MAX_CHINESE_LOOKUP_LENGTH = 39;
const ENGLISH_LOOKUP_TOKEN_PATTERN = /\$?\d+(?:[.,]\d+)?(?:st|nd|rd|th|%)?|[a-z]+(?:['-][a-z]+)*/gi;
const ENGLISH_IRREGULAR_LEMMAS: Record<string, string> = {
  am: 'be',
  are: 'be',
  been: 'be',
  did: 'do',
  does: 'do',
  done: 'do',
  gave: 'give',
  given: 'give',
  got: 'get',
  gotten: 'get',
  had: 'have',
  has: 'have',
  made: 'make',
  makes: 'make',
  saw: 'see',
  seen: 'see',
  took: 'take',
  taken: 'take',
  was: 'be',
  were: 'be',
  went: 'go',
  gone: 'go',
  worse: 'bad',
  worst: 'bad',
  better: 'good',
  best: 'good',
  children: 'child',
  men: 'man',
  women: 'woman',
  people: 'person',
  mice: 'mouse',
  feet: 'foot',
  teeth: 'tooth',
};

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
  contextText = '',
): Promise<DictionaryEntry[]> {
  const normalizedQuery = normalizeDictionaryHeadword(query, kind);

  if (!normalizedQuery) {
    return [];
  }

  if (kind === 'english' && contextText.trim()) {
    const contextMatches = await searchEnglishContextDictionary(normalizedQuery, contextText);

    if (contextMatches.length > 0) {
      return contextMatches;
    }
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

async function searchEnglishContextDictionary(
  normalizedQuery: string,
  contextText: string,
): Promise<DictionaryEntry[]> {
  const candidateGroups = createEnglishLookupCandidateGroups(normalizedQuery, contextText);

  for (const candidates of candidateGroups) {
    const groupResults: DictionaryEntry[] = [];
    const seenKeys = new Set<string>();

    for (const candidate of candidates) {
      const entries = await getEntriesByNormalizedHeadword(candidate, 'english');

      for (const entry of entries) {
        if (seenKeys.has(entry.key)) {
          continue;
        }

        seenKeys.add(entry.key);
        groupResults.push(entry);

        if (groupResults.length >= MAX_SEARCH_RESULTS) {
          return groupResults;
        }
      }
    }

    if (groupResults.length > 0) {
      return groupResults;
    }
  }

  return [];
}

function createEnglishLookupCandidateGroups(query: string, contextText: string) {
  const contextTokens = tokenizeEnglishLookupText(contextText);
  const queryTokens = tokenizeEnglishLookupText(query);

  if (contextTokens.length === 0) {
    return [];
  }

  const groups: string[][] = [];

  for (let length = contextTokens.length; length >= 1; length -= 1) {
    const ngrams = createEnglishNgrams(contextTokens, length, queryTokens);
    const candidates: string[] = [];
    const seen = new Set<string>();

    for (const ngram of ngrams) {
      for (const candidate of createEnglishPhraseCandidates(ngram)) {
        const normalizedCandidate = normalizeDictionaryHeadword(candidate, 'english');

        if (!normalizedCandidate || seen.has(normalizedCandidate)) {
          continue;
        }

        seen.add(normalizedCandidate);
        candidates.push(normalizedCandidate);
      }
    }

    if (candidates.length > 0) {
      groups.push(candidates);
    }
  }

  return groups;
}

function tokenizeEnglishLookupText(text: string) {
  const cleanedText = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[[^\]\r\n]*\]|\([^\)\r\n]*\)|【[^】\r\n]*】|（[^）\r\n]*）/g, ' ');
  const tokens: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = ENGLISH_LOOKUP_TOKEN_PATTERN.exec(cleanedText)) !== null) {
    tokens.push(match[0].replace(/,/g, '').toLowerCase());
  }

  return tokens;
}

function createEnglishNgrams(
  tokens: string[],
  length: number,
  queryTokens: string[],
) {
  const preferred: string[][] = [];
  const fallback: string[][] = [];

  for (let start = 0; start + length <= tokens.length; start += 1) {
    const ngram = tokens.slice(start, start + length);
    const includesQuery = queryTokens.length > 0 && containsTokenSequence(ngram, queryTokens);

    if (includesQuery) {
      preferred.push(ngram);
    } else {
      fallback.push(ngram);
    }
  }

  return preferred.length > 0 ? [...preferred, ...fallback] : fallback;
}

function containsTokenSequence(tokens: string[], sequence: string[]) {
  if (sequence.length === 0 || sequence.length > tokens.length) {
    return false;
  }

  for (let start = 0; start + sequence.length <= tokens.length; start += 1) {
    const matches = sequence.every((token, index) => tokens[start + index] === token);

    if (matches) {
      return true;
    }
  }

  return false;
}

function createEnglishPhraseCandidates(tokens: string[]) {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const sourceTokenSets = [tokens, ...createEnglishLemmaTokenLists(tokens)];

  for (const sourceTokens of sourceTokenSets) {
    addEnglishPhraseCandidate(candidates, seen, sourceTokens);
  }

  for (const sourceTokens of sourceTokenSets) {
    for (const placeholderTokens of createNumberPlaceholderTokenLists(sourceTokens)) {
      addEnglishPhraseCandidate(candidates, seen, placeholderTokens);
    }
  }

  for (const sourceTokens of sourceTokenSets) {
    for (const placeholder of ['~', 'someone']) {
      for (const placeholderTokens of createRangePlaceholderTokenLists(sourceTokens, placeholder)) {
        addEnglishPhraseCandidate(candidates, seen, placeholderTokens);
      }
    }
  }

  return candidates;
}

function addEnglishPhraseCandidate(candidates: string[], seen: Set<string>, tokens: string[]) {
  const candidate = tokens.join(' ').trim();

  if (!candidate || seen.has(candidate)) {
    return;
  }

  seen.add(candidate);
  candidates.push(candidate);
}

function areTokenListsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

function getPreferredEnglishLemma(token: string) {
  return createEnglishInflectionCandidates(token)[0] || token;
}

function createEnglishLemmaTokenLists(tokens: string[]) {
  const candidates: string[][] = [];
  const seen = new Set<string>();
  const addTokens = (nextTokens: string[]) => {
    if (areTokenListsEqual(tokens, nextTokens)) {
      return;
    }

    const key = nextTokens.join('\u0000');

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push(nextTokens);
  };

  tokens.forEach((token, index) => {
    for (const lemma of createEnglishInflectionCandidates(token)) {
      const nextTokens = [...tokens];
      nextTokens[index] = lemma;
      addTokens(nextTokens);
    }
  });

  addTokens(tokens.map(getPreferredEnglishLemma));

  return candidates;
}

function createEnglishInflectionCandidates(token: string) {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (candidate: string) => {
    if (!candidate || candidate === token || seen.has(candidate)) {
      return;
    }

    seen.add(candidate);
    candidates.push(candidate);
  };

  addCandidate(ENGLISH_IRREGULAR_LEMMAS[token]);

  if (!/^[a-z][a-z'-]*$/.test(token) || token.length <= 3) {
    return candidates;
  }

  if (token.endsWith('iest') && token.length > 5) {
    addCandidate(`${token.slice(0, -4)}y`);
  } else if (token.endsWith('ier') && token.length > 4) {
    addCandidate(`${token.slice(0, -3)}y`);
  } else if (token.endsWith('est') && token.length > 5) {
    addCandidate(token.slice(0, -3));
    addCandidate(`${token.slice(0, -3)}e`);
  } else if (token.endsWith('er') && token.length > 4) {
    addCandidate(token.slice(0, -2));
    addCandidate(`${token.slice(0, -2)}e`);
  }

  if (token.endsWith('ies') && token.length > 4) {
    addCandidate(`${token.slice(0, -3)}y`);
  } else if (/[cs]hes$|xes$|zes$|oes$|sses$/.test(token)) {
    addCandidate(token.slice(0, -2));
  } else if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) {
    addCandidate(token.slice(0, -1));
  }

  if (token.endsWith('ied') && token.length > 4) {
    addCandidate(`${token.slice(0, -3)}y`);
  } else if (token.endsWith('ed') && token.length > 4) {
    const stem = token.slice(0, -2);
    addCandidate(stem);
    addCandidate(`${stem}e`);
    addCandidate(removeDoubledFinalConsonant(stem));
  }

  if (token.endsWith('ing') && token.length > 5) {
    const stem = token.slice(0, -3);
    addCandidate(stem);
    addCandidate(`${stem}e`);
    addCandidate(removeDoubledFinalConsonant(stem));
  }

  return candidates;
}

function removeDoubledFinalConsonant(value: string) {
  if (value.length < 2) {
    return value;
  }

  const last = value[value.length - 1];
  const previous = value[value.length - 2];

  if (last === previous && /[bcdfghjklmnpqrstvwxyz]/.test(last)) {
    return value.slice(0, -1);
  }

  return value;
}

function createNumberPlaceholderTokenLists(tokens: string[]) {
  const placeholderTokens = tokens.map((token) => getNumberPlaceholderToken(token) || token);

  if (areTokenListsEqual(tokens, placeholderTokens)) {
    return [];
  }

  const candidates = [placeholderTokens];

  for (let index = 0; index < tokens.length; index += 1) {
    const placeholder = getNumberPlaceholderToken(tokens[index]);

    if (!placeholder) {
      continue;
    }

    const nextTokens = [...tokens];
    nextTokens[index] = placeholder;
    candidates.push(nextTokens);
  }

  return candidates;
}

function getNumberPlaceholderToken(token: string) {
  if (/^\$\d/.test(token)) {
    return '$__';
  }

  if (/^\d/.test(token) && token.endsWith('%')) {
    return '__%';
  }

  if (/^\d+(st|nd|rd|th)$/.test(token)) {
    return '__th';
  }

  if (/^\d/.test(token)) {
    return '__';
  }

  return null;
}

function createRangePlaceholderTokenLists(tokens: string[], placeholder: string) {
  if (tokens.length < 2) {
    return [];
  }

  const candidates: string[][] = [];

  for (let start = 1; start < tokens.length; start += 1) {
    for (let end = start; end < tokens.length; end += 1) {
      candidates.push([
        ...tokens.slice(0, start),
        placeholder,
        ...tokens.slice(end + 1),
      ]);
    }
  }

  return candidates;
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
