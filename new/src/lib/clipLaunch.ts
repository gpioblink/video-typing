import { selectClipCues } from './clipSelection';
import type { StoredSubtitleData, SubtitleCue, TimedCaptionFrame } from '../types';

export interface ClipRange { start: number; end: number }

export function validateClipRange(value: unknown): ClipRange {
  if (!value || typeof value !== 'object') throw new Error('開始・終了秒を指定してください。');
  const { start, end } = value as Partial<ClipRange>;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)
    || start < 0 || end <= start || end - start > 90) {
    throw new Error('開始・終了を正しく指定してください（0秒以上・最大90秒）。');
  }
  return { start, end };
}

export function defaultClipRange(currentTime: number, duration: number): ClipRange {
  const hasDuration = Number.isFinite(duration) && duration > 0;
  let start = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  if (hasDuration && start >= duration) start = Math.max(0, duration - 45);
  return { start, end: hasDuration ? Math.min(duration, start + 45) : start + 45 };
}

/** The original page's full-movie progress is never overwritten by a short clip. */
export function createClipStorageKey(pageUrl: string, value: ClipRange) {
  const range = validateClipRange(value);
  if (!pageUrl) throw new Error('動画のURLがありません。');
  return `clip:${encodeURIComponent(pageUrl)}:${range.start}:${range.end}`;
}

/** Preserve the actual video clock and custom typing-frame IDs, including Chinese/pinyin data. */
export function selectSubtitleForClip(subtitle: StoredSubtitleData, value: ClipRange): StoredSubtitleData {
  const range = validateClipRange(value);
  if (!subtitle.typingFrames?.length) {
    return { ...subtitle, cues: selectClipCues(subtitle.cues, range.start, range.end) };
  }
  const typingFrames: TimedCaptionFrame[] = subtitle.typingFrames
    .filter(frame => Number.isFinite(frame.start) && Number.isFinite(frame.end) && frame.start < range.end && frame.end > range.start
      && frame.end > frame.start && frame.caption.some(char => char.isTypeable))
    .map(frame => ({ ...frame, start: Math.max(range.start, frame.start), end: Math.min(range.end, frame.end) }))
    .sort((left, right) => left.start - right.start);
  for (let index = 0; index < typingFrames.length - 1; index++) {
    typingFrames[index].end = Math.min(typingFrames[index].end, typingFrames[index + 1].start);
  }
  const frames = typingFrames.filter(frame => frame.end > frame.start);
  if (!frames.length) throw new Error('この区間にタイピングできる字幕がありません。区間を変更してください。');
  const cues: SubtitleCue[] = frames.map(frame => {
    const midpoint = (frame.start + frame.end) / 2;
    const sourceCue = subtitle.cues.find(cue => cue.start <= midpoint && midpoint < cue.end);
    return { start: frame.start, end: frame.end, text: sourceCue?.text || frame.caption.map(char => char.char).join('') };
  });
  return { ...subtitle, cues, typingFrames: frames };
}

export const VIDEO_CLIP_CONTEXT_ATTRIBUTE = 'data-video-typing-clip-context';

/** Provider identity excludes navigation-only time, playlist and track params.
 * Other pages keep their exact URL because their video identity is unknown. */
export function videoPageIdentity(pageUrl: string): string {
  let url: URL;
  try { url = new URL(pageUrl); } catch { return pageUrl; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return pageUrl;
  let youtubeId: string | null = null;
  if (url.hostname === 'youtu.be') youtubeId = url.pathname.slice(1);
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    youtubeId = url.pathname === '/watch' ? url.searchParams.get('v')
      : /^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})$/.exec(url.pathname)?.[1] || null;
  }
  if (youtubeId && /^[A-Za-z0-9_-]{11}$/.test(youtubeId)) return `youtube:${youtubeId}`;
  if (url.hostname === 'netflix.com' || url.hostname.endsWith('.netflix.com')) {
    // Netflix watch IDs contain only decimal digits.
    const watchId = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?watch\/(\d+)\/?$/i.exec(url.pathname)?.[1];
    if (watchId) return `netflix:${watchId}`;
  }
  return pageUrl;
}

/** DOM is an untrusted input boundary. Never accept a supplied storage key. */
export function readVideoClipContext(currentPageUrl: string, raw: unknown): {
  sourcePageUrl: string;
  range: ClipRange;
} | undefined {
  if (typeof raw !== 'string' || raw.length > 16384) return undefined;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || typeof value.sourcePageUrl !== 'string'
      || !value.sourcePageUrl || value.sourcePageUrl.length > 8192) return undefined;
    const source = new URL(value.sourcePageUrl);
    const current = new URL(currentPageUrl);
    if (![source, current].every(url => ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)) return undefined;
    if (videoPageIdentity(value.sourcePageUrl) !== videoPageIdentity(currentPageUrl)) return undefined;
    return { sourcePageUrl: value.sourcePageUrl, range: validateClipRange(value.range) };
  } catch { return undefined; }
}
