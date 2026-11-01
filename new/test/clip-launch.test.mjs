import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipStorageKey, defaultClipRange, selectSubtitleForClip, validateClipRange } from '../src/lib/clipLaunch.ts';

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
