import type { DictionaryEntry } from '../types';

export async function searchExtensionDictionary(
  query: string,
  contextText = '',
): Promise<DictionaryEntry[]> {
  const response = await chrome.runtime.sendMessage({
    type: 'videoTypingDictionarySearch',
    query,
    contextText,
  });

  if (!response || !Array.isArray(response.entries)) {
    return [];
  }

  return response.entries.filter(isDictionaryEntry);
}

export async function searchExtensionChineseDictionary(
  query: string,
  contextText: string,
): Promise<DictionaryEntry[]> {
  const response = await chrome.runtime.sendMessage({
    type: 'videoTypingChineseDictionarySearch',
    query,
    contextText,
  });

  if (!response || !Array.isArray(response.entries)) {
    return [];
  }

  return response.entries.filter(isDictionaryEntry);
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
