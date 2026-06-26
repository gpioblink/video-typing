import type { DictionaryEntry } from '../types';
import { HINT_DEBUG_BUILD_ID } from './hintDebug';

export type DictionaryKind = 'english' | 'chinese';

const DB_VERSION = 1;
const STORE_NAME = 'entries';
const NORMALIZED_HEADWORD_INDEX = 'normalizedHeadword';
const MAX_SEARCH_RESULTS = 10;
const MAX_DIRECT_SEARCH_RESULTS = 5;
const MAX_CONTEXT_SEARCH_RESULTS = 5;
const MAX_SEARCH_RESULTS_PER_CANDIDATE = 3;
const IMPORT_PROGRESS_INTERVAL = 1000;
const IMPORT_BATCH_SIZE = 5000;
const MAX_CHINESE_LOOKUP_LENGTH = 39;
const MAX_ENGLISH_CONTEXT_NGRAM_LENGTH = 6;
const MAX_ENGLISH_CONTEXT_CANDIDATES = 200;
const MAX_ENGLISH_CONTEXT_CANDIDATES_PER_NGRAM = 20;
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

export interface DictionarySearchLookup {
  getExact: (
    normalizedHeadword: string,
    limit: number,
    kind: DictionaryKind,
  ) => Promise<DictionaryEntry[]>;
  getPrefix: (
    prefix: string,
    limit: number,
    kind: DictionaryKind,
  ) => Promise<DictionaryEntry[]>;
}

export function normalizeDictionaryHeadword(value: string, kind: DictionaryKind = 'english') {
  const trimmed = value.trim();

  return kind === 'english' ? trimmed.toLowerCase() : trimmed;
}

// TODO: メモリ使用量が大きくなるので、TSVを分割してインポートするようにする
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
  requestId = '',
): Promise<DictionaryEntry[]> {
  return searchDictionaryWithLookup(query, kind, contextText, {
    getExact: getEntriesByNormalizedHeadword,
    getPrefix: getEntriesByHeadwordPrefix,
  }, requestId);
}

export async function searchDictionaryWithLookup(
  query: string,
  kind: DictionaryKind = 'english',
  contextText = '',
  lookup: DictionarySearchLookup,
  requestId = '',
): Promise<DictionaryEntry[]> {
  const normalizedQuery = normalizeDictionaryHeadword(query, kind);
  const englishLookupLogGroups: EnglishLookupCandidateLogGroup[] = [];

  if (!normalizedQuery) {
    console.log('[video-typing][hint][dictionary-empty-query]', { requestId, query });
    return [];
  }

  let directMatches: DictionaryEntry[] = [];

  if (kind === 'english') {
    const directCandidates = createEnglishDirectLookupCandidates(normalizedQuery);
    const requiredTokenLists = directCandidates.map(tokenizeEnglishLookupText);
    console.log('[video-typing][hint][dictionary-direct-candidates]', {
      requestId,
      query,
      normalizedQuery,
      directCandidates,
      requiredTokenLists,
    });

    englishLookupLogGroups.push({
      label: 'Exact query and variants',
      candidates: directCandidates,
    });

    directMatches = await searchEnglishCandidateGroups(
      [directCandidates],
      requiredTokenLists,
      lookup,
      requestId,
      'direct',
      MAX_DIRECT_SEARCH_RESULTS,
    );
  }

  if (kind === 'english' && contextText.trim()) {
    const candidateGroups = createEnglishLookupCandidateGroups(normalizedQuery, contextText);
    console.log('[video-typing][hint][dictionary-context-candidates]', {
      requestId,
      query,
      contextText,
      groupCount: candidateGroups.length,
      groups: candidateGroups,
    });

    englishLookupLogGroups.push(...candidateGroups.map((candidates, index) => ({
      label: `Context group ${index + 1}`,
      candidates,
    })));

    const contextMatches = await searchEnglishCandidateGroups(
      candidateGroups,
      createEnglishDirectLookupCandidates(normalizedQuery).map(tokenizeEnglishLookupText),
      lookup,
      requestId,
      'context',
      MAX_CONTEXT_SEARCH_RESULTS,
    );

    const combinedMatches = mergeDictionaryEntries(directMatches, contextMatches);
    logEnglishLookupCandidates(requestId, query, normalizedQuery, englishLookupLogGroups);
    return combinedMatches.slice(0, MAX_SEARCH_RESULTS);
  }

  if (kind === 'english') {
    logEnglishLookupCandidates(requestId, query, normalizedQuery, englishLookupLogGroups);
    return directMatches.slice(0, MAX_SEARCH_RESULTS);
  }

  const exactMatches = await lookup.getExact(normalizedQuery, MAX_SEARCH_RESULTS, kind);

  if (exactMatches.length > 0) {
    return exactMatches.slice(0, MAX_SEARCH_RESULTS);
  }

  const prefixMatches = await lookup.getPrefix(normalizedQuery, MAX_SEARCH_RESULTS, kind);
  return prefixMatches;
}

interface EnglishLookupCandidateLogGroup {
  label: string;
  candidates: string[];
}

function logEnglishLookupCandidates(
  requestId: string,
  query: string,
  normalizedQuery: string,
  groups: EnglishLookupCandidateLogGroup[],
) {
  console.log('[video-typing][hint][dictionary-summary]', {
    buildId: HINT_DEBUG_BUILD_ID,
    requestId,
    query,
    normalizedQuery,
    groups: groups.map((group) => ({
      label: group.label,
      candidateCount: group.candidates.length,
      candidates: group.candidates,
    })),
    totalCandidateCount: groups.reduce((count, group) => count + group.candidates.length, 0),
  });
}

export async function searchChineseDictionary(
  query: string,
  contextText = '',
): Promise<DictionaryEntry[]> {
  const normalizedQuery = normalizeDictionaryHeadword(query, 'chinese');

  if (normalizedQuery) {
    const exactMatches = await getEntriesByNormalizedHeadword(
      normalizedQuery,
      MAX_SEARCH_RESULTS,
      'chinese',
    );

    if (exactMatches.length > 0) {
      return exactMatches.slice(0, MAX_SEARCH_RESULTS);
    }
  }

  const candidates = createChineseLookupCandidates(normalizedQuery, contextText);
  const seenKeys = new Set<string>();
  const results: DictionaryEntry[] = [];

  for (const candidate of candidates) {
    const entries = await getEntriesByNormalizedHeadword(candidate, MAX_SEARCH_RESULTS, 'chinese');

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

async function searchEnglishCandidateGroups(
  candidateGroups: string[][],
  requiredTokenLists: string[][],
  lookup: DictionarySearchLookup,
  requestId: string,
  stage: 'direct' | 'context',
  maxResults: number,
): Promise<DictionaryEntry[]> {
  const results: DictionaryEntry[] = [];
  const seenKeys = new Set<string>();

  for (let groupIndex = 0; groupIndex < candidateGroups.length; groupIndex += 1) {
    const candidates = candidateGroups[groupIndex];

    for (const candidate of candidates) {
      const entries = await lookup.getExact(
        candidate,
        MAX_SEARCH_RESULTS_PER_CANDIDATE,
        'english',
      );

      if (entries.length > 0) {
        console.log('[video-typing][hint][dictionary-candidate-hit]', {
          requestId,
          stage,
          groupIndex,
          candidate,
          rawHeadwords: entries.map((entry) => entry.headword),
        });
      }

      for (const entry of entries) {
        if (
          !containsAnyTokenSequence(
            tokenizeEnglishLookupText(entry.normalizedHeadword),
            requiredTokenLists,
          )
        ) {
          console.log('[video-typing][hint][dictionary-filtered-unrelated]', {
            requestId,
            stage,
            candidate,
            headword: entry.headword,
            requiredTokenLists,
          });
          continue;
        }

        if (seenKeys.has(entry.key)) {
          continue;
        }

        seenKeys.add(entry.key);
        results.push(entry);
      }
    }
  }

  if (results.length > 0) {
    const limitedResults = results.slice(0, maxResults);
    console.log('[video-typing][hint][dictionary-return]', {
      requestId,
      stage,
      reason: results.length > maxResults ? 'max-results' : 'all-hit-groups',
      headwords: limitedResults.map((entry) => entry.headword),
    });
    return limitedResults;
  }

  console.log('[video-typing][hint][dictionary-no-match]', { requestId, stage });
  return [];
}

function mergeDictionaryEntries(...entryGroups: DictionaryEntry[][]) {
  const seenKeys = new Set<string>();
  const results: DictionaryEntry[] = [];

  for (const entries of entryGroups) {
    for (const entry of entries) {
      if (seenKeys.has(entry.key)) {
        continue;
      }

      seenKeys.add(entry.key);
      results.push(entry);
    }
  }

  return results;
}

export function createEnglishLookupCandidateGroups(query: string, contextText: string) {
  const contextTokens = tokenizeEnglishLookupText(contextText);
  const queryTokens = tokenizeEnglishLookupText(query);

  if (
    contextTokens.length === 0 ||
    queryTokens.length === 0 ||
    !containsTokenSequence(contextTokens, queryTokens)
  ) {
    return [];
  }

  // Context lookup may broaden phrases with placeholders, but every candidate
  // must still identify the requested word (including an inflected lemma).
  const queryTokenLists = [queryTokens, ...createEnglishLemmaTokenLists(queryTokens)];
  const groups: string[][] = [];

  const maxLength = Math.min(contextTokens.length, MAX_ENGLISH_CONTEXT_NGRAM_LENGTH);
  const maxCandidatesPerLength = Math.max(
    1,
    Math.ceil(MAX_ENGLISH_CONTEXT_CANDIDATES / Math.max(1, maxLength - 1)),
  );

  for (let length = maxLength; length >= 2; length -= 1) {
    const ngrams = createEnglishNgrams(contextTokens, length, queryTokens);
    const candidates: string[] = [];
    const seen = new Set<string>();

    for (const ngram of ngrams) {
      let ngramCandidateCount = 0;

      for (const candidate of createEnglishPhraseCandidates(ngram)) {
        const normalizedCandidate = normalizeDictionaryHeadword(candidate, 'english');

        if (
          !normalizedCandidate ||
          seen.has(normalizedCandidate) ||
          !containsAnyTokenSequence(tokenizeEnglishLookupText(normalizedCandidate), queryTokenLists)
        ) {
          continue;
        }

        seen.add(normalizedCandidate);
        candidates.push(normalizedCandidate);
        ngramCandidateCount += 1;

        if (
          candidates.length >= maxCandidatesPerLength ||
          ngramCandidateCount >= MAX_ENGLISH_CONTEXT_CANDIDATES_PER_NGRAM
        ) {
          break;
        }
      }

      if (candidates.length >= maxCandidatesPerLength) {
        break;
      }
    }

    if (candidates.length > 0) {
      groups.push(candidates);
    }
  }

  return groups;
}

export function createEnglishDirectLookupCandidates(query: string) {
  const queryTokens = tokenizeEnglishLookupText(query);
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const tokens of [queryTokens, ...createEnglishLemmaTokenLists(queryTokens)]) {
    addEnglishPhraseCandidate(candidates, seen, tokens);
  }

  return candidates;
}

function tokenizeEnglishLookupText(text: string) {
  // HTMLタグや注釈部分などを削除
  const cleanedText = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[[^\]\r\n]*\]|\([^\)\r\n]*\)|【[^】\r\n]*】|（[^）\r\n]*）/g, ' ');
  const tokens: string[] = [];
  let match: RegExpExecArray | null;

  // 英単語の区切りで配列化
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
  const sourceOrder: Array<{ index: number; queryStart: number; tokens: string[] }> = [];

  for (let start = 0; start + length <= tokens.length; start += 1) {
    const ngram = tokens.slice(start, start + length);
    const queryStart = queryTokens.length > 0
      ? getTokenSequenceStart(ngram, queryTokens)
      : -1;

    if (queryStart !== -1) {
      sourceOrder.push({ index: start, queryStart, tokens: ngram });
    }
  }

  const seenIndexes = new Set<number>();
  const queryFirst = sourceOrder
    .filter((candidate) => candidate.queryStart === 0)
    .sort((left, right) => left.index - right.index);
  const ordered = [...queryFirst, ...sourceOrder].filter((candidate) => {
    if (seenIndexes.has(candidate.index)) {
      return false;
    }

    seenIndexes.add(candidate.index);
    return true;
  });

  return ordered.map((candidate) => candidate.tokens);
}

function getTokenSequenceStart(tokens: string[], sequence: string[]) {
  if (sequence.length === 0 || sequence.length > tokens.length) {
    return -1;
  }

  for (let start = 0; start + sequence.length <= tokens.length; start += 1) {
    const matches = sequence.every((token, index) => tokens[start + index] === token);

    if (matches) {
      return start;
    }
  }

  return -1;
}

function containsTokenSequence(tokens: string[], sequence: string[]) {
  return getTokenSequenceStart(tokens, sequence) !== -1;
}

function containsAnyTokenSequence(tokens: string[], sequences: string[][]) {
  return sequences.some((sequence) => containsTokenSequence(tokens, sequence));
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

    for (const expansion of createEnglishContractionTokenLists(token)) {
      addTokens([
        ...tokens.slice(0, index),
        ...expansion,
        ...tokens.slice(index + 1),
      ]);
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

  if (!/^[a-z][a-z'-]*$/.test(token) || token.length <= 3 || token.includes("'")) {
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

  if (token === 'eyes') {
    addCandidate('eye');
  } else if (token === 'lives') {
    addCandidate('life');
    addCandidate('live');
  } else if (token.endsWith('ies') && token.length > 4) {
    addCandidate(`${token.slice(0, -3)}y`);
    addCandidate(token.slice(0, -1));
  } else if (/[cs]hes$|xes$|zes$|oes$|sses$/.test(token)) {
    addCandidate(token.slice(0, -2));
  } else if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    addCandidate(token.slice(0, -1));
  }

  if (token.endsWith('ied') && token.length > 4) {
    addCandidate(`${token.slice(0, -3)}y`);
  } else if (token.endsWith('ed') && token.length > 3) {
    const stem = token.slice(0, -2);
    addCandidate(stem);
    addCandidate(`${stem}e`);
    addCandidate(removeDoubledFinalConsonant(stem));
  }

  if (token.endsWith('ing') && token.length > 4) {
    const stem = token.slice(0, -3);
    addCandidate(stem);
    if (!/[aeiou]$/.test(stem)) {
      addCandidate(`${stem}e`);
    }
    addCandidate(removeDoubledFinalConsonant(stem));
  }

  return candidates;
}

function createEnglishContractionTokenLists(token: string) {
  const exactExpansions: Record<string, string[][]> = {
    "ain't": [['be', 'not']],
    "can't": [['cannot'], ['can', 'not']],
    "don't": [['do', 'not']],
    "doesn't": [['does', 'not'], ['do', 'not']],
    "didn't": [['did', 'not'], ['do', 'not']],
    "isn't": [['is', 'not'], ['be', 'not']],
    "won't": [['will', 'not']],
  };
  const exact = exactExpansions[token];

  if (exact) {
    return exact.flatMap((expansion) => (
      expansion.length > 1
        ? [expansion, expansion.slice(-1)]
        : [expansion]
    ));
  }

  if (token.endsWith("n't") && token.length > 3) {
    return [[token.slice(0, -3), 'not'], ['not']];
  }

  const suffixExpansions: Array<[string, string[][]]> = [
    ["'m", [['am']]],
    ["'re", [['are']]],
    ["'ve", [['have']]],
    ["'ll", [['will']]],
    ["'d", [['would'], ['had']]],
    ["'s", [['is'], ['has'], []]],
  ];

  for (const [suffix, replacements] of suffixExpansions) {
    if (!token.endsWith(suffix) || token.length <= suffix.length) {
      continue;
    }

    const stem = token.slice(0, -suffix.length);
    return replacements.flatMap((replacement) => {
      const expanded = [stem, ...replacement];

      if (replacement.length === 0 || suffix === "'s") {
        return [expanded];
      }

      return [expanded, replacement];
    });
  }

  return [];
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

function getEntriesByNormalizedHeadword(
  normalizedHeadword: string,
  limit: number,
  kind: DictionaryKind,
) {
  return queryDictionaryIndex(IDBKeyRange.only(normalizedHeadword), limit, kind);
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
