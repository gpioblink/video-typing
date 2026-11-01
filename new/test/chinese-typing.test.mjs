import assert from 'node:assert/strict';
import test from 'node:test';
import { CHINESE_TYPING_FORMAT, isChineseTypingJsonFile, parseChineseTypingJson } from '../src/lib/chineseTyping.ts';
import {
  buildStoredSubtitleReviewFrames, buildStoredSubtitleTypeReviewFrames,
  createStoredSubtitleUnknownWordCsvRows, createTypeReviewTypingProgress,
} from '../src/lib/localPlayerReview.ts';

function fixture() {
  return {
    format: CHINESE_TYPING_FORMAT,
    sourceFileName: 'original-chinese.srt',
    typingFrames: [{
      id: 'chinese-unicode-frame', start: 1, end: 3,
      caption: Array.from('🌏ni3 hao3，界', (char, index) => ({ id: `char-${index}`, char, isTypeable: /[A-Za-z1-4]/.test(char) })),
      tags: [],
      words: [
        { sourceText: '你好', pinyin: 'ni3 hao3', startCharId: 'char-1', endCharId: 'char-8', dictionaryFound: true },
        { sourceText: '界', pinyin: '', startCharId: 'char-10', endCharId: 'char-10', dictionaryFound: false },
      ],
    }],
    sourceCues: [{ start: 1, end: 3, text: '🌏你好，界' }],
  };
}

const parse = value => parseChineseTypingJson('original.json', JSON.stringify(value));

test('Chinese typing JSON keeps source Unicode, tone digits and literal fallback characters', () => {
  const input = fixture();
  const parsed = parse(input);
  assert.deepEqual(parsed, input);
  const frame = parsed.typingFrames[0];
  assert.equal(frame.caption[0].char, '🌏');
  assert.equal(frame.caption[0].isTypeable, false);
  assert.equal(frame.caption.at(-1).char, '界');
  assert.equal(frame.caption.at(-1).isTypeable, false);
  assert.equal(frame.caption.filter(char => char.isTypeable).map(char => char.char).join(''), 'ni3hao3');
  assert.equal(parsed.sourceCues[0].text, '🌏你好，界');
});

test('word ranges use character IDs and remain correct after astral Unicode literals', () => {
  const frame = parse(fixture()).typingFrames[0];
  const selected = frame.words.map(word => {
    const start = frame.caption.findIndex(char => char.id === word.startCharId);
    const end = frame.caption.findIndex(char => char.id === word.endCharId);
    return { source: word.sourceText, caption: frame.caption.slice(start, end + 1).map(char => char.char).join('') };
  });
  assert.deepEqual(selected, [{ source: '你好', caption: 'ni3 hao3' }, { source: '界', caption: '界' }]);
});

test('older typing frames without optional words and tags still load', () => {
  const input = fixture();
  delete input.typingFrames[0].words;
  delete input.typingFrames[0].tags;
  const frame = parse(input).typingFrames[0];
  assert.deepEqual(frame.words, []);
  assert.deepEqual(frame.tags, []);
});

test('Chinese import rejects malformed JSON and unsupported document envelopes', () => {
  assert.throws(() => parseChineseTypingJson('bad.json', '{'), /not valid JSON/);
  for (const value of [null, false, 42, 'text']) assert.throws(() => parse(value), /JSON object/);
  const wrongFormat = fixture(); wrongFormat.format = 'unrelated-format';
  assert.throws(() => parse(wrongFormat), /video-typing-chinese-v1/);
  const missingName = fixture(); delete missingName.sourceFileName;
  assert.throws(() => parse(missingName), /sourceFileName/);
  const noFrames = fixture(); noFrames.typingFrames = [];
  assert.throws(() => parse(noFrames), /typingFrames/);
  const noCues = fixture(); noCues.sourceCues = [];
  assert.throws(() => parse(noCues), /sourceCues/);
});

test('Chinese import rejects malformed frame, character, cue and word records', () => {
  const cases = [
    input => { input.typingFrames[0] = null; },
    input => { input.typingFrames[0].start = '1'; },
    input => { input.typingFrames[0].caption = {}; },
    input => { input.typingFrames[0].caption[0].isTypeable = 'false'; },
    input => { input.typingFrames[0].caption[0].char = 1; },
    input => { input.sourceCues[0].text = 1; },
    input => { input.sourceCues[0].end = '3'; },
    input => { input.typingFrames[0].words[0].startCharId = 1; },
    input => { input.typingFrames[0].words[0].dictionaryFound = 'true'; },
  ];
  for (const mutate of cases) {
    const input = fixture(); mutate(input);
    assert.throws(() => parse(input), /Invalid/);
  }
});

test('non-finite JSON numeric literals are rejected before reaching playback', () => {
  const text = JSON.stringify(fixture());
  assert.throws(() => parseChineseTypingJson('infinite-frame.json', text.replace('"start":1', '"start":1e309')), /Invalid typing frame/);
  const sourceIndex = text.indexOf('"sourceCues"');
  const infiniteCue = text.slice(0, sourceIndex) + text.slice(sourceIndex).replace('"end":3', '"end":1e309');
  assert.throws(() => parseChineseTypingJson('infinite-cue.json', infiniteCue), /Invalid source cue/);
});

test('existing Chinese mistake tags retain their category and selected character IDs', () => {
  const input = fixture();
  input.typingFrames[0].tags = [
    { id: 'heard', pastedCharIds: ['char-1', 'char-2', 'char-3'], content: 'unaudible' },
    { id: 'typed', pastedCharIds: ['char-5', 'char-6'], content: 'spelling' },
  ];
  assert.deepEqual(parse(input).typingFrames[0].tags, input.typingFrames[0].tags);
  input.typingFrames[0].tags[0].content = 'invalid-category';
  assert.throws(() => parse(input), /Invalid tag/);
});

test('Chinese imported frames preserve original cue text and dictionary hints through review and CSV', () => {
  const imported = parse(fixture());
  const frame = imported.typingFrames[0];
  const subtitle = { fileName: imported.sourceFileName, cues: imported.sourceCues, typingFrames: imported.typingFrames };
  const tag = {
    id: 'unknown', pastedCharIds: ['char-1', 'char-2', 'char-3'], content: 'ignorance',
    hint: { headword: '你好', meaning: 'こんにちは（オリジナルテスト定義）', selectedText: 'ni3', selectedAt: 1 },
  };
  const progress = { [frame.id]: { finishedCharIds: frame.caption.filter(char => char.isTypeable).map(char => char.id), tags: [tag], updatedAt: 2 } };
  const allFrames = buildStoredSubtitleReviewFrames(subtitle, progress);
  assert.equal(allFrames[0].cue.text, '🌏你好，界');
  assert.deepEqual(allFrames[0].frame.words, frame.words);
  const review = buildStoredSubtitleTypeReviewFrames(subtitle, progress);
  assert.equal(review.length, 1);
  assert.deepEqual(createTypeReviewTypingProgress(review)[frame.id], { finishedCharIds: [], tags: [tag], updatedAt: undefined });
  assert.deepEqual(createStoredSubtitleUnknownWordCsvRows(subtitle, progress), [{
    headword: '你好', cueText: '🌏你好，界', meaning: 'こんにちは（オリジナルテスト定義）',
  }]);
});

test('Chinese JSON file detection accepts case-insensitive JSON and keeps subtitle files separate', () => {
  assert.equal(isChineseTypingJsonFile('lesson.JSON'), true);
  assert.equal(isChineseTypingJsonFile('lesson.json'), true);
  assert.equal(isChineseTypingJsonFile('lesson.srt'), false);
  assert.equal(isChineseTypingJsonFile('lesson.json.txt'), false);
});

test('Chinese import rejects negative, reversed and zero-length frame and source-cue times', () => {
  for (const collection of ['typingFrames', 'sourceCues']) {
    for (const [start, end] of [[-1, 3], [3, 1], [1, 1]]) {
      const input = fixture();
      Object.assign(input[collection][0], { start, end });
      assert.throws(() => parse(input), /Invalid/, `${collection}: ${start}–${end}`);
    }
  }
});

test('Chinese import rejects duplicate frame IDs that would collide in stored progress', () => {
  const input = fixture();
  input.typingFrames.push({ ...structuredClone(input.typingFrames[0]), start: 4, end: 6 });
  assert.throws(() => parse(input), /Duplicate typing frame ID/);
});

test('Chinese import rejects duplicate character IDs within a frame', () => {
  const input = fixture();
  input.typingFrames[0].caption[2].id = input.typingFrames[0].caption[1].id;
  assert.throws(() => parse(input), /Duplicate caption character ID/);
});

test('Chinese import rejects missing and reversed word-range references', () => {
  for (const [startCharId, endCharId] of [['missing', 'char-8'], ['char-1', 'missing'], ['char-8', 'char-1']]) {
    const input = fixture();
    Object.assign(input.typingFrames[0].words[0], { startCharId, endCharId });
    assert.throws(() => parse(input), /Invalid Chinese typing word range/);
  }
});

test('Chinese range validation supports arbitrary Unicode IDs and IDs reused in different frames', () => {
  const input = fixture();
  input.typingFrames[0].caption.forEach(char => { char.id = `字🌏-${char.id}`; });
  input.typingFrames[0].words.forEach(word => {
    word.startCharId = `字🌏-${word.startCharId}`;
    word.endCharId = `字🌏-${word.endCharId}`;
  });
  const second = structuredClone(input.typingFrames[0]);
  Object.assign(second, { id: '別の問題🌏', start: 4, end: 6 });
  input.typingFrames.push(second);
  const parsed = parse(input);
  assert.equal(parsed.typingFrames.length, 2);
  assert.deepEqual(parsed.typingFrames[0].words, input.typingFrames[0].words);
  assert.deepEqual(parsed.typingFrames[1].caption, input.typingFrames[0].caption);
});

test('imported Chinese unknown-word meanings survive parsing and remain exportable', () => {
  const input = fixture();
  const hint = { headword: '你好', meaning: 'Original greeting definition.', dictionaryEntryKey: 'test-entry', selectedText: '你好', selectedAt: 123 };
  input.typingFrames[0].tags = [{ id:'unknown', pastedCharIds:['char-1','char-2','char-3'], content:'ignorance', hint }];
  const parsed = parse(input);
  assert.deepEqual(parsed.typingFrames[0].tags[0].hint,hint);
  const rows = createStoredSubtitleUnknownWordCsvRows({fileName:'test.json',cues:parsed.sourceCues,typingFrames:parsed.typingFrames},{});
  assert.equal(rows[0].headword,'你好');assert.equal(rows[0].meaning,hint.meaning);
});
test('frame IDs cannot collide with the progress object prototype', () => {
  for(const id of ['__proto__','constructor','toString','']) {
    const input=fixture();input.typingFrames[0].id=id;
    assert.throws(()=>parse(input),/typing frame/);
  }
});
