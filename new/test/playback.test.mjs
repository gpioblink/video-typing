import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClipSession, PlaybackBlockedError, createHtml5Adapter } from '../src/lib/playback.ts';
import { createYouTubeAdapter, youtubeErrorMessage } from '../src/lib/youtubePlayer.ts';

const clip = {
  source: { kind: 'media', src: '/media/sample.webm' },
  start: 10,
  end: 50,
  cues: [{ start: 10, end: 20 }, { start: 25, end: 50 }],
};

function fakeAdapter() {
  const listeners = new Set();
  const adapter = {
    time: 10,
    paused: true,
    destroyed: false,
    loadCount: 0,
    loadError: null,
    blocked: false,
    emit(event) { for (const listener of listeners) listener(event); },
    async load(_source, start) {
      this.loadCount++;
      if (this.loadError) throw this.loadError;
      this.time = start;
      this.emit({ type: 'ready' });
    },
    async play() {
      if (this.blocked) throw new PlaybackBlockedError();
      this.paused = false;
      this.emit({ type: 'playing' });
    },
    pause() { this.paused = true; this.emit({ type: 'paused' }); },
    seek(seconds) { this.time = seconds; this.emit({ type: 'time' }); },
    getCurrentTime() { return this.time; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { this.destroyed = true; listeners.clear(); },
    listenerCount() { return listeners.size; },
  };
  return adapter;
}

function sessionWithCleanup(t, adapter = fakeAdapter()) {
  const session = new ClipSession(adapter, clip, { pollIntervalMs: 60_000 });
  t.after(() => session.destroy());
  return { session, adapter };
}

test('player clock synchronizes pauses, resumed playback, gaps and native seeks', async (t) => {
  const { session, adapter } = sessionWithCleanup(t);
  await session.start();
  assert.equal(session.getSnapshot().status, 'playing');
  assert.equal(session.getSnapshot().cueIndex, 0);
  adapter.time = 22;
  session.tick();
  assert.equal(session.getSnapshot().cueIndex, -1, 'a subtitle gap does not keep the previous cue');
  adapter.time = 30;
  session.pause();
  assert.deepEqual(session.getSnapshot(), { status: 'paused', currentTime: 30, cueIndex: 1, error: undefined });
  session.seek(12);
  assert.equal(adapter.paused, true);
  assert.equal(session.getSnapshot().cueIndex, 0);
  await session.play();
  adapter.time = 28;
  adapter.emit({ type: 'time' });
  assert.equal(session.getSnapshot().currentTime, 28);
  assert.equal(session.getSnapshot().cueIndex, 1);
});

test('segment completion and three consecutive retries clear terminal state', async (t) => {
  const { session, adapter } = sessionWithCleanup(t);
  await session.start();
  for (let attempt = 0; attempt < 3; attempt++) {
    adapter.time = 50;
    session.tick();
    assert.equal(session.getSnapshot().status, 'completed');
    assert.equal(adapter.paused, true);
    if (attempt < 2) {
      await session.retry();
      assert.equal(session.getSnapshot().status, 'playing');
      assert.equal(session.getSnapshot().currentTime, 10);
      assert.equal(session.getSnapshot().cueIndex, 0);
    }
  }
  assert.equal(adapter.loadCount, 1, 'retry reuses the ready player');
});

test('replay and bounded seek use the current cue and preserve pause state', async (t) => {
  const { session, adapter } = sessionWithCleanup(t);
  await session.start(false);
  session.seek(31);
  await session.replayCue();
  assert.equal(adapter.time, 25);
  session.pause();
  session.seek(-100);
  assert.equal(adapter.time, 10);
  assert.equal(adapter.paused, true);
  session.seek(Number.NaN);
  assert.equal(adapter.time, 10);
  session.seek(1000);
  assert.equal(session.getSnapshot().status, 'completed');
});

test('native playback ending early reports an incomplete clip, normal end completes', async (t) => {
  const { session, adapter } = sessionWithCleanup(t);
  await session.start();
  adapter.time = 20;
  adapter.emit({ type: 'ended' });
  assert.equal(session.getSnapshot().status, 'error');
  await session.retry();
  adapter.time = 50;
  adapter.emit({ type: 'ended' });
  assert.equal(session.getSnapshot().status, 'completed');
});

test('load errors can retry and autoplay rejection exposes a resumable blocked state', async (t) => {
  const { session, adapter } = sessionWithCleanup(t);
  adapter.loadError = new Error('offline');
  await session.start();
  assert.equal(session.getSnapshot().error, 'offline');
  adapter.loadError = null;
  adapter.blocked = true;
  await session.retry();
  assert.equal(session.getSnapshot().status, 'blocked');
  adapter.blocked = false;
  await session.play();
  assert.equal(session.getSnapshot().status, 'playing');
});

test('destroy during an in-flight load ignores old completion and cleans subscriptions', async (t) => {
  const adapter = fakeAdapter();
  let resolveLoad;
  adapter.load = () => new Promise((resolve) => { resolveLoad = resolve; });
  const { session } = sessionWithCleanup(t, adapter);
  let updates = 0;
  session.subscribe(() => { updates++; });
  const loading = session.start();
  session.destroy();
  const previousUpdates = updates;
  resolveLoad();
  await loading;
  adapter.emit({ type: 'playing' });
  assert.equal(updates, previousUpdates);
  assert.equal(adapter.listenerCount(), 0);
  assert.equal(adapter.destroyed, true);
});

test('invalid clip timing and overlapping cues are rejected before allocating resources', () => {
  assert.throws(() => new ClipSession(fakeAdapter(), { ...clip, end: Number.NaN }), /range/);
  assert.throws(() => new ClipSession(fakeAdapter(), { ...clip, cues: [{ start: 0, end: 20 }] }), /cues/);
  assert.throws(() => new ClipSession(fakeAdapter(), { ...clip, cues: [{ start: 10, end: 30 }, { start: 20, end: 50 }] }), /cues/);
});

class FakeVideo extends EventTarget {
  currentTime = 0;
  duration = 60;
  src = '';
  ownerDocument = { baseURI: 'https://example.test/demo/' };
  paused = true;
  shouldFail = false;
  playError = null;
  load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event(this.shouldFail ? 'error' : 'loadedmetadata'))); }
  async play() { if (this.playError) throw this.playError; this.paused = false; this.dispatchEvent(new Event('playing')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}

test('HTML5 adapter loads, seeks, pauses, resumes and releases its media resource', async (t) => {
  const video = new FakeVideo();
  const adapter = createHtml5Adapter(video);
  t.after(() => adapter.destroy());
  const events = [];
  adapter.subscribe((event) => events.push(event.type));
  await adapter.load(clip.source, 10, 50);
  assert.equal(video.currentTime, 10);
  await adapter.play();
  adapter.pause();
  adapter.seek(25);
  assert.equal(adapter.getCurrentTime(), 25);
  assert.equal(video.paused, true);
  assert.ok(events.includes('ready') && events.includes('playing') && events.includes('paused'));
  adapter.destroy();
  const eventCount = events.length;
  video.dispatchEvent(new Event('playing'));
  assert.equal(events.length, eventCount);
  assert.equal(video.src, '');
});

test('HTML5 adapter rejects failed media, invalid URLs and out-of-duration ranges', async (t) => {
  const video = new FakeVideo();
  const adapter = createHtml5Adapter(video);
  t.after(() => adapter.destroy());
  await assert.rejects(adapter.load({ kind: 'media', src: 'javascript:alert(1)' }, 0, 30), /Unsupported/);
  await assert.rejects(adapter.load(clip.source, 0, 100), /duration/);
  video.shouldFail = true;
  await assert.rejects(adapter.load(clip.source, 0, 40), /could not be loaded/);
  video.shouldFail = false;
  video.playError = Object.assign(new Error('user gesture required'), { name: 'NotAllowedError' });
  await assert.rejects(adapter.play(), PlaybackBlockedError);
});

function fakeYouTube() {
  const players = [];
  class Player {
    constructor(_element, options) {
      this.options = options;
      this.time = 0;
      this.destroyed = false;
      this.iframe = {};
      players.push(this);
      queueMicrotask(() => options.events.onReady({ target: this }));
    }
    cueVideoById(options) { this.cued = options; this.time = options.startSeconds; }
    playVideo() { this.options.events.onStateChange({ data: 1 }); }
    pauseVideo() { this.options.events.onStateChange({ data: 2 }); }
    seekTo(seconds) { this.time = seconds; this.options.events.onStateChange({ data: 1 }); }
    getCurrentTime() { return this.time; }
    getIframe() { return this.iframe; }
    destroy() { this.destroyed = true; }
  }
  const container = {
    children: [],
    ownerDocument: { createElement: () => ({}) },
    append(node) { this.children.push(node); },
    replaceChildren() { this.children = []; },
  };
  return { api: { Player }, container, players };
}

const youtubeSource = { kind: 'youtube', videoId: 'M7lc1UVf-VE' };

test('official YouTube adapter cues bounded video and controller still enforces end after seek', async (t) => {
  const fake = fakeYouTube();
  const adapter = createYouTubeAdapter(fake.container, { origin: 'https://example.test', loadApi: async () => fake.api });
  const session = new ClipSession(adapter, { ...clip, source: youtubeSource }, { pollIntervalMs: 60_000 });
  t.after(() => session.destroy());
  await session.start();
  const player = fake.players[0];
  assert.deepEqual(player.cued, { videoId: youtubeSource.videoId, startSeconds: 10, endSeconds: 50 });
  assert.equal(player.options.videoId, youtubeSource.videoId, 'initial iframe URL must contain the video ID before onReady');
  assert.equal(player.options.playerVars.start, 10);
  assert.equal(player.options.playerVars.end, 50);
  assert.equal(player.options.playerVars.controls, 1);
  assert.equal(player.options.playerVars.origin, 'https://example.test');
  session.pause();
  session.seek(30);
  assert.equal(session.getSnapshot().status, 'paused', 'seekTo resuming playback is corrected');
  await session.play();
  player.time = 50;
  session.tick();
  assert.equal(session.getSnapshot().status, 'completed');
});

test('YouTube errors and autoplay blocking reach the shared session', async (t) => {
  const fake = fakeYouTube();
  const adapter = createYouTubeAdapter(fake.container, { origin: 'https://example.test', loadApi: async () => fake.api });
  const session = new ClipSession(adapter, { ...clip, source: youtubeSource }, { pollIntervalMs: 60_000 });
  t.after(() => session.destroy());
  await session.start();
  fake.players[0].options.events.onAutoplayBlocked();
  assert.equal(session.getSnapshot().status, 'blocked');
  await session.play();
  fake.players[0].options.events.onError({ data: 153 });
  assert.equal(session.getSnapshot().status, 'error');
  assert.match(session.getSnapshot().error, /Referer/);
  for (const code of [2, 5, 100, 101, 150, 153, 999]) assert.ok(youtubeErrorMessage(code));
});

test('YouTube source switching destroys old player and ignores its late events', async (t) => {
  const fake = fakeYouTube();
  const adapter = createYouTubeAdapter(fake.container, { origin: 'https://example.test', loadApi: async () => fake.api });
  t.after(() => adapter.destroy());
  const events = [];
  adapter.subscribe((event) => events.push(event));
  await adapter.load(youtubeSource, 10, 50);
  const old = fake.players[0];
  await adapter.load({ kind: 'youtube', videoId: 'abcdefghijk' }, 0, 40);
  const count = events.length;
  old.options.events.onError({ data: 100 });
  old.options.events.onStateChange({ data: 1 });
  assert.equal(events.length, count);
  assert.equal(old.destroyed, true);
  adapter.destroy();
  assert.equal(fake.players[1].destroyed, true);
  assert.equal(fake.container.children.length, 0);
});

test('YouTube adapter rejects malformed IDs, unsupported origins and loader failures', async (t) => {
  const fake = fakeYouTube();
  const adapter = createYouTubeAdapter(fake.container, {
    origin: 'https://example.test', loadApi: async () => { throw new Error('offline'); },
  });
  t.after(() => adapter.destroy());
  await assert.rejects(adapter.load({ kind: 'youtube', videoId: '../oops' }, 0, 40), /valid YouTube/);
  await assert.rejects(adapter.load(youtubeSource, 0, 40), /offline/);
  const extensionAdapter = createYouTubeAdapter(fake.container, { origin: 'chrome-extension://abc', loadApi: async () => fake.api });
  t.after(() => extensionAdapter.destroy());
  await assert.rejects(extensionAdapter.load(youtubeSource, 0, 40), /HTTP\(S\)/);
});

test('YouTube preparation timeout releases the failed player and can be retried', async (t) => {
  const fake = fakeYouTube();
  class NeverReadyPlayer extends fake.api.Player {
    constructor(element, options) {
      super(element, { ...options, events: { ...options.events, onReady() {} } });
    }
  }
  const adapter = createYouTubeAdapter(fake.container, {
    origin: 'https://example.test', loadApi: async () => ({ Player: NeverReadyPlayer }), readyTimeoutMs: 5,
  });
  t.after(() => adapter.destroy());
  await assert.rejects(adapter.load(youtubeSource, 10, 50), /timed out/);
  assert.equal(fake.players[0].destroyed, true);
  assert.equal(fake.container.children.length, 0);
});

test('cancelling a pending YouTube load never emits a spurious error into its replacement', async (t) => {
  const fake = fakeYouTube();
  const readyCallbacks = [];
  class DeferredReadyPlayer extends fake.api.Player {
    constructor(element, options) {
      super(element, { ...options, events: { ...options.events, onReady() {} } });
      readyCallbacks.push(() => options.events.onReady({ target: this }));
    }
  }
  const adapter = createYouTubeAdapter(fake.container, {
    origin: 'https://example.test', loadApi: async () => ({ Player: DeferredReadyPlayer }),
  });
  t.after(() => adapter.destroy());
  const events = [];
  adapter.subscribe((event) => events.push(event.type));
  const first = adapter.load(youtubeSource, 10, 50);
  await new Promise((resolve) => setImmediate(resolve));
  const rejected = assert.rejects(first, /cancelled/);
  const second = adapter.load(youtubeSource, 10, 50);
  await new Promise((resolve) => setImmediate(resolve));
  readyCallbacks[0]();
  readyCallbacks[1]();
  await Promise.all([rejected, second]);
  assert.deepEqual(events, ['ready']);
});

test('a pending play rejection after explicit pause preserves paused state', async (t) => {
  const { session, adapter } = sessionWithCleanup(t);
  await session.start(false);
  let rejectPlay;
  adapter.play = () => new Promise((_resolve, reject) => { rejectPlay = reject; });
  const pending = session.play();
  session.pause();
  rejectPlay(Object.assign(new Error('play request interrupted by pause'), { name: 'AbortError' }));
  await pending;
  assert.equal(session.getSnapshot().status, 'paused');
  assert.equal(session.getSnapshot().error, undefined);
});

test('late play resolution cannot overwrite native pause, seek or completed state', async (t) => {
  const { session, adapter } = sessionWithCleanup(t);
  await session.start(false);
  let resolvePlay;
  adapter.play = () => new Promise((resolve) => { resolvePlay = resolve; });
  for (const action of ['native-pause', 'seek', 'complete']) {
    const pending = session.play();
    if (action === 'native-pause') adapter.emit({ type: 'paused' });
    if (action === 'seek') session.seek(28);
    if (action === 'complete') { adapter.time = 50; session.tick(); }
    const state = session.getSnapshot().status;
    resolvePlay();
    await pending;
    assert.equal(session.getSnapshot().status, state, action);
  }
});

function manualPlayYouTube() {
  const fake = fakeYouTube();
  class Player extends fake.api.Player {
    // playVideo queues a command; only a later player event proves playback started.
    playVideo() {}
  }
  return { ...fake, api: { Player } };
}

test('YouTube play waits for confirmed PLAYING, never CUED or BUFFERING', async (t) => {
  const fake = manualPlayYouTube();
  const adapter = createYouTubeAdapter(fake.container, { origin: 'https://example.test', loadApi: async () => fake.api });
  t.after(() => adapter.destroy());
  await adapter.load(youtubeSource, 10, 50);
  let resolved = false;
  const pending = adapter.play().then(() => { resolved = true; });
  fake.players[0].options.events.onStateChange({ data: 5 });
  fake.players[0].options.events.onStateChange({ data: 3 });
  await Promise.resolve();
  assert.equal(resolved, false);
  fake.players[0].options.events.onStateChange({ data: 1 });
  await pending;
  assert.equal(resolved, true);
});

test('YouTube start timeout becomes resumable blocked and native player play recovers', async (t) => {
  const fake = manualPlayYouTube();
  const adapter = createYouTubeAdapter(fake.container, {
    origin: 'https://example.test', loadApi: async () => fake.api, playTimeoutMs: 5,
  });
  const session = new ClipSession(adapter, { ...clip, source: youtubeSource }, { pollIntervalMs: 60_000 });
  t.after(() => session.destroy());
  const starting = session.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.getSnapshot().status, 'ready', 'a queued play command is not confirmed playback');
  await starting;
  assert.equal(session.getSnapshot().status, 'blocked');
  assert.equal(session.getSnapshot().error, undefined);
  fake.players[0].options.events.onStateChange({ data: 1 });
  assert.equal(session.getSnapshot().status, 'playing');
  fake.players[0].time = 30;
  session.tick();
  assert.equal(session.getSnapshot().cueIndex, 1);
});

test('YouTube autoplay blocking, errors and pause settle pending play requests', async (t) => {
  const fake = manualPlayYouTube();
  const adapter = createYouTubeAdapter(fake.container, { origin: 'https://example.test', loadApi: async () => fake.api });
  t.after(() => adapter.destroy());
  await adapter.load(youtubeSource, 10, 50);
  const blocked = assert.rejects(adapter.play(), PlaybackBlockedError);
  fake.players[0].options.events.onAutoplayBlocked();
  await blocked;
  const paused = assert.rejects(adapter.play(), { name: 'AbortError' });
  adapter.pause();
  await paused;
  const failed = assert.rejects(adapter.play(), /private/);
  fake.players[0].options.events.onError({ data: 100 });
  await failed;
});

test('destroy and source replacement cancel pending YouTube playback without leftover timeouts', async (t) => {
  const fake = manualPlayYouTube();
  const adapter = createYouTubeAdapter(fake.container, { origin: 'https://example.test', loadApi: async () => fake.api });
  t.after(() => adapter.destroy());
  await adapter.load(youtubeSource, 10, 50);
  const replaced = assert.rejects(adapter.play(), { name: 'AbortError' });
  await adapter.load(youtubeSource, 0, 40);
  await replaced;
  const destroyed = assert.rejects(adapter.play(), { name: 'AbortError' });
  adapter.destroy();
  await destroyed;
});
