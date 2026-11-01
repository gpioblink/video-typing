import { normalizeHintSelection } from './storage';
import type {
  ChineseTypingJson,
  ChineseTypingWord,
  TimedCaptionFrame,
  SubtitleCue,
  Tag,
  Char,
} from '../types';

export const CHINESE_TYPING_FORMAT = 'video-typing-chinese-v1';

export function parseChineseTypingJson(fileName: string, text: string): ChineseTypingJson {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${fileName} is not valid JSON.`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${fileName} is not a Chinese typing JSON object.`);
  }

  const candidate = parsed as Partial<ChineseTypingJson>;

  if (candidate.format !== CHINESE_TYPING_FORMAT) {
    throw new Error(`${fileName} is not ${CHINESE_TYPING_FORMAT}.`);
  }

  if (typeof candidate.sourceFileName !== 'string') {
    throw new Error(`${fileName} is missing sourceFileName.`);
  }

  if (!Array.isArray(candidate.typingFrames) || candidate.typingFrames.length === 0) {
    throw new Error(`${fileName} has no typingFrames.`);
  }

  if (!Array.isArray(candidate.sourceCues) || candidate.sourceCues.length === 0) {
    throw new Error(`${fileName} has no sourceCues.`);
  }

  const typingFrames = candidate.typingFrames.map(normalizeTimedCaptionFrame);
  if (new Set(typingFrames.map(frame => frame.id)).size !== typingFrames.length) {
    throw new Error('Duplicate typing frame ID.');
  }

  return {
    format: CHINESE_TYPING_FORMAT,
    sourceFileName: candidate.sourceFileName,
    typingFrames,
    sourceCues: candidate.sourceCues.map(normalizeSubtitleCue),
  };
}

export function isChineseTypingJsonFile(fileName: string) {
  return fileName.toLowerCase().endsWith('.json');
}

function normalizeTimedCaptionFrame(value: unknown): TimedCaptionFrame {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid typing frame.');
  }

  const candidate = value as Partial<TimedCaptionFrame>;

  if (
    typeof candidate.id !== 'string' ||
    !candidate.id || Object.prototype.hasOwnProperty.call(Object.prototype, candidate.id) ||
    typeof candidate.start !== 'number' ||
    typeof candidate.end !== 'number' ||
    !Number.isFinite(candidate.start) ||
    !Number.isFinite(candidate.end) ||
    candidate.start < 0 ||
    candidate.end <= candidate.start ||
    !Array.isArray(candidate.caption)
  ) {
    throw new Error('Invalid typing frame shape.');
  }

  const caption = candidate.caption.map(normalizeChar);
  const charPositions = new Map<string, number>();
  caption.forEach((char, index) => {
    if (charPositions.has(char.id)) throw new Error('Duplicate caption character ID.');
    charPositions.set(char.id, index);
  });
  const words = Array.isArray(candidate.words) ? candidate.words.map(normalizeChineseTypingWord) : [];
  for (const word of words) {
    const startIndex = charPositions.get(word.startCharId);
    const endIndex = charPositions.get(word.endCharId);
    if (startIndex === undefined || endIndex === undefined || endIndex < startIndex) {
      throw new Error('Invalid Chinese typing word range.');
    }
  }

  return {
    id: candidate.id,
    start: candidate.start,
    end: candidate.end,
    caption,
    tags: Array.isArray(candidate.tags) ? candidate.tags.map(normalizeTag) : [],
    words,
  };
}

function normalizeSubtitleCue(value: unknown): SubtitleCue {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid source cue.');
  }

  const candidate = value as Partial<SubtitleCue>;

  if (
    typeof candidate.start !== 'number' ||
    typeof candidate.end !== 'number' ||
    typeof candidate.text !== 'string' ||
    !Number.isFinite(candidate.start) ||
    !Number.isFinite(candidate.end) ||
    candidate.start < 0 ||
    candidate.end <= candidate.start
  ) {
    throw new Error('Invalid source cue shape.');
  }

  return {
    start: candidate.start,
    end: candidate.end,
    text: candidate.text,
  };
}

function normalizeChar(value: unknown): Char {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid caption char.');
  }

  const candidate = value as Partial<Char>;

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.char !== 'string' ||
    typeof candidate.isTypeable !== 'boolean'
  ) {
    throw new Error('Invalid caption char shape.');
  }

  return {
    id: candidate.id,
    char: candidate.char,
    isTypeable: candidate.isTypeable,
  };
}

function normalizeTag(value: unknown): Tag {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid tag.');
  }

  const candidate = value as Partial<Tag>;

  if (
    typeof candidate.id !== 'string' ||
    !Array.isArray(candidate.pastedCharIds) ||
    !candidate.pastedCharIds.every((item) => typeof item === 'string') ||
    (candidate.content !== 'unaudible' &&
      candidate.content !== 'ignorance' &&
      candidate.content !== 'spelling' &&
      candidate.content !== 'others')
  ) {
    throw new Error('Invalid tag shape.');
  }

  const hint = normalizeHintSelection(candidate.hint);
  return {
    id: candidate.id,
    pastedCharIds: candidate.pastedCharIds,
    content: candidate.content,
    ...(hint ? { hint } : {}),
  };
}

function normalizeChineseTypingWord(value: unknown): ChineseTypingWord {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid Chinese typing word.');
  }

  const candidate = value as Partial<ChineseTypingWord>;

  if (
    typeof candidate.sourceText !== 'string' ||
    typeof candidate.pinyin !== 'string' ||
    typeof candidate.startCharId !== 'string' ||
    typeof candidate.endCharId !== 'string' ||
    typeof candidate.dictionaryFound !== 'boolean'
  ) {
    throw new Error('Invalid Chinese typing word shape.');
  }

  return {
    sourceText: candidate.sourceText,
    pinyin: candidate.pinyin,
    startCharId: candidate.startCharId,
    endCharId: candidate.endCharId,
    dictionaryFound: candidate.dictionaryFound,
  };
}
