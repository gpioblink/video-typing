export interface RecommendedVideo {
  id: string;
  videoId: string;
  title: string;
  creator: string;
  attribution: string;
  description: string;
  language: 'en';
  sourceUrl: string;
  subtitle: {
    url: string;
    format: 'srt' | 'vtt';
    sourceUrl: string;
    license: string;
    licenseUrl: string;
    /** Seconds added to the published subtitle times for this exact upload. */
    offsetSeconds: number;
  };
  /** Optional licensed Japanese display track; typing still uses English. */
  displaySubtitle?: RecommendedVideo['subtitle'] & { language: 'ja' };
  clips: Array<{ id: string; title: string; start: number; end: number }>;
}

// The videos play only in the official YouTube iframe. Only the CC BY 3.0
// English/Japanese subtitle files are hosted here; provenance is in captions/LICENSE.txt.
// Their timing was checked against native captions on these exact uploads.
export const RECOMMENDED_VIDEOS: RecommendedVideo[] = [
  {
    id: 'sintel',
    videoId: 'eRsGyueVLvQ',
    title: 'Sintel - Open Movie by Blender Foundation',
    creator: 'Blender Foundation',
    attribution: '(c) copyright Blender Foundation | durian.blender.org',
    description: '旅人と門番の短い会話を聞いて入力します。',
    language: 'en',
    sourceUrl: 'https://www.youtube.com/watch?v=eRsGyueVLvQ',
    subtitle: {
      url: './captions/sintel-en.srt',
      format: 'srt',
      sourceUrl: 'https://durian.blender.org/wp-content/content/subtitles/sintel_en.srt',
      license: 'CC BY 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
      offsetSeconds: 0,
    },
    displaySubtitle: {
      url: './captions/sintel-ja.srt',
      format: 'srt',
      language: 'ja',
      sourceUrl: 'https://download.blender.org/durian/subs/sintel_jp.srt',
      license: 'CC BY 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
      offsetSeconds: 0,
    },
    clips: [{ id: 'sintel-gatekeepers', title: '旅の目的を話す（49秒）', start: 107, end: 156 }],
  },
  {
    id: 'tears-of-steel',
    videoId: 'R6MlUcmOul8',
    title: 'Tears of Steel - Blender VFX Open Movie',
    creator: 'Blender Foundation',
    attribution: '(CC) Blender Foundation | mango.blender.org',
    description: '仲間を励ます短い会話を聞いて入力します。',
    language: 'en',
    sourceUrl: 'https://www.youtube.com/watch?v=R6MlUcmOul8',
    subtitle: {
      url: './captions/tears-of-steel-en.srt',
      format: 'srt',
      sourceUrl: 'https://download.blender.org/demo/movies/ToS/subtitles/TOS-en.srt',
      license: 'CC BY 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
      offsetSeconds: 0,
    },
    displaySubtitle: {
      url: './captions/tears-of-steel-ja.srt',
      format: 'srt',
      language: 'ja',
      sourceUrl: 'https://download.blender.org/demo/movies/ToS/subtitles/TOS-JP.srt',
      license: 'CC BY 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
      offsetSeconds: 0,
    },
    clips: [{ id: 'tears-of-steel-encouragement', title: '仲間を励ます（31秒）', start: 218, end: 249 }],
  },
];
