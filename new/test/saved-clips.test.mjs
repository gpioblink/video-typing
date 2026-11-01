import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addSavedClip, clipSource, deleteSavedClip, isMatchingClipSource, loadSavedClips,
  MAX_SAVED_CLIPS, normalizeSavedClips, saveClip, SAVED_CLIPS_KEY,
} from '../src/lib/savedClips.ts';

const input = (overrides = {}) => ({
  title: 'A short practice clip', url: 'https://www.netflix.com/watch/12345678?trackId=testing',
  start: 10, end: 55, language: 'en', ...overrides,
});

function memoryStorage(initial = []) {
  let records = structuredClone(initial);
  let writes = 0;
  return {
    async get(key) { assert.equal(key, SAVED_CLIPS_KEY); return { [key]: structuredClone(records) }; },
    async set(value) { records = structuredClone(value[SAVED_CLIPS_KEY]); writes++; },
    async remove() { throw new Error('Unexpected storage removal'); },
    records: () => records,
    writes: () => writes,
  };
}

test('saved clips contain only bounded source metadata, including validated range and language', () => {
  const [clip] = addSavedClip([], { ...input({ title: '  My clip  ', language: 'en-US' }), subtitles: 'must not be saved', videoData: 'must not be saved' });
  assert.equal(clip.title, 'My clip');
  assert.equal(clip.url, 'https://www.netflix.com/watch/12345678');
  assert.equal(clip.kind, 'netflix');
  assert.equal(clip.language, 'en-us');
  assert.deepEqual(Object.keys(clip).sort(), ['createdAt', 'end', 'id', 'kind', 'language', 'start', 'title', 'url']);
  assert.ok(Number.isSafeInteger(clip.createdAt));
  assert.ok(clip.id);
  for (const overrides of [
    { title: '' }, { title: 'x'.repeat(201) }, { title: 'bad\nname' },
    { start: -1 }, { start: Number.NaN }, { end: Infinity }, { start: 10, end: 10 }, { end: 101 },
    { language: '' }, { language: 'invalid language' }, { language: '<script>' },
  ]) assert.throws(() => addSavedClip([], input(overrides)));
});

test('YouTube and Netflix identities match the actual video across tracking and share URLs', () => {
  const [youtube] = addSavedClip([], input({ url: 'https://youtu.be/M7lc1UVf-VE?t=12' }));
  assert.equal(youtube.url, 'https://www.youtube.com/watch?v=M7lc1UVf-VE');
  assert.equal(youtube.kind, 'youtube');
  for (const url of ['https://www.youtube.com/watch?v=M7lc1UVf-VE&feature=share', 'https://m.youtube.com/watch?v=M7lc1UVf-VE&t=20s', 'https://www.youtube.com/embed/M7lc1UVf-VE']) {
    assert.equal(isMatchingClipSource(youtube, url), true);
  }
  assert.equal(isMatchingClipSource(youtube, 'https://www.youtube.com/watch?v=abcdefghijk'), false);
  const [netflix] = addSavedClip([], input());
  assert.equal(isMatchingClipSource(netflix, 'https://netflix.com/watch/12345678?track=other#anything'), true);
  assert.equal(isMatchingClipSource(netflix, 'https://www.netflix.com/watch/87654321'), false);
  assert.equal(isMatchingClipSource(netflix, 'https://www.netflix.com.evil.test/watch/12345678'), false);
});

test('generic HTTPS video pages preserve content-identifying URL parts', () => {
  const [clip] = addSavedClip([], input({ url: 'https://media.example.test/lesson?id=2#player' }));
  assert.equal(clip.kind, 'html5');
  assert.equal(isMatchingClipSource(clip, 'https://media.example.test/lesson?id=2#player'), true);
  assert.equal(isMatchingClipSource(clip, 'https://media.example.test/lesson?id=3#player'), false);
  assert.equal(isMatchingClipSource(clip, 'https://media.example.test/lesson?id=2#other'), false);
});

test('unsafe source URLs and non-watch Netflix routes are rejected before saving or opening', () => {
  for (const url of [
    'http://example.test/video', 'javascript:alert(1)', 'data:text/html,test', 'file:///video.mp4',
    'https://user:password@example.test/video', 'https://example.test:444/video',
    'https://www.netflix.com/title/12345', 'https://www.netflix.com/watch/not-an-id', 'https://www.netflix.com/watch/0',
    'https://www.youtube.com/channel/testing', 'https://youtu.be/invalid', 'https://example.test/\nvideo',
    `https://example.test/${'a'.repeat(2048)}`, `https://example.test/${'界'.repeat(300)}`,
  ]) assert.throws(() => clipSource(url), url);
  assert.equal(isMatchingClipSource(addSavedClip([], input())[0], 'chrome://newtab'), false);
});

test('saving the same source/range/language updates its title without duplicating or changing its identity', () => {
  const [first] = addSavedClip([], input());
  const clips = addSavedClip([first], input({ title: 'Renamed', url: 'https://netflix.com/watch/12345678?other=1' }));
  assert.equal(clips.length, 1);
  assert.equal(clips[0].id, first.id);
  assert.equal(clips[0].createdAt, first.createdAt);
  assert.equal(clips[0].title, 'Renamed');
  const differentLanguage = addSavedClip(clips, input({ language: 'zh-CN' }));
  assert.equal(differentLanguage.length, 2);
});

test('stored malformed and duplicate records are filtered with a strict twenty-record read bound', () => {
  const [valid] = addSavedClip([], input());
  const clean = normalizeSavedClips([null, {}, { ...valid, subtitleText: 'drop' }, valid, { ...valid, id: 'other' }]);
  assert.equal(clean.length, 1);
  assert.equal('subtitleText' in clean[0], false);
  assert.deepEqual(normalizeSavedClips({ clips: [valid] }), []);
  assert.equal(normalizeSavedClips(Array.from({ length: 100 }, (_, index) => ({ ...valid, id: `clip-${index}`, start: index, end: index + 45 }))).length, MAX_SAVED_CLIPS);
});

test('private storage rejects a twenty-first clip without dropping existing saved clips', async () => {
  const storage = memoryStorage();
  for (let index = 0; index < MAX_SAVED_CLIPS; index++) await saveClip(input({ start: index, end: index + 45 }), storage);
  const before = storage.records();
  await assert.rejects(saveClip(input({ start: 100, end: 145 }), storage), /20件/);
  assert.deepEqual(storage.records(), before);
  assert.equal(storage.writes(), MAX_SAVED_CLIPS);
  await saveClip(input({ title: 'Updated at capacity', start: 0, end: 45 }), storage);
  assert.equal(storage.records().length, MAX_SAVED_CLIPS);
  assert.equal(storage.records()[0].title, 'Updated at capacity');
});

test('concurrent save/delete actions serialize without losing another saved clip', async () => {
  const storage = memoryStorage();
  await Promise.all([saveClip(input(), storage), saveClip(input({ start: 20, end: 65 }), storage)]);
  const saved = await loadSavedClips(storage);
  assert.equal(saved.length, 2);
  await Promise.all([deleteSavedClip(saved[0].id, storage), saveClip(input({ start: 30, end: 75 }), storage)]);
  const result = await loadSavedClips(storage);
  assert.deepEqual(result.map(clip => clip.start), [30, 10]);
});

test('storage failures remain visible and do not poison later mutations', async () => {
  const storage = memoryStorage();
  let fail = true;
  const failing = { ...storage, async set(value) { if (fail) throw new Error('Storage full'); await storage.set(value); } };
  await assert.rejects(saveClip(input(), failing), /Storage full/);
  assert.equal(storage.records().length, 0);
  fail = false;
  await saveClip(input(), failing);
  assert.equal(storage.records().length, 1);
});
