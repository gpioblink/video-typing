import type { SubtitleCue } from '../types';

/** Keep the original absolute video clock; only intersecting cues enter practice. */
export function selectClipCues(cues: SubtitleCue[], start: number, end: number): SubtitleCue[] {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end - start > 90
  )
    throw new Error('開始・終了を正しく指定してください（最大90秒）。');
  const selected = cues
    .filter(
      (cue) =>
        Number.isFinite(cue.start) &&
        Number.isFinite(cue.end) &&
        cue.end > cue.start &&
        cue.start < end &&
        cue.end > start &&
        /[a-z]/i.test(cue.text),
    )
    .map((cue) => ({
      start: Math.max(start, cue.start),
      end: Math.min(end, cue.end),
      text: cue.text,
    }))
    .sort((a, b) => a.start - b.start);
  // Some files (especially automatic captions) overlap. Never show two problems at once.
  for (let i = 0; i < selected.length - 1; i++)
    selected[i].end = Math.min(selected[i].end, selected[i + 1].start);
  const result = selected.filter((cue) => cue.end > cue.start);
  if (!result.length) throw new Error('この区間に英語の字幕がありません。区間を変更してください。');
  return result;
}
