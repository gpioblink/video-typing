import type {
  StoredLocalPlayerSession,
  StoredSubtitleData,
  StoredFrameProgressData,
  StoredTypingProgressData,
  SubtitleCue,
  Tag,
  TimedCaptionFrame,
} from '../types';
import { subtitleCueToCaptionFrame } from './subtitles';

export interface ReviewFrame {
  frame: TimedCaptionFrame;
  cue: SubtitleCue;
  finishedCharIds: string[];
  tags: Tag[];
}

export interface UnknownWordCsvRow {
  headword: string;
  cueText: string;
  meaning: string;
}

const TYPE_REVIEW_TAG_CONTENTS = new Set(['ignorance', 'unaudible', 'spelling']);

interface ReviewSource {
  subtitleCues: SubtitleCue[];
  typingFrames?: TimedCaptionFrame[];
}

export function buildSessionReviewFrames(
  session: StoredLocalPlayerSession,
  typingProgress: StoredTypingProgressData,
): ReviewFrame[] {
  return buildReviewFrames({
    subtitleCues: session.subtitleCues,
    typingFrames: session.typingFrames,
  }, typingProgress);
}

export function buildSessionTypeReviewFrames(
  session: StoredLocalPlayerSession,
  typingProgress: StoredTypingProgressData,
): ReviewFrame[] {
  return buildSessionReviewFrames(session, typingProgress).filter((reviewFrame) => (
    reviewFrame.tags.some((tag) => TYPE_REVIEW_TAG_CONTENTS.has(tag.content))
  ));
}

export function createTypeReviewTypingProgress(reviewFrames: ReviewFrame[]): StoredTypingProgressData {
  return Object.fromEntries(reviewFrames.map((reviewFrame) => {
    const progress: StoredFrameProgressData = {
      finishedCharIds: [],
      tags: reviewFrame.tags,
      updatedAt: undefined,
    };

    return [reviewFrame.frame.id, progress];
  }));
}

export function buildStoredSubtitleReviewFrames(
  subtitle: StoredSubtitleData,
  typingProgress: StoredTypingProgressData,
): ReviewFrame[] {
  return buildReviewFrames({
    subtitleCues: subtitle.cues,
    typingFrames: subtitle.typingFrames,
  }, typingProgress);
}

export function buildStoredSubtitleTypeReviewFrames(
  subtitle: StoredSubtitleData,
  typingProgress: StoredTypingProgressData,
): ReviewFrame[] {
  return buildStoredSubtitleReviewFrames(subtitle, typingProgress).filter((reviewFrame) => (
    reviewFrame.tags.some((tag) => TYPE_REVIEW_TAG_CONTENTS.has(tag.content))
  ));
}

function buildReviewFrames(
  source: ReviewSource,
  typingProgress: StoredTypingProgressData,
): ReviewFrame[] {
  const frames = createReviewFrames(source);

  return frames.map(({ frame, cue }) => {
    const progress = typingProgress[frame.id];

    return {
      frame,
      cue,
      finishedCharIds: progress?.finishedCharIds || [],
      tags: progress?.tags || frame.tags || [],
    };
  });
}

export function createUnknownWordCsvRows(
  session: StoredLocalPlayerSession,
  typingProgress: StoredTypingProgressData,
): UnknownWordCsvRow[] {
  return createUnknownWordCsvRowsFromReviewFrames(buildSessionReviewFrames(session, typingProgress));
}

export function createStoredSubtitleUnknownWordCsvRows(
  subtitle: StoredSubtitleData,
  typingProgress: StoredTypingProgressData,
): UnknownWordCsvRow[] {
  return createUnknownWordCsvRowsFromReviewFrames(buildStoredSubtitleReviewFrames(subtitle, typingProgress));
}

function createUnknownWordCsvRowsFromReviewFrames(reviewFrames: ReviewFrame[]) {
  return reviewFrames.flatMap(({ cue, tags }) => (
    tags.flatMap((tag) => {
      if (tag.content !== 'ignorance' || !tag.hint) {
        return [];
      }

      return [{
        headword: tag.hint.headword,
        cueText: cue.text,
        meaning: tag.hint.meaning,
      }];
    })
  ));
}

export function createUnknownWordCsv(rows: UnknownWordCsvRow[]) {
  return [
    ['辞書の見出し語', '字幕cue内容', '辞書の意味'],
    ...rows.map((row) => [row.headword, row.cueText, row.meaning]),
  ].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

function createReviewFrames(source: ReviewSource) {
  if (source.typingFrames?.length) {
    return source.typingFrames.map((frame) => ({
      frame,
      cue: findCueForFrame(source.subtitleCues, frame) || {
        start: frame.start,
        end: frame.end,
        text: frame.caption.map((char) => char.char).join(''),
      },
    }));
  }

  return source.subtitleCues.map((cue) => ({
    frame: {
      ...subtitleCueToCaptionFrame(cue),
      start: cue.start,
      end: cue.end,
    },
    cue,
  }));
}

function findCueForFrame(cues: SubtitleCue[], frame: TimedCaptionFrame) {
  const cueTime = (frame.start + frame.end) / 2;

  return cues.find((cue) => (
    cue.start === frame.start &&
    cue.end === frame.end
  )) || cues.find((cue) => (
    cue.start <= cueTime && cueTime < cue.end
  ));
}

function escapeCsvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}
