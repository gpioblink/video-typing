import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createDefaultDictionaryInitializer, DEFAULT_DICTIONARY } from '../src/lib/defaultDictionary.ts';
import { parseDictionaryTsv } from '../src/lib/dictionary.ts';

const bytes = readFileSync(new URL('../public/dictionaries/ejdict-2dd9e71.tsv', import.meta.url));
function harness(patches = {}) {
  const memory = new Map();
  const state = { count: 0, imports: 0, fetches: 0, recoveries: 0 };
  const dependencies = {
    count: async () => state.count,
    fetch: async () => { state.fetches += 1; return new Response(bytes); },
    import: async (source, text) => {
      state.imports += 1;
      assert.equal(source, DEFAULT_DICTIONARY.sourceName);
      assert.equal(Buffer.byteLength(text), DEFAULT_DICTIONARY.bytes);
      state.count = DEFAULT_DICTIONARY.entries;
      return { imported: state.count, total: state.count, skipped: 1 };
    },
    recover: async () => { state.recoveries += 1; state.count = 0; },
    storage: { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) },
    withLock: work => work(),
    ...patches,
  };
  return { state, memory, dependencies, ensure: createDefaultDictionaryInitializer(dependencies) };
}

test('bundled CC0 snapshot matches pinned size/hash and existing TSV parser finds common words and spelling aliases', () => {
  assert.equal(bytes.length, DEFAULT_DICTIONARY.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), DEFAULT_DICTIONARY.sha256);
  const { entries } = parseDictionaryTsv(bytes.toString('utf8'));
  assert.equal(entries.length, DEFAULT_DICTIONARY.entries);
  assert.equal(new Set(entries.map(entry => `${entry.normalizedHeadword}\0${entry.body}`)).size, entries.length);
  for (const word of ['hello', 'blade', 'alone', 'remember', 'passion', 'tender', 'color', 'colour']) {
    assert.ok(entries.some(entry => entry.normalizedHeadword === word && /[\u3040-\u9fff]/.test(entry.body)), word);
  }
});

test('parallel startup calls share one import and later calls/reloads skip an existing dictionary', async () => {
  const h = harness();
  const first = h.ensure();
  assert.equal(h.ensure(), first);
  assert.deepEqual(await first, { status: 'imported', count: DEFAULT_DICTIONARY.entries });
  assert.equal(h.state.imports, 1);
  assert.equal(h.state.fetches, 1);
  assert.deepEqual(await h.ensure(), { status: 'existing', count: DEFAULT_DICTIONARY.entries });
  assert.deepEqual(await createDefaultDictionaryInitializer(h.dependencies)(), { status: 'existing', count: DEFAULT_DICTIONARY.entries });
  assert.equal(h.state.imports, 1);
  assert.equal(h.state.fetches, 1);
});

test('a preferred dictionary present initially or imported during download is neither mixed nor replaced', async () => {
  const initial = harness(); initial.state.count = 17;
  assert.deepEqual(await initial.ensure(), { status: 'existing', count: 17 });
  assert.equal(initial.state.fetches, 0);
  assert.equal(initial.state.imports, 0);
  const concurrent = harness();
  concurrent.dependencies.fetch = async () => { concurrent.state.count = 23; return new Response(bytes); };
  const ensure = createDefaultDictionaryInitializer(concurrent.dependencies);
  assert.deepEqual(await ensure(), { status: 'existing', count: 23 });
  assert.equal(concurrent.state.imports, 0);
});

test('asset failures and partially committed imports can be retried without treating partial data as a complete dictionary', async () => {
  const h = harness();
  let attempts = 0;
  h.dependencies.fetch = async () => { if (attempts++ === 0) throw new Error('offline'); return new Response(bytes); };
  const ensure = createDefaultDictionaryInitializer(h.dependencies);
  await assert.rejects(ensure(), /offline/);
  assert.deepEqual(await ensure(), { status: 'imported', count: DEFAULT_DICTIONARY.entries });
  const partial = harness(); let imports = 0;
  const successfulImport = partial.dependencies.import;
  partial.dependencies.import = async (...args) => {
    if (imports++ === 0) { partial.state.count = 5000; throw new Error('quota'); }
    return successfulImport(...args);
  };
  const retry = createDefaultDictionaryInitializer(partial.dependencies);
  await assert.rejects(retry(), /quota/);
  assert.equal(partial.state.recoveries, 1);
  assert.equal(partial.state.count, 0);
  assert.deepEqual(await retry(), { status: 'imported', count: DEFAULT_DICTIONARY.entries });
});

test('a reload recovers an interrupted default import before preserving a newly imported custom dictionary', async () => {
  const h = harness();
  h.memory.set('videoTypingDefaultDictionaryPending', DEFAULT_DICTIONARY.sourceName);
  h.state.count = 5007;
  h.dependencies.recover = async () => { h.state.recoveries += 1; h.state.count = 7; };
  assert.deepEqual(await createDefaultDictionaryInitializer(h.dependencies)(), { status: 'existing', count: 7 });
  assert.equal(h.state.recoveries, 1);
  assert.equal(h.state.imports, 0);
});

test('wrong-size or changed same-size assets fail before entering the dictionary importer', async () => {
  for (const asset of [Buffer.from('not a dictionary'), Buffer.from(bytes)]) {
    if (asset.length === bytes.length) asset[0] ^= 1;
    const h = harness({ fetch: async () => new Response(asset) });
    await assert.rejects(h.ensure(), /標準辞書/);
    assert.equal(h.state.imports, 0);
    assert.equal(h.state.recoveries, 0);
  }
});
