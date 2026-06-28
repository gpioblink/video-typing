import type { CaptionFrame, DictionaryHintSelection, DictionaryWord, ID, Tag } from '../types';

interface CueToken {
  normalized: string;
  startIndex: number;
  endIndex: number;
}

type HeadwordToken = {
  kind: 'literal' | 'placeholder';
  normalized: string;
};

const CUE_TOKEN_PATTERN = /\$?\d+(?:[.,]\d+)?(?:st|nd|rd|th|%)?|[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const HEADWORD_TOKEN_PATTERN = /~|\$?__%?|__th|_+|\$?\d+(?:[.,]\d+)?(?:st|nd|rd|th|%)?|[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
const PLACEHOLDER_TOKENS = new Set(['~', 'someone', '__', '$__', '__%', '__th']);

export function createHintSelection(word: DictionaryWord, selectedText: string): DictionaryHintSelection {
  return {
    headword: word.title,
    meaning: word.content,
    dictionaryEntryKey: word.dictionaryEntryKey,
    selectedText,
    selectedAt: Date.now(),
  };
}

export function resolveHintTarget(
  frame: CaptionFrame,
  fallbackCharIds: ID[],
  headword: string,
) {
  const captionText = charsToString(frame.caption);
  const captionChars = frame.caption;
  const cueTokens = tokenizeCueText(captionText);
  const headwordTokens = tokenizeHeadword(headword);
  const match = findHeadwordMatch(cueTokens, headwordTokens);

  if (!match) {
    return {
      targetCharIds: fallbackCharIds,
      selectedText: charsToString(frame.caption.filter((char) => fallbackCharIds.includes(char.id))),
    };
  }

  const startIndex = cueTokens[match.startTokenIndex].startIndex;
  const endIndex = cueTokens[match.endTokenIndex - 1].endIndex;
  const selectedChars = captionChars.slice(startIndex, endIndex);

  return {
    targetCharIds: selectedChars.map((char) => char.id),
    selectedText: charsToString(selectedChars),
  };
}

export function removeOverlappingLowerPriorityMistakeTags(tags: Tag[], nextCharIds: ID[]) {
  const nextCharIdSet = new Set(nextCharIds);

  return tags.filter((tag) => (
    (tag.content !== 'unaudible' && tag.content !== 'spelling') ||
    !tag.pastedCharIds.some((charId) => nextCharIdSet.has(charId))
  ));
}

function charsToString(chars: Array<{ char: string }>) {
  return chars.map((char) => char.char).join('');
}

function tokenizeCueText(text: string): CueToken[] {
  const codeUnitToCharIndex = createCodeUnitToCharIndex(text);
  const tokens: CueToken[] = [];
  let match: RegExpExecArray | null;

  while ((match = CUE_TOKEN_PATTERN.exec(text)) !== null) {
    const normalized = normalizeToken(match[0]);

    if (!normalized) {
      continue;
    }

    tokens.push({
      normalized,
      startIndex: codeUnitToCharIndex[match.index] ?? 0,
      endIndex: codeUnitToCharIndex[match.index + match[0].length] ?? Array.from(text).length,
    });
  }

  return tokens;
}

function tokenizeHeadword(headword: string): HeadwordToken[] {
  const tokens: HeadwordToken[] = [];
  let match: RegExpExecArray | null;

  while ((match = HEADWORD_TOKEN_PATTERN.exec(headword)) !== null) {
    const normalized = normalizeToken(match[0]);

    if (!normalized) {
      continue;
    }

    tokens.push({
      kind: PLACEHOLDER_TOKENS.has(normalized) ? 'placeholder' : 'literal',
      normalized,
    });
  }

  return tokens;
}

function normalizeToken(value: string) {
  return value.replace(/,/g, '').replace(/’/g, "'").toLowerCase().trim();
}

function createCodeUnitToCharIndex(text: string) {
  const indexes: number[] = [];
  let codeUnitIndex = 0;

  Array.from(text).forEach((char, charIndex) => {
    for (let offset = 0; offset < char.length; offset += 1) {
      indexes[codeUnitIndex + offset] = charIndex;
    }
    codeUnitIndex += char.length;
  });

  indexes[codeUnitIndex] = Array.from(text).length;
  return indexes;
}

function findHeadwordMatch(cueTokens: CueToken[], headwordTokens: HeadwordToken[]) {
  if (cueTokens.length === 0 || headwordTokens.length === 0) {
    return null;
  }

  for (let startTokenIndex = 0; startTokenIndex < cueTokens.length; startTokenIndex += 1) {
    const endTokenIndex = matchFrom(cueTokens, headwordTokens, startTokenIndex, 0);

    if (endTokenIndex !== null) {
      return { startTokenIndex, endTokenIndex };
    }
  }

  return null;
}

function matchFrom(
  cueTokens: CueToken[],
  headwordTokens: HeadwordToken[],
  cueIndex: number,
  headwordIndex: number,
): number | null {
  if (headwordIndex >= headwordTokens.length) {
    return cueIndex;
  }

  const headwordToken = headwordTokens[headwordIndex];

  if (headwordToken.kind === 'literal') {
    if (cueTokens[cueIndex]?.normalized !== headwordToken.normalized) {
      return null;
    }

    return matchFrom(cueTokens, headwordTokens, cueIndex + 1, headwordIndex + 1);
  }

  for (let nextCueIndex = cueIndex + 1; nextCueIndex <= cueTokens.length; nextCueIndex += 1) {
    const matchedEndIndex = matchFrom(cueTokens, headwordTokens, nextCueIndex, headwordIndex + 1);

    if (matchedEndIndex !== null) {
      return matchedEndIndex;
    }
  }

  return null;
}
