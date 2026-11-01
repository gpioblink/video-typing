import assert from 'node:assert/strict';
import test from 'node:test';
import { hasExtensionRuntime, localStorageArea } from '../src/lib/browserStorage.ts';
import { searchExtensionDictionary, searchExtensionChineseDictionary } from '../src/lib/dictionaryClient.ts';
import {
  clearStoredProgressState, loadOverlayConfig, loadPanelPosition, loadStoredTypingProgress,
  saveOverlayConfig, savePanelPosition, saveStoredTypingProgress,
} from '../src/lib/storage.ts';

function replaceGlobal(t, name, descriptor) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, ...descriptor });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

function webStorage(t) {
  const data = new Map();
  const storage = {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
  replaceGlobal(t, 'chrome', { value: { runtime: {}, storage: { local: { get() { throw new Error('not an extension'); } } } } });
  replaceGlobal(t, 'localStorage', { value: storage });
  return { data, storage };
}

test('normal browser stores JSON only in its application namespace', async t => {
  const { data } = webStorage(t);
  assert.equal(hasExtensionRuntime(), false);
  data.set('preferences', 'unrelated application');
  const original = { positions: [1, 2] };
  await localStorageArea.set({ preferences: original, progress: { done: true } });
  original.positions.push(3);
  assert.deepEqual(await localStorageArea.get(['preferences', 'progress', 'missing']), {
    preferences: { positions: [1, 2] }, progress: { done: true },
  });
  const copy = await localStorageArea.get('preferences');
  copy.preferences.positions.push(4);
  assert.deepEqual(await localStorageArea.get('preferences'), { preferences: { positions: [1, 2] } });
  assert.equal(data.get('preferences'), 'unrelated application');
  assert.ok(data.has('video-typing:web:v1:preferences'));
  await localStorageArea.remove('preferences');
  assert.deepEqual(await localStorageArea.get('preferences'), {});
  assert.equal(data.get('preferences'), 'unrelated application');
});

test('corrupt JSON cannot prevent other saved settings from loading', async t => {
  const { data } = webStorage(t);
  data.set('video-typing:web:v1:corrupt', '{bad json');
  data.set('video-typing:web:v1:valid', '{"enabled":true}');
  assert.deepEqual(await localStorageArea.get(['corrupt', 'valid']), { valid: { enabled: true } });
});

test('blocked localStorage access preserves independent settings in memory', async t => {
  replaceGlobal(t, 'chrome', { value: undefined });
  replaceGlobal(t, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
  await localStorageArea.set({ 'blocked-config': { enabled: true }, 'blocked-progress': ['1', '2'] });
  assert.deepEqual(await localStorageArea.get(['blocked-config', 'blocked-progress']), {
    'blocked-config': { enabled: true }, 'blocked-progress': ['1', '2'],
  });
  await localStorageArea.remove(['blocked-config', 'blocked-progress']);
  assert.deepEqual(await localStorageArea.get(['blocked-config', 'blocked-progress']), {});
});

test('failed writes and removals cannot resurrect older persistent progress', async t => {
  const { storage } = webStorage(t);
  await localStorageArea.set({ 'quota-progress': { count: 1 } });
  storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  await localStorageArea.set({ 'quota-progress': { count: 2 } });
  assert.deepEqual(await localStorageArea.get('quota-progress'), { 'quota-progress': { count: 2 } });
  storage.removeItem = () => { throw new Error('denied'); };
  await localStorageArea.remove('quota-progress');
  assert.deepEqual(await localStorageArea.get('quota-progress'), {});
});

test('actual extension delegates to chrome.storage without browser fallback', async t => {
  const calls = [];
  replaceGlobal(t, 'chrome', { value: { runtime: { id: 'real-extension-context' }, storage: { local: {
    async get(keys) { calls.push(['get', keys]); return { extensionOnly: 42 }; },
    async set(values) { calls.push(['set', values]); },
    async remove(keys) { calls.push(['remove', keys]); },
  } } } });
  replaceGlobal(t, 'localStorage', { get() { throw new Error('extension leaked into web storage'); } });
  assert.equal(hasExtensionRuntime(), true);
  assert.deepEqual(await localStorageArea.get(['extensionOnly']), { extensionOnly: 42 });
  await localStorageArea.set({ extensionOnly: 43 });
  await localStorageArea.remove('extensionOnly');
  assert.deepEqual(calls, [['get', ['extensionOnly']], ['set', { extensionOnly: 43 }], ['remove', 'extensionOnly']]);
});

test('extension API failures remain visible and never redirect its data to the web', async t => {
  const denied = new Error('extension context invalidated');
  replaceGlobal(t, 'chrome', { value: { runtime: { id: 'extension' }, storage: { local: {
    async get() { throw denied; }, async set() { throw denied; },
  } } } });
  await assert.rejects(localStorageArea.get('extensionOnly'), denied);
  await assert.rejects(localStorageArea.set({ extensionOnly: 1 }), denied);
});

test('shared overlay config, panels and typing progress work without chrome runtime', async t => {
  webStorage(t);
  await savePanelPosition('web.example', 'typing', { x: 10, y: 20 });
  assert.deepEqual(await loadPanelPosition('web.example', 'typing'), { x: 10, y: 20 });
  await saveOverlayConfig({
    slowPlayback: { enabled: false, mistakeThreshold: 2 },
    nativeReplay: { mistakeReplayEnabled: false, mistakeThreshold: 3, mistakeInterval: 2, completionReplayEnabled: false },
  });
  assert.equal((await loadOverlayConfig()).slowPlayback.enabled, false);
  await saveStoredTypingProgress('web-clip', 'frame', { finishedCharIds: ['1'], tags: [], updatedAt: 123 });
  assert.deepEqual(await loadStoredTypingProgress('web-clip'), { frame: { finishedCharIds: ['1'], tags: [], updatedAt: 123 } });
  await clearStoredProgressState('web-clip');
  assert.deepEqual(await loadStoredTypingProgress('web-clip'), {});
});

test('web dictionary clients invoke the existing IndexedDB lookup for each language', async t => {
  webStorage(t);
  const databases = [];
  const marker = new Error('test IndexedDB reached');
  replaceGlobal(t, 'IDBKeyRange', { value: { only: value => value, bound: (...values) => values } });
  replaceGlobal(t, 'indexedDB', { value: { open(name) {
    databases.push(name);
    const request = { error: marker };
    queueMicrotask(() => request.onerror());
    return request;
  } } });
  await assert.rejects(searchExtensionDictionary('hello', 'Hello world.'), marker);
  await assert.rejects(searchExtensionChineseDictionary('你好', '你好世界'), marker);
  assert.deepEqual(databases, ['videoTypingDictionary', 'videoTypingChineseDictionary']);
});

test('extension dictionary clients retain their background messages and response validation', async t => {
  const messages = [];
  const entry = { key: 'hello', headword: 'hello', normalizedHeadword: 'hello', body: 'Original greeting.', sourceName: 'test', importedAt: 1 };
  replaceGlobal(t, 'chrome', { value: { runtime: { id: 'extension', async sendMessage(message) {
    messages.push(message);
    return { entries: [entry, { invalid: true }] };
  } } } });
  assert.deepEqual(await searchExtensionDictionary('hello', 'context', 'en-1'), [entry]);
  assert.deepEqual(await searchExtensionChineseDictionary('你好', '上下文', 'zh-1'), [entry]);
  assert.deepEqual(messages, [
    { type: 'videoTypingDictionarySearch', query: 'hello', contextText: 'context', requestId: 'en-1' },
    { type: 'videoTypingChineseDictionarySearch', query: '你好', contextText: '上下文', requestId: 'zh-1' },
  ]);
});
