import assert from 'node:assert/strict';
import test from 'node:test';
import {
  removeOverlappingLowerPriorityMistakeTags,
  resolveHintTarget,
} from '../src/lib/hintSelection.ts';
import {
  createStoredSubtitleUnknownWordCsvRows,
  buildSessionTypeReviewFrames,
  createTypeReviewTypingProgress,
  createUnknownWordCsv,
  createUnknownWordCsvRows,
} from '../src/lib/localPlayerReview.ts';
import {
  deleteStoredFrameTypingProgress,
  loadStoredTypingProgress,
  saveStoredTypingProgress,
} from '../src/lib/storage.ts';
import { subtitleCueToCaptionFrame } from '../src/lib/subtitles.ts';

test('hint range resolution maps someone placeholder to actual subtitle words', () => {
  const cue = { start: 0, end: 1, text: 'I want you to think that.' };
  const frame = subtitleCueToCaptionFrame(cue);
  const fallbackCharIds = [frame.caption[2].id];
  const resolved = resolveHintTarget(frame, fallbackCharIds, 'want someone to think that');

  assert.equal(resolved.selectedText, 'want you to think that');
  assert.deepEqual(
    resolved.targetCharIds,
    frame.caption.slice(2, 24).map((char) => char.id),
  );
});

test('hint range resolution maps tilde placeholder to actual subtitle words', () => {
  const cue = { start: 0, end: 1, text: 'Keep your goal in mind.' };
  const frame = subtitleCueToCaptionFrame(cue);
  const fallbackCharIds = [frame.caption[0].id];
  const resolved = resolveHintTarget(frame, fallbackCharIds, 'keep ~ in mind');

  assert.equal(resolved.selectedText, 'Keep your goal in mind');
  assert.deepEqual(
    resolved.targetCharIds,
    frame.caption.slice(0, 22).map((char) => char.id),
  );
});

test('storage normalization preserves optional dictionary hint metadata', async () => {
  const storage = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key)) {
            return Object.fromEntries(key.map((item) => [item, storage[item]]));
          }

          return { [key]: storage[key] };
        },
        async set(next) {
          Object.assign(storage, next);
        },
      },
    },
  };

  await saveStoredTypingProgress('test-url', 'frame-1', {
    finishedCharIds: ['1'],
    tags: [{
      id: 'tag-1',
      pastedCharIds: ['1', '2'],
      content: 'ignorance',
      hint: {
        headword: 'take care',
        meaning: 'be careful',
        dictionaryEntryKey: 'headword:take care',
        selectedText: 'take care',
        selectedAt: 123,
      },
    }],
    updatedAt: 456,
  });

  const loaded = await loadStoredTypingProgress('test-url');

  assert.deepEqual(loaded['frame-1'].tags[0].hint, {
    headword: 'take care',
    meaning: 'be careful',
    dictionaryEntryKey: 'headword:take care',
    selectedText: 'take care',
    selectedAt: 123,
  });
});

test('frame progress deletion removes only the requested frame', async () => {
  const storage = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (Array.isArray(key)) {
            return Object.fromEntries(key.map((item) => [item, storage[item]]));
          }

          return { [key]: storage[key] };
        },
        async set(next) {
          Object.assign(storage, next);
        },
      },
    },
  };

  await saveStoredTypingProgress('test-url', 'frame-1', {
    finishedCharIds: ['1'],
    tags: [],
    updatedAt: 1,
  });
  await saveStoredTypingProgress('test-url', 'frame-2', {
    finishedCharIds: ['2'],
    tags: [],
    updatedAt: 2,
  });
  await saveStoredTypingProgress('other-url', 'frame-1', {
    finishedCharIds: ['3'],
    tags: [],
    updatedAt: 3,
  });

  await deleteStoredFrameTypingProgress('test-url', 'frame-1');

  assert.deepEqual(await loadStoredTypingProgress('test-url'), {
    'frame-2': {
      finishedCharIds: ['2'],
      tags: [],
      updatedAt: 2,
    },
  });
  assert.deepEqual(await loadStoredTypingProgress('other-url'), {
    'frame-1': {
      finishedCharIds: ['3'],
      tags: [],
      updatedAt: 3,
    },
  });
});

test('unknown word selection removes overlapping unaudible and spelling tags', () => {
  const tags = [
    { id: 'unaudible-overlap', pastedCharIds: ['1', '2'], content: 'unaudible' },
    { id: 'spelling-overlap', pastedCharIds: ['3'], content: 'spelling' },
    { id: 'ignorance-overlap', pastedCharIds: ['3'], content: 'ignorance' },
    { id: 'unaudible-unrelated', pastedCharIds: ['9'], content: 'unaudible' },
  ];

  assert.deepEqual(
    removeOverlappingLowerPriorityMistakeTags(tags, ['2', '3']).map((tag) => tag.id),
    ['ignorance-overlap', 'unaudible-unrelated'],
  );
});

test('unknown word CSV includes escaped selected ignorance hints only', () => {
  const cue = { start: 0, end: 1, text: 'He said, "take care".' };
  const frame = subtitleCueToCaptionFrame(cue);
  const session = {
    id: 'session-1',
    title: 'sample',
    createdAt: 1,
    updatedAt: 1,
    mainVideoHandle: {},
    subtitleFileName: 'sample.srt',
    subtitleCues: [cue],
  };
  const rows = createUnknownWordCsvRows(session, {
    [frame.id]: {
      finishedCharIds: [],
      tags: [
        {
          id: 'tag-1',
          pastedCharIds: ['0'],
          content: 'ignorance',
          hint: {
            headword: 'take care',
            meaning: 'be careful\nlook after',
            selectedText: 'take care',
            selectedAt: 123,
          },
        },
        {
          id: 'tag-2',
          pastedCharIds: ['3'],
          content: 'ignorance',
        },
      ],
      updatedAt: 1,
    },
  });

  assert.deepEqual(rows, [{
    headword: 'take care',
    cueText: 'He said, "take care".',
    meaning: 'be careful\nlook after',
  }]);
  assert.equal(
    createUnknownWordCsv(rows),
    '"辞書の見出し語","字幕cue内容","辞書の意味"\n"take care","He said, ""take care"".","be careful\nlook after"',
  );
});

test('unknown word CSV rows can be created from stored external subtitle data', () => {
  const cue = { start: 0, end: 1, text: 'Keep your goal in mind.' };
  const frame = subtitleCueToCaptionFrame(cue);
  const subtitle = {
    fileName: 'external.srt',
    cues: [cue],
  };
  const rows = createStoredSubtitleUnknownWordCsvRows(subtitle, {
    [frame.id]: {
      finishedCharIds: [],
      tags: [{
        id: 'tag-1',
        pastedCharIds: ['0'],
        content: 'ignorance',
        hint: {
          headword: 'keep ~ in mind',
          meaning: 'remember something',
          selectedText: 'Keep your goal in mind',
          selectedAt: 123,
        },
      }],
    },
  });

  assert.deepEqual(rows, [{
    headword: 'keep ~ in mind',
    cueText: 'Keep your goal in mind.',
    meaning: 'remember something',
  }]);
});

test('type review frames include only cues with ignorance or unaudible tags and reset typing progress', () => {
  const cues = [
    { start: 0, end: 1, text: 'I missed this word.' },
    { start: 2, end: 3, text: 'I typed this cleanly.' },
    { start: 4, end: 5, text: 'I could not hear this.' },
    { start: 6, end: 7, text: 'Only a typo here.' },
  ];
  const frames = cues.map((cue) => ({
    ...subtitleCueToCaptionFrame(cue),
    start: cue.start,
    end: cue.end,
  }));
  const session = {
    id: 'session-1',
    title: 'sample',
    createdAt: 1,
    updatedAt: 1,
    mainVideoHandle: {},
    subtitleFileName: 'sample.srt',
    subtitleCues: cues,
    typingFrames: frames,
  };
  const reviewFrames = buildSessionTypeReviewFrames(session, {
    [frames[0].id]: {
      finishedCharIds: frames[0].caption.filter((char) => char.isTypeable).map((char) => char.id),
      tags: [{ id: 'tag-1', pastedCharIds: [frames[0].caption[2].id], content: 'ignorance' }],
      updatedAt: 1,
    },
    [frames[2].id]: {
      finishedCharIds: ['old-finished'],
      tags: [{ id: 'tag-2', pastedCharIds: [frames[2].caption[2].id], content: 'unaudible' }],
      updatedAt: 2,
    },
    [frames[3].id]: {
      finishedCharIds: [],
      tags: [{ id: 'tag-3', pastedCharIds: [frames[3].caption[5].id], content: 'spelling' }],
      updatedAt: 3,
    },
  });
  const reviewProgress = createTypeReviewTypingProgress(reviewFrames);

  assert.deepEqual(reviewFrames.map((reviewFrame) => reviewFrame.cue.text), [
    'I missed this word.',
    'I could not hear this.',
  ]);
  assert.deepEqual(reviewProgress[frames[0].id], {
    finishedCharIds: [],
    tags: [{ id: 'tag-1', pastedCharIds: [frames[0].caption[2].id], content: 'ignorance' }],
    updatedAt: undefined,
  });
  assert.deepEqual(reviewProgress[frames[2].id], {
    finishedCharIds: [],
    tags: [{ id: 'tag-2', pastedCharIds: [frames[2].caption[2].id], content: 'unaudible' }],
    updatedAt: undefined,
  });
});
