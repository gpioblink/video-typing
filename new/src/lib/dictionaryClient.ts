import type { DictionaryEntry } from '../types';

export async function searchExtensionDictionary(
  query: string,
  contextText = '',
  requestId = '',
): Promise<DictionaryEntry[]> {
  console.log('[video-typing][hint][client-send]', { requestId, query, contextText });
  const response = await chrome.runtime.sendMessage({
    type: 'videoTypingDictionarySearch',
    requestId,
    query,
    contextText,
  });

  if (!response || !Array.isArray(response.entries)) {
    console.log('[video-typing][hint][client-invalid-response]', { requestId, response });
    return [];
  }

  const entries = response.entries.filter(isDictionaryEntry);
  console.log('[video-typing][hint][client-result]', {
    requestId,
    entries: entries.map(summarizeDictionaryEntry),
  });
  return entries;
}

export async function searchExtensionChineseDictionary(
  query: string,
  contextText: string,
  requestId = '',
): Promise<DictionaryEntry[]> {
  console.log('[video-typing][hint][client-send]', { requestId, query, contextText, kind: 'chinese' });
  const response = await chrome.runtime.sendMessage({
    type: 'videoTypingChineseDictionarySearch',
    requestId,
    query,
    contextText,
  });

  if (!response || !Array.isArray(response.entries)) {
    console.log('[video-typing][hint][client-invalid-response]', { requestId, response, kind: 'chinese' });
    return [];
  }

  const entries = response.entries.filter(isDictionaryEntry);
  console.log('[video-typing][hint][client-result]', {
    requestId,
    kind: 'chinese',
    entries: entries.map(summarizeDictionaryEntry),
  });
  return entries;
}

function summarizeDictionaryEntry(entry: DictionaryEntry) {
  return {
    headword: entry.headword,
    normalizedHeadword: entry.normalizedHeadword,
    key: entry.key,
  };
}

function isDictionaryEntry(value: unknown): value is DictionaryEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Partial<DictionaryEntry>;

  return (
    typeof entry.key === 'string' &&
    typeof entry.headword === 'string' &&
    typeof entry.normalizedHeadword === 'string' &&
    typeof entry.body === 'string' &&
    typeof entry.sourceName === 'string' &&
    typeof entry.importedAt === 'number'
  );
}
