import type { SubtitleCue, SubtitleFormat } from '../types';

export function parseSubtitleFile(fileName: string, text: string): SubtitleCue[] {
  const format = detectSubtitleFormat(fileName, text);
  return format === 'srt' ? parseSrt(text) : parseTtml(text);
}

function detectSubtitleFormat(fileName: string, text: string): SubtitleFormat {
  const lowerFileName = fileName.toLowerCase();
  const trimmed = text.trimStart().toLowerCase();

  if (lowerFileName.endsWith('.srt')) {
    return 'srt';
  }

  if (lowerFileName.endsWith('.ttml') || lowerFileName.endsWith('.xml')) {
    return 'ttml';
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
    const body = lines.slice(timingIndex + 1).join('\n').trim();

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

  return nodes.flatMap((node) => {
    const startText = node.getAttribute('begin') || '';
    const endText = node.getAttribute('end') || '';
    const start = parseSubtitleTime(startText);
    const end = parseSubtitleTime(endText);
    const body = extractTtmlText(node).trim();

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

function parseSubtitleTime(input: string) {
  const value = input.trim();

  if (!value) {
    return Number.NaN;
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
