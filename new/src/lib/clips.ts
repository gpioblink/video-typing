import type { SubtitleCue } from '../types';
import type { PlaybackSource } from './playback';

export interface PracticeClip {
  id: string;
  title: string;
  description: string;
  language: 'en';
  source: PlaybackSource;
  start: number;
  end: number;
  cues: SubtitleCue[];
  sync: { offsetSeconds: number; showText: boolean };
}

const sentences = (texts: string[]): SubtitleCue[] => texts.map((text, index) => ({
  start: index * 10, end: (index + 1) * 10, text,
}));

// Original scripts; generated media and provenance are in public/demo/.
export const RECOMMENDED_CLIPS: PracticeClip[] = [
  {
    id: 'first-steps', title: 'First steps', language: 'en',
    description: 'はじめての40秒。短い英語を聞いて入力します。',
    source: { kind: 'media', src: './demo/first-steps.webm' }, start: 0, end: 40,
    cues: sentences(['Hello world.', 'Listen and type.', 'Small steps count.', 'You did it.']),
    sync: { offsetSeconds: 0, showText: true },
  },
  {
    id: 'a-quiet-morning', title: 'A quiet morning', language: 'en',
    description: '朝のことばを、ゆっくり40秒。',
    source: { kind: 'media', src: './demo/a-quiet-morning.webm' }, start: 0, end: 40,
    cues: sentences(['The sun is warm.', 'A bird sings.', 'Take a deep breath.', 'Today is a new day.']),
    sync: { offsetSeconds: 0, showText: true },
  },
];

export const YOUTUBE_PRACTICE_CLIP: PracticeClip = {
  id: 'youtube-player-sample', title: 'YouTubeで自由練習', language: 'en',
  description: '公式APIサンプル動画とオリジナル練習文。動画の字幕や書き起こしではありません。',
  source: { kind: 'youtube', videoId: 'M7lc1UVf-VE' }, start: 0, end: 40,
  cues: sentences(['Watch and listen.', 'Try a short sentence.', 'Practice at your own pace.', 'Keep learning every day.']),
  sync: { offsetSeconds: 0, showText: true },
};

export function parseYouTubeId(input: string): string {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('YouTubeの動画IDまたはURLを入力してください。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('HTTPSのYouTube URLを使ってください。');
  let id: string | null = null;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:embed|shorts)\/([A-Za-z0-9_-]{11})$/.exec(url.pathname)?.[1] || null;
  }
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('有効なYouTube動画URLを使ってください。');
  return id;
}

export function validateClip(value: unknown): PracticeClip {
  if (!value || typeof value !== 'object') throw new Error('Clip must be an object.');
  const clip = value as PracticeClip;
  if (typeof clip.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(clip.id)) throw new Error('Invalid clip id.');
  for (const text of [clip.title, clip.description]) {
    if (typeof text !== 'string' || !text.trim() || text.length > 500) throw new Error('Invalid clip text.');
  }
  if (clip.language !== 'en') throw new Error('Unsupported typing language.');
  if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || clip.end - clip.start < 30 || clip.end - clip.start > 90) throw new Error('Clip must last 30–90 seconds.');
  if (clip.source?.kind === 'youtube') {
    if (typeof clip.source.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(clip.source.videoId)) throw new Error('Invalid YouTube id.');
  } else if (clip.source?.kind !== 'media' || typeof clip.source.src !== 'string' || !/^\.\/demo\/[a-z0-9-]+\.webm$/.test(clip.source.src)) {
    throw new Error('Only bundled demo media is allowed.');
  }
  if (!clip.sync || !Number.isFinite(clip.sync.offsetSeconds) || Math.abs(clip.sync.offsetSeconds) > 5 || typeof clip.sync.showText !== 'boolean') throw new Error('Invalid sync settings.');
  if (!Array.isArray(clip.cues) || clip.cues.length < 1 || clip.cues.length > 100) throw new Error('Invalid cues.');
  let previousEnd = clip.start;
  for (const cue of clip.cues) {
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previousEnd || cue.end <= cue.start || cue.end > clip.end || typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 500 || !/[A-Za-z]/.test(cue.text) || /[\u0000-\u0008\u000b-\u001f]/.test(cue.text)) throw new Error('Invalid cue timing or text.');
    const start = cue.start + clip.sync.offsetSeconds;
    const end = cue.end + clip.sync.offsetSeconds;
    if (start < clip.start || end > clip.end) throw new Error('Sync offset moves cues outside clip.');
    previousEnd = cue.end;
  }
  return clip;
}

export function clipPlaybackData(clip: PracticeClip) {
  validateClip(clip);
  return {
    source: clip.source, start: clip.start, end: clip.end,
    cues: clip.cues.map((cue) => ({ ...cue, start: cue.start + clip.sync.offsetSeconds, end: cue.end + clip.sync.offsetSeconds })),
  };
}
