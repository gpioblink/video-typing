import type { SubtitleCue } from '../types';

/** Translations may split or merge cues differently. Match their absolute
 * timestamps to the question being typed, never their array indexes. */
export function findDisplaySubtitleCue(question: SubtitleCue | null | undefined, translations: SubtitleCue[] | undefined): SubtitleCue | undefined {
  if (!question || !translations?.length) return undefined;
  const at = (question.start + question.end) / 2;
  return translations.find(cue => cue.start <= at && at < cue.end);
}
