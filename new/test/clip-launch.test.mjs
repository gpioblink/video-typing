import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipStorageKey, defaultClipRange, readVideoClipContext, selectSubtitleForClip, validateClipRange, videoPageIdentity } from '../src/lib/clipLaunch.ts';
import { buildStoredSubtitleTypeReviewFrames, createStoredSubtitleUnknownWordCsvRows } from '../src/lib/localPlayerReview.ts';
import { subtitleCueToCaptionFrame } from '../src/lib/subtitles.ts';
import { clearStoredProgressState, clearStoredSubtitleSetting, loadStoredSubtitle, loadStoredTypingProgress, saveStoredSubtitle, saveStoredTypingProgress } from '../src/lib/storage.ts';

test('native launch accepts finite increasing ranges of at most ninety seconds', () => {
  assert.deepEqual(validateClipRange({ start: 12.5, end: 57.5 }), { start: 12.5, end: 57.5 });
  assert.deepEqual(validateClipRange({ start: 0, end: 90 }), { start: 0, end: 90 });
  for (const value of [undefined, null, [], '0:45', {}, { start: '0', end: 45 }, { start: -1, end: 40 }, { start: 10, end: 10 }, { start: 10, end: 9 }, { start: 0, end: 90.01 }, { start: Number.NaN, end: 40 }, { start: 0, end: Infinity }]) {
    assert.throws(() => validateClipRange(value), /開始|終了/);
  }
});

test('popup defaults to the current forty-five seconds and respects finite media ends', () => {
  assert.deepEqual(defaultClipRange(12, 120), { start: 12, end: 57 });
  assert.deepEqual(defaultClipRange(100, 120), { start: 100, end: 120 });
  assert.deepEqual(defaultClipRange(120, 120), { start: 75, end: 120 });
  assert.deepEqual(defaultClipRange(Number.NaN, Infinity), { start: 0, end: 45 });
  assert.deepEqual(defaultClipRange(-10, 30), { start: 0, end: 30 });
});

test('clip progress keys isolate source pages, ranges and full-movie progress', () => {
  const page = 'https://www.netflix.com/watch/12345?track=en#position';
  const first = createClipStorageKey(page, { start: 10, end: 55 });
  assert.notEqual(first, page);
  assert.equal(first, createClipStorageKey(page, { start: 10, end: 55 }));
  assert.notEqual(first, createClipStorageKey(page, { start: 11, end: 56 }));
  assert.notEqual(first, createClipStorageKey('https://www.netflix.com/watch/54321?track=en#position', { start: 10, end: 55 }));
  assert.throws(() => createClipStorageKey('', { start: 0, end: 45 }), /URL/);
  assert.throws(() => createClipStorageKey(page, { start: 10, end: 200 }), /開始|終了/);
});

test('native clip selects real subtitle cues without changing full source data or Netflix tracks', () => {
  const subtitle = {
    fileName: 'original.vtt',
    cues: [
      { start: 0, end: 15, text: 'An original sentence.' },
      { start: 20, end: 35, text: 'Another original sentence.' },
      { start: 70, end: 80, text: 'A later sentence.' },
    ],
    displaySubtitleFileName: 'native.vtt',
    displaySubtitleCues: [{ start: 0, end: 15, text: '元の字幕' }],
    netflix: { englishSubtitleTrackId: 'track-en', englishAudioTrackId: 'audio-en', nativeSubtitleTrackId: 'track-ja' },
  };
  const original = structuredClone(subtitle);
  const selected = selectSubtitleForClip(subtitle, { start: 10, end: 40 });
  assert.deepEqual(selected.cues, [
    { start: 10, end: 15, text: 'An original sentence.' },
    { start: 20, end: 35, text: 'Another original sentence.' },
  ]);
  assert.deepEqual(selected.netflix, subtitle.netflix);
  assert.deepEqual(selected.displaySubtitleCues, subtitle.displaySubtitleCues);
  assert.equal(selected.fileName, 'original.vtt');
  assert.deepEqual(subtitle, original, 'source can be saved/reused under its full-movie URL');
  assert.throws(() => selectSubtitleForClip(subtitle, { start: 40, end: 60 }), /字幕/);
});

test('Chinese and custom typing frames retain IDs, tags and words across clipped boundaries', () => {
  const frame = (id, start, end, text) => ({
    id, start, end,
    caption: Array.from(text, (char, index) => ({ id: `${id}-${index}`, char, isTypeable: /[a-z]/i.test(char) })),
    tags: [{ id: `${id}-tag`, pastedCharIds: [`${id}-0`], content: 'unaudible' }],
    words: [{ sourceText: '你好', pinyin: text, startCharId: `${id}-0`, endCharId: `${id}-1`, dictionaryFound: true }],
  });
  const subtitle = {
    fileName: 'chinese.srt',
    cues: [{ start: 0, end: 10, text: '你好，世界。' }],
    typingFrames: [frame('pinyin-first', 0, 5, 'ni hao'), frame('pinyin-second', 5, 10, 'shi jie'), frame('pinyin-later', 20, 25, 'zai jian')],
  };
  const original = structuredClone(subtitle);
  const selected = selectSubtitleForClip(subtitle, { start: 2, end: 8 });
  assert.deepEqual(selected.typingFrames.map(item => [item.id, item.start, item.end]), [['pinyin-first', 2, 5], ['pinyin-second', 5, 8]]);
  assert.deepEqual(selected.cues, [{ start: 2, end: 5, text: '你好，世界。' }, { start: 5, end: 8, text: '你好，世界。' }]);
  assert.deepEqual(selected.typingFrames[0].caption, subtitle.typingFrames[0].caption);
  assert.deepEqual(selected.typingFrames[1].tags, subtitle.typingFrames[1].tags);
  assert.deepEqual(selected.typingFrames[1].words, subtitle.typingFrames[1].words);
  assert.deepEqual(subtitle, original);
});

test('YouTube page identity follows video IDs and ignores native time and playlist navigation', () => {
  const watch = 'https://www.youtube.com/watch?v=eRsGyueVLvQ';
  for (const url of [
    `${watch}&t=130s&list=PL-original#position`,
    'https://m.youtube.com/watch?list=PL-other&v=eRsGyueVLvQ&t=5',
    'https://youtu.be/eRsGyueVLvQ?t=20',
    'https://www.youtube.com/embed/eRsGyueVLvQ?start=12',
    'https://www.youtube.com/shorts/eRsGyueVLvQ',
  ]) assert.equal(videoPageIdentity(url), videoPageIdentity(watch));
  assert.notEqual(videoPageIdentity('https://www.youtube.com/watch?v=R6MlUcmOul8'), videoPageIdentity(watch));
  assert.notEqual(videoPageIdentity('https://youtube.com.evil.example/watch?v=eRsGyueVLvQ'), videoPageIdentity(watch));
});

test('Netflix page identity follows watch IDs while unrelated pages keep exact URLs', () => {
  const watch = 'https://www.netflix.com/watch/12345';
  assert.equal(videoPageIdentity(`${watch}?track=en&t=100#subtitles`), videoPageIdentity(watch));
  assert.equal(videoPageIdentity('https://www.netflix.com/jp/watch/12345?audio=ja'), videoPageIdentity(watch));
  assert.notEqual(videoPageIdentity('https://www.netflix.com/watch/54321'), videoPageIdentity(watch));
  assert.notEqual(videoPageIdentity('https://netflix.com.evil.example/watch/12345'), videoPageIdentity(watch));
  assert.notEqual(videoPageIdentity('https://www.netflix.com/title/12345'), videoPageIdentity(watch));
  assert.notEqual(videoPageIdentity('https://example.com/watch?time=1'), videoPageIdentity('https://example.com/watch?time=2'));
  assert.equal(videoPageIdentity('not-a-url'), 'not-a-url');
});

test('active clip context derives its key from validated source identity and range', () => {
  const sourcePageUrl = 'https://www.youtube.com/watch?v=eRsGyueVLvQ&t=5';
  const current = 'https://www.youtube.com/watch?v=eRsGyueVLvQ&t=130&list=PL-test';
  const range = { start: 107, end: 156 };
  const context = readVideoClipContext(current, JSON.stringify({ sourcePageUrl, range, storageKey: 'arbitrary-private-key' }));
  assert.deepEqual(context, { sourcePageUrl, range });
  assert.equal(createClipStorageKey(context.sourcePageUrl, context.range), createClipStorageKey(sourcePageUrl, range));
  assert.notEqual(createClipStorageKey(context.sourcePageUrl, context.range), 'arbitrary-private-key');
  assert.equal(readVideoClipContext('https://www.youtube.com/watch?v=R6MlUcmOul8', JSON.stringify({ sourcePageUrl, range })), undefined);
  assert.equal(readVideoClipContext('https://example.com/', JSON.stringify({ sourcePageUrl, range })), undefined);
});

test('active clip context rejects untrusted malformed, cross-video and invalid-range DOM attributes', () => {
  const sourcePageUrl = 'https://www.netflix.com/watch/12345';
  const valid = { sourcePageUrl, range: { start: 0, end: 45 } };
  const bad = [
    null, undefined, {}, '{not-json', JSON.stringify(null), JSON.stringify([]),
    JSON.stringify({ ...valid, sourcePageUrl: 'javascript:alert(1)' }),
    JSON.stringify({ ...valid, sourcePageUrl: 'netflix:12345' }),
    JSON.stringify({ ...valid, sourcePageUrl: 'https://user:password@www.netflix.com/watch/12345' }),
    JSON.stringify({ ...valid, sourcePageUrl: 'https://www.netflix.com/watch/54321' }),
    JSON.stringify({ ...valid, range: { start: -1, end: 45 } }),
    JSON.stringify({ ...valid, range: { start: 0, end: 91 } }),
    JSON.stringify({ ...valid, range: { start: 10, end: 10 } }),
    JSON.stringify({ ...valid, range: { start: '0', end: 45 } }),
    'x'.repeat(16385),
  ];
  for (const value of bad) assert.equal(readVideoClipContext(sourcePageUrl, value), undefined);
  assert.deepEqual(readVideoClipContext(`${sourcePageUrl}?track=ja`, JSON.stringify(valid)), valid);
});

test('saved native clip subtitle aliases share exact progress IDs with popup review and exports while preserving the full movie', async t => {
  const previousChrome = globalThis.chrome;
  const values = {};
  globalThis.chrome = { runtime: { id: 'clip-test' }, storage: { local: {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]])); },
    async set(next) { Object.assign(values, next); },
  } } };
  t.after(() => { globalThis.chrome = previousChrome; });
  const sourcePageUrl = 'https://www.youtube.com/watch?v=eRsGyueVLvQ';
  const source = { fileName: 'original.srt', cues: [
    { start: 0, end: 15, text: 'Original first sentence.' },
    { start: 20, end: 35, text: 'Original second sentence.' },
    { start: 70, end: 85, text: 'A later sentence.' },
  ] };
  const range = { start: 10, end: 40 };
  const clip = selectSubtitleForClip(source, range);
  const key = createClipStorageKey(sourcePageUrl, range);
  const fullFrame = subtitleCueToCaptionFrame(source.cues[0]);
  const clipFrame = subtitleCueToCaptionFrame(clip.cues[0]);
  assert.notEqual(clipFrame.id, fullFrame.id, 'a clipped boundary changes the English cue identity');
  await saveStoredSubtitle(sourcePageUrl, source);
  await saveStoredSubtitle(key, clip);
  await saveStoredTypingProgress(sourcePageUrl, fullFrame.id, { finishedCharIds: ['0'], tags: [], updatedAt: 1 });
  await saveStoredTypingProgress(key, clipFrame.id, {
    finishedCharIds: ['0'],
    tags: [{ id: 'unknown', pastedCharIds: ['0'], content: 'ignorance', hint: {
      headword: 'original', meaning: 'An original test definition.', selectedText: 'Original', selectedAt: 2,
    } }], updatedAt: 2,
  });
  const progress = await loadStoredTypingProgress(key);
  const alias = await loadStoredSubtitle(key);
  assert.equal(buildStoredSubtitleTypeReviewFrames(source, progress).length, 0, 'full-movie cue IDs cannot be used for clipped progress');
  assert.equal(buildStoredSubtitleTypeReviewFrames(alias, progress).length, 1);
  assert.deepEqual(createStoredSubtitleUnknownWordCsvRows(alias, progress), [{
    headword: 'original', cueText: 'Original first sentence.', meaning: 'An original test definition.',
  }]);
  await clearStoredProgressState(key);
  assert.deepEqual(await loadStoredTypingProgress(key), {});
  assert.deepEqual((await loadStoredTypingProgress(sourcePageUrl))[fullFrame.id].finishedCharIds, ['0']);
  await clearStoredSubtitleSetting(key);
  assert.equal(await loadStoredSubtitle(key), undefined);
  assert.deepEqual(await loadStoredSubtitle(sourcePageUrl), source);
});
