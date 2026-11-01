import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizePracticeHistory } from '../src/lib/practiceHistory.ts';
import { subtitleCueToCaptionFrame } from '../src/lib/subtitles.ts';

const cues = [{ start: 0, end: 4, text: 'One.' }, { start: 4, end: 8, text: 'Two.' }];
const frames = cues.map(subtitleCueToCaptionFrame);
const hint = { headword: 'two', meaning: 'An original count.', selectedText: 'Two', selectedAt: 1 };
const item = {
  url: 'https://www.youtube.com/watch?v=abcdefghijk&start=0&end=8', title: 'Original test', updatedAt: 1,
  subtitle: { fileName: 'test.srt', cues },
};

test('history completion counts actual caption IDs and reuses tagged review and CSV data', () => {
  const summary = summarizePracticeHistory({ ...item, typingProgress: {
    [frames[0].id]: { finishedCharIds: ['0', '1', '2', '2'], tags: [] },
    [frames[1].id]: { finishedCharIds: ['not-a-caption-id', '0', '0'], tags: [{ id: 'tag', pastedCharIds: ['0', '1', '2'], content: 'ignorance', hint }] },
    'obsolete-frame': { finishedCharIds: ['0'], tags: [{ id: 'old', pastedCharIds: ['0'], content: 'ignorance', hint }] },
  } });
  assert.equal(summary.totalCues, 2);
  assert.equal(summary.completedCues, 1);
  assert.equal(summary.unknownWordCount, 1);
  assert.deepEqual(summary.reviewFrames.map(row => row.frame.id), [frames[1].id]);
  assert.deepEqual(summary.unknownWordRows, [{ headword: 'two', cueText: 'Two.', meaning: 'An original count.' }]);
});

test('solved review flags leave no review or export items while progress stays complete', () => {
  const summary = summarizePracticeHistory({ ...item, typingProgress: Object.fromEntries(frames.map(frame => [frame.id, {
    finishedCharIds: frame.caption.filter(char => char.isTypeable).map(char => char.id), tags: [],
  }])) });
  assert.equal(summary.completedCues, 2);
  assert.equal(summary.unknownWordCount, 0);
  assert.deepEqual(summary.reviewFrames, []);
  assert.deepEqual(summary.unknownWordRows, []);
});

test('unheard and spelling flags remain reviewable without becoming unknown word exports', () => {
  const summary = summarizePracticeHistory({ ...item, typingProgress: {
    [frames[0].id]: { finishedCharIds: [], tags: [{ id: 'unheard', pastedCharIds: ['0'], content: 'unaudible' }] },
    [frames[1].id]: { finishedCharIds: [], tags: [{ id: 'spelling', pastedCharIds: ['0'], content: 'spelling' }] },
  } });
  assert.equal(summary.reviewFrames.length, 2);
  assert.equal(summary.unknownWordCount, 0);
  assert.deepEqual(summary.unknownWordRows, []);
});

test('a history item missing subtitles has no resumable learning summary', () => {
  assert.deepEqual(summarizePracticeHistory({ ...item, subtitle: undefined, typingProgress: {} }), {
    totalCues: 0, completedCues: 0, unknownWordCount: 0, reviewFrames: [], unknownWordRows: [],
  });
});
