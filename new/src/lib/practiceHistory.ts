import {
  buildStoredSubtitleReviewFrames,
  buildStoredSubtitleTypeReviewFrames,
  createStoredSubtitleUnknownWordCsvRows,
} from './localPlayerReview';
import type { ExternalHistoryItem } from '../types';

/** Summarize the stored frames themselves, so obsolete or duplicate character
 * IDs cannot mark a question complete or create an unrelated review item. */
export function summarizePracticeHistory(item: ExternalHistoryItem) {
  if (!item.subtitle)
    return {
      totalCues: 0,
      completedCues: 0,
      unknownWordCount: 0,
      reviewFrames: [],
      unknownWordRows: [],
    };
  const frames = buildStoredSubtitleReviewFrames(item.subtitle, item.typingProgress);
  return {
    totalCues: frames.length,
    completedCues: frames.filter(({ frame, finishedCharIds }) => {
      const finished = new Set(finishedCharIds);
      return frame.caption.every((char) => !char.isTypeable || finished.has(char.id));
    }).length,
    unknownWordCount: frames.reduce(
      (count, { tags }) => count + tags.filter((tag) => tag.content === 'ignorance').length,
      0,
    ),
    reviewFrames: buildStoredSubtitleTypeReviewFrames(item.subtitle, item.typingProgress),
    unknownWordRows: createStoredSubtitleUnknownWordCsvRows(item.subtitle, item.typingProgress),
  };
}
