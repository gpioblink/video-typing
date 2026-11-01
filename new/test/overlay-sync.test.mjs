import assert from 'node:assert/strict';
import test from 'node:test';
import { observeOverlayTimeline, shouldReplayOverlayLoop } from '../src/lib/overlaySync.ts';
import { seekVideo } from '../src/lib/video.ts';

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
