import assert from 'node:assert/strict';
import test from 'node:test';
import { observeOverlayTimeline, shouldReplayOverlayLoop } from '../src/lib/overlaySync.ts';
import { seekVideo, registerPlaybackTarget, getVideoElement } from '../src/lib/video.ts';

function createTimeline() {
  const video = new EventTarget();
  Object.assign(video, { currentTime: 12, duration: 60, paused: true, seeking: false });
  const samples = [];
  let externalSeeks = 0;
  let unavailable = 0;
  let poll;
  let cleared = false;
  const observer = observeOverlayTimeline(video, {
    onSample: (snapshot, event) => samples.push({ ...snapshot, event }),
    onExternalSeek: () => externalSeeks++,
    onUnavailable: () => unavailable++,
    seek: (seconds) => {
      video.currentTime = seconds;
      video.dispatchEvent(new Event('seeking'));
      video.dispatchEvent(new Event('seeked'));
    },
  }, {
    setInterval(callback) { poll = callback; return 42; },
    clearInterval(timer) { assert.equal(timer, 42); cleared = true; },
  });
  return {
    video, observer, samples,
    poll: () => poll(),
    externalSeeks: () => externalSeeks,
    unavailable: () => unavailable,
    cleared: () => cleared,
  };
}

test('overlay uses current media time immediately and after pause/resume', () => {
  const t = createTimeline();
  assert.deepEqual(t.samples.at(-1), { currentTime: 12, duration: 60, event: 'initial' });
  t.video.currentTime = 21;
  t.video.dispatchEvent(new Event('pause'));
  assert.equal(t.samples.at(-1).currentTime, 21);
  t.video.paused = false;
  t.video.dispatchEvent(new Event('play'));
  t.video.currentTime = 22;
  t.poll();
  assert.equal(t.samples.at(-1).currentTime, 22);
  t.observer.dispose();
});

test('seek while paused releases the old cue and immediately updates its time', () => {
  const t = createTimeline();
  t.video.currentTime = 45;
  t.video.dispatchEvent(new Event('seeking'));
  assert.equal(t.externalSeeks(), 1);
  assert.equal(t.samples.at(-1).currentTime, 45);
  t.observer.seek(10);
  assert.equal(t.externalSeeks(), 1, 'internal loops must preserve their cue');
  assert.equal(t.samples.at(-1).currentTime, 10);
  t.observer.dispose();
});

test('seeking after a controlled seek cannot inherit stale internal-seek state', () => {
  const t = createTimeline();
  t.observer.seek(10);
  t.video.currentTime = 40;
  t.video.dispatchEvent(new Event('seeking'));
  assert.equal(t.externalSeeks(), 1);
  t.observer.seek(Number.NaN);
  assert.equal(t.video.currentTime, 40);
  t.observer.dispose();
});

test('paused looping preserves position; final padded cue loops on ended', () => {
  assert.equal(shouldReplayOverlayLoop(25, 60, 20, true, false, 'poll'), false);
  assert.equal(shouldReplayOverlayLoop(25, 60, 20, false, false, 'poll'), true);
  assert.equal(shouldReplayOverlayLoop(25, 60, 20, false, true, 'poll'), false);
  assert.equal(shouldReplayOverlayLoop(60, 60, 61, true, false, 'ended'), true);
  assert.equal(shouldReplayOverlayLoop(59, 60, 61, true, false, 'ended'), false);
});

test('failure clears cue state and disposal removes timer and every event handler', () => {
  const t = createTimeline();
  t.video.dispatchEvent(new Event('error'));
  t.video.dispatchEvent(new Event('emptied'));
  assert.equal(t.unavailable(), 2);
  t.observer.dispose();
  assert.equal(t.cleared(), true);
  const count = t.samples.length;
  for (const name of ['play', 'pause', 'timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'durationchange', 'ended', 'error', 'emptied']) {
    t.video.dispatchEvent(new Event(name));
  }
  t.poll();
  t.observer.seek(2);
  t.observer.dispose();
  assert.equal(t.samples.length, count);
  assert.equal(t.video.currentTime, 12);
  assert.equal(t.externalSeeks(), 0);
  assert.equal(t.unavailable(), 2);
});

test('invalid media values never leak NaN or Infinity into overlay state', () => {
  const t = createTimeline();
  t.video.currentTime = Number.NaN;
  t.video.duration = Number.POSITIVE_INFINITY;
  t.video.dispatchEvent(new Event('durationchange'));
  assert.deepEqual(t.samples.at(-1), { currentTime: 0, duration: 0, event: 'durationchange' });
  t.observer.dispose();
});

test('invalid seek inputs are rejected before touching HTML5 or Netflix playback', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = { location: { hostname: 'example.com' } };
  globalThis.document = { querySelector() { throw new Error('invalid seek reached DOM'); } };
  try {
    seekVideo('video', Number.NaN);
    seekVideo('video', Number.POSITIVE_INFINITY);
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});

test('a removed video element releases playback resources without waiting for unmount', () => {
  const t = createTimeline();
  t.video.isConnected = false;
  t.poll();
  assert.equal(t.unavailable(), 1);
  assert.equal(t.cleared(), true);
  t.poll();
  assert.equal(t.unavailable(), 1);
});

function createAdapter() {
  const listeners = new Set();
  return {
    time: 12, duration: 100, paused: true, rate: 1, requestedSeek: null,
    getCurrentTime() { return this.time; },
    getDuration() { return this.duration; },
    isPaused() { return this.paused; },
    getPlaybackRate() { return this.rate; },
    setPlaybackRate(rate) { this.rate = rate; },
    async play() { this.paused = false; this.emit('playing'); },
    pause() { this.paused = true; this.emit('paused'); },
    seek(seconds) { this.requestedSeek = seconds; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    emit(type) { listeners.forEach(listener => listener({ type })); },
    listenerCount() { return listeners.size; },
  };
}

function watchBridge(bridge) {
  const samples = [];
  let externalSeeks = 0;
  let unavailable = 0;
  const observer = observeOverlayTimeline(bridge.target, {
    onSample: (snapshot, event) => samples.push({ ...snapshot, event }),
    onExternalSeek: () => { externalSeeks++; },
    onUnavailable: () => { unavailable++; },
    seek: (seconds) => { bridge.target.currentTime = seconds; },
  }, { setInterval() { return 123; }, clearInterval() {} });
  return { observer, samples, externalSeeks: () => externalSeeks, unavailable: () => unavailable };
}

test('registered adapter targets expose source metadata, rates and normal media controls', async (t) => {
  const adapter = createAdapter();
  const bridge = registerPlaybackTarget('test-adapter', adapter, { start: 10, end: 50, pollIntervalMs: 60_000 });
  t.after(() => bridge.dispose());
  assert.equal(getVideoElement('test-adapter'), bridge.target);
  assert.equal(bridge.target.duration, 50, 'normal overlay treats the selected end as the media boundary');
  assert.equal(bridge.target.currentTime, 12);
  assert.equal(bridge.target.paused, true);
  bridge.target.playbackRate = 0.5;
  assert.equal(adapter.rate, 0.5);
  await bridge.target.play();
  assert.equal(bridge.target.paused, false);
  bridge.target.pause();
  assert.equal(bridge.target.paused, true);
  bridge.target.currentTime = 1000;
  assert.equal(adapter.requestedSeek, 50);
  assert.equal(bridge.target.currentTime, 12, 'requested time never replaces the actual clock');
  bridge.target.currentTime = -100;
  assert.equal(adapter.requestedSeek, 10);
  const requested = adapter.requestedSeek;
  bridge.target.currentTime = Number.NaN;
  bridge.target.playbackRate = Number.NaN;
  assert.equal(adapter.requestedSeek, requested);
  assert.equal(adapter.rate, 0.5);
});

test('asynchronous iframe loop seeks are distinguished from external clock jumps', (t) => {
  const adapter = createAdapter();
  const bridge = registerPlaybackTarget('test-async-seek', adapter, { start: 10, end: 50, pollIntervalMs: 60_000 });
  const timeline = watchBridge(bridge);
  t.after(() => { timeline.observer.dispose(); bridge.dispose(); });
  timeline.observer.seek(10);
  assert.equal(bridge.target.seeking, true);
  assert.equal(timeline.externalSeeks(), 0);
  assert.equal(bridge.target.currentTime, 12);
  adapter.time = 10;
  bridge.sample();
  assert.equal(bridge.target.seeking, false);
  assert.equal(timeline.externalSeeks(), 0);
  assert.equal(timeline.samples.at(-1).currentTime, 10);
  adapter.time = 40;
  bridge.sample();
  assert.equal(timeline.externalSeeks(), 1, 'a user seek inside the iframe releases the old overlay loop');
  assert.equal(timeline.samples.at(-1).currentTime, 40);
});

test('internal seeks clamp to the selected range without being mistaken for external seeks', (t) => {
  const adapter = createAdapter();
  const bridge = registerPlaybackTarget('test-clamped-seek', adapter, { start: 10, end: 50, pollIntervalMs: 60_000 });
  const timeline = watchBridge(bridge);
  t.after(() => { timeline.observer.dispose(); bridge.dispose(); });
  timeline.observer.seek(2);
  assert.equal(adapter.requestedSeek, 10);
  assert.equal(timeline.externalSeeks(), 0);
});

test('native media seeking events do not duplicate a controlled bridge seek', (t) => {
  const adapter = createAdapter();
  adapter.seek = function (seconds) {
    this.time = seconds;
    this.emit('seeking');
    this.emit('seeked');
  };
  const bridge = registerPlaybackTarget('test-native-seek', adapter, { start: 10, end: 50, pollIntervalMs: 60_000 });
  const timeline = watchBridge(bridge);
  t.after(() => { timeline.observer.dispose(); bridge.dispose(); });
  timeline.observer.seek(20);
  assert.equal(timeline.externalSeeks(), 0);
  assert.equal(bridge.target.seeking, false);
  adapter.time = 35;
  adapter.emit('seeking');
  adapter.emit('seeked');
  assert.equal(timeline.externalSeeks(), 1);
});

test('bridge routes normal overlay controls through the session owner and disposes without destroying media', async (t) => {
  const adapter = createAdapter();
  let plays = 0;
  let pauses = 0;
  let seek;
  const bridge = registerPlaybackTarget('test-controls', adapter, {
    start: 10, end: 50, pollIntervalMs: 60_000,
    controls: { async play() { plays++; }, pause() { pauses++; }, seek(seconds) { seek = seconds; } },
  });
  t.after(() => bridge.dispose());
  const timeline = watchBridge(bridge);
  await bridge.target.play();
  bridge.target.pause();
  seekVideo('test-controls', 25);
  assert.equal(plays, 1);
  assert.equal(pauses, 1);
  assert.equal(seek, 25);
  bridge.dispose();
  assert.equal(bridge.target.isConnected, false);
  assert.equal(adapter.listenerCount(), 0);
  assert.equal(timeline.unavailable(), 1);
  const sampleCount = timeline.samples.length;
  adapter.emit('playing');
  bridge.sample();
  assert.equal(timeline.samples.length, sampleCount);
});

test('bridge translates actual media ready, ended and errors for the existing observer', (t) => {
  const adapter = createAdapter();
  const bridge = registerPlaybackTarget('test-media-events', adapter, { start: 10, end: 50, pollIntervalMs: 60_000 });
  const timeline = watchBridge(bridge);
  t.after(() => { timeline.observer.dispose(); bridge.dispose(); });
  adapter.emit('ready');
  assert.ok(timeline.samples.some(sample => sample.event === 'loadedmetadata'));
  adapter.time = 50;
  adapter.emit('ended');
  assert.equal(bridge.target.ended, true);
  assert.ok(timeline.samples.some(sample => sample.event === 'ended'));
  adapter.emit('error');
  assert.equal(timeline.unavailable(), 1);
});

test('a delayed normal pause preserves the current cue while a backwards seek still releases it', (t) => {
  const realNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  const adapter = createAdapter();
  adapter.paused = false;
  const bridge = registerPlaybackTarget('test-delayed-pause', adapter, { start: 0, end: 50, pollIntervalMs: 60_000 });
  const timeline = watchBridge(bridge);
  t.after(() => { Date.now = realNow; timeline.observer.dispose(); bridge.dispose(); });
  now += 1_000;
  adapter.time = 13;
  adapter.paused = true;
  adapter.emit('paused');
  assert.equal(timeline.externalSeeks(), 0, 'ordinary time played before pausing is not a seek');
  adapter.paused = false;
  adapter.emit('playing');
  now += 20_000;
  adapter.time = 8;
  bridge.sample();
  assert.equal(timeline.externalSeeks(), 1, 'natural playback can never move backwards, even after a long poll interval');
});
