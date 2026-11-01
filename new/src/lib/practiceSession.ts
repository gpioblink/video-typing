import { parseYouTubeId, type PracticeClip } from './clips';
import { selectClipCues } from './clipSelection';
import type { ExternalHistoryItem, StoredTypingProgressData } from '../types';

export function practiceStorageKey(clip: PracticeClip): string {
  if (clip.source.kind !== 'youtube') throw new Error('Web履歴にはYouTube動画を指定してください。');
  const url = new URL('https://www.youtube.com/watch');
  url.searchParams.set('v', clip.source.videoId);
  url.searchParams.set('start', String(clip.start));
  url.searchParams.set('end', String(clip.end));
  return url.href;
}

export function historyPracticeClip(item: ExternalHistoryItem): PracticeClip {
  if (!item.subtitle?.cues.length) throw new Error('履歴に字幕がありません。');
  const videoId = parseYouTubeId(item.url);
  const url = new URL(item.url);
  const first = Math.min(...item.subtitle.cues.map((cue) => cue.start));
  const last = Math.max(...item.subtitle.cues.map((cue) => cue.end));
  const start = url.searchParams.has('start') ? Number(url.searchParams.get('start')) : first;
  const end = url.searchParams.has('end') ? Number(url.searchParams.get('end')) : last;
  return {
    id: `history-${videoId}`,
    title: item.title,
    description: item.title,
    source: { kind: 'youtube', videoId },
    language: 'en',
    start,
    end,
    cues: selectClipCues(item.subtitle.cues, start, end),
    sync: { offsetSeconds: 0, showText: false },
  };
}

/** A retry clears typed characters, not the learner's unresolved explanations. */
export function restartTypingProgress(
  progress: StoredTypingProgressData,
): StoredTypingProgressData {
  return Object.fromEntries(
    Object.entries(progress).map(([id, frame]) => [
      id,
      {
        finishedCharIds: [],
        tags: frame.tags,
        updatedAt: frame.updatedAt,
      },
    ]),
  );
}
