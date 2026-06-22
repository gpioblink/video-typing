import type { CaptionFrame, Char, SubtitleCue, SubtitleFormat } from '../types';

export function parseSubtitleFile(fileName: string, text: string): SubtitleCue[] {
  const format = detectSubtitleFormat(fileName, text);

  if (format === 'srt') {
    return parseSrt(text);
  }

  if (format === 'vtt') {
    return parseVtt(text);
  }

  return parseTtml(text);
}

export function subtitleCueToCaptionFrame(cue: SubtitleCue): CaptionFrame {
  return {
    id: `subtitle-${cue.start}-${cue.end}-${hashText(cue.text)}`,
    caption: textToCaptionChars(cue.text),
    tags: [],
  };
}

export function emptyCaptionFrame(id = 'subtitle-empty'): CaptionFrame {
  return {
    id,
    caption: [],
    tags: [],
  };
}

function detectSubtitleFormat(fileName: string, text: string): SubtitleFormat {
  const lowerFileName = fileName.toLowerCase();
  const trimmed = text.trimStart().toLowerCase();

  if (lowerFileName.endsWith('.vtt') || lowerFileName.endsWith('.vtt.txt')) {
    return 'vtt';
  }

  if (lowerFileName.endsWith('.srt') || lowerFileName.endsWith('.srt.txt')) {
    return 'srt';
  }

  if (lowerFileName.endsWith('.ttml') || lowerFileName.endsWith('.xml')) {
    return 'ttml';
  }

  if (trimmed.startsWith('webvtt')) {
    return 'vtt';
  }

  if (trimmed.startsWith('<?xml') || trimmed.includes('<tt')) {
    return 'ttml';
  }

  return 'srt';
}

function parseSrt(text: string): SubtitleCue[] {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.flatMap((block) => {
    const lines = block.split('\n').map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes('-->'));

    if (timingIndex === -1) {
      return [];
    }

    const [startText, endText] = lines[timingIndex].split('-->').map((value) => value.trim());
    const start = parseSubtitleTime(startText);
    const end = parseSubtitleTime(endText);
    const body = sanitizeSubtitleText(lines.slice(timingIndex + 1).join('\n')).trim();

    if (!Number.isFinite(start) || !Number.isFinite(end) || !body) {
      return [];
    }

    return [{ start, end, text: body }];
  });
}

function parseVtt(text: string): SubtitleCue[] {
  const blocks = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.flatMap((block) => {
    const lines = block.split('\n').map((line) => line.trimEnd());
    const firstLine = lines[0]?.trim().toLowerCase() || '';

    if (
      firstLine.startsWith('webvtt') ||
      firstLine.startsWith('note') ||
      firstLine === 'style' ||
      firstLine === 'region'
    ) {
      return [];
    }

    const timingIndex = lines.findIndex((line) => line.includes('-->'));

    if (timingIndex === -1) {
      return [];
    }

    const [startText, endTextWithSettings] = lines[timingIndex].split('-->').map((value) => value.trim());
    const endText = endTextWithSettings.split(/\s+/)[0] || '';
    const start = parseSubtitleTime(startText);
    const end = parseSubtitleTime(endText);
    const body = sanitizeSubtitleText(lines.slice(timingIndex + 1).join('\n')).trim();

    if (!Number.isFinite(start) || !Number.isFinite(end) || !body) {
      return [];
    }

    return [{ start, end, text: body }];
  });
}

function parseTtml(text: string): SubtitleCue[] {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, 'application/xml');
  const nodes = Array.from(xml.getElementsByTagName('p'));
  const tickRate = getTtmlTickRate(xml);

  return nodes.flatMap((node) => {
    const startText = node.getAttribute('begin') || '';
    const endText = node.getAttribute('end') || '';
    const start = parseSubtitleTime(startText, tickRate);
    const end = parseSubtitleTime(endText, tickRate);
    const body = sanitizeSubtitleText(extractTtmlText(node)).trim();

    if (!Number.isFinite(start) || !Number.isFinite(end) || !body) {
      return [];
    }

    return [{ start, end, text: body }];
  });
}

function extractTtmlText(node: Element) {
  const lines: string[] = [];

  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      lines.push(child.textContent || '');
      return;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = child as Element;

    if (element.tagName.toLowerCase() === 'br') {
      lines.push('\n');
      return;
    }

    lines.push(extractTtmlText(element));
  });

  return lines.join('').replace(/\n{3,}/g, '\n\n');
}

function getTtmlTickRate(xml: Document) {
  const value = xml.documentElement?.getAttribute('ttp:tickRate')
    || xml.documentElement?.getAttribute('tickRate')
    || '';
  const tickRate = Number(value);
  return Number.isFinite(tickRate) && tickRate > 0 ? tickRate : 10_000_000;
}

function parseSubtitleTime(input: string, tickRate?: number) {
  const value = input.trim();

  if (!value) {
    return Number.NaN;
  }

  if (value.endsWith('t')) {
    const ticks = Number(value.slice(0, -1));
    return Number.isFinite(ticks) && tickRate ? ticks / tickRate : Number.NaN;
  }

  if (value.endsWith('s')) {
    return Number(value.slice(0, -1));
  }

  const normalized = value.replace(',', '.');
  const parts = normalized.split(':');

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts.map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts.map(Number);
    return minutes * 60 + seconds;
  }

  return Number(normalized);
}

function sanitizeSubtitleText(text: string) {
  const withoutTags = text
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\n{3,}/g, '\n\n');

  const textarea = document.createElement('textarea');
  textarea.innerHTML = withoutTags;
  return textarea.value;
}

function textToCaptionChars(text: string): Char[] {
  const bracketOrAlphabet = /\[[^\]]*\]|\([^\)]*\)|[A-Za-z]/g;
  const chars = Array.from(text);
  const typeableIndexes = new Set<number>();
  let match: RegExpExecArray | null;

  while ((match = bracketOrAlphabet.exec(text)) !== null) {
    if (/^[A-Za-z]$/.test(match[0])) {
      typeableIndexes.add(countCodePoints(text.slice(0, match.index)));
    }
  }

  return chars.map((char, index) => ({
    id: String(index),
    char,
    isTypeable: typeableIndexes.has(index),
  }));
}

function countCodePoints(text: string) {
  return Array.from(text).length;
}

function hashText(text: string) {
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}
