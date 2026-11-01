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
