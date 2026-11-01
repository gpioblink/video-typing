import assert from 'node:assert/strict';
import test from 'node:test';
import { createYouTubeAdapter } from '../src/lib/youtubePlayer.ts';

const source = { kind: 'youtube', videoId: 'M7lc1UVf-VE' };
function fixture({ initialCued = false, silentCue = false, neverCued = false, cueDelay = 8 } = {}) {
  const players = [];
  class Player {
    constructor(_element, options) {
      this.options = options;
      this.state = initialCued ? 5 : -1;
      this.time = initialCued ? options.playerVars.start : 0;
      this.destroyed = false;
      this.cueCalls = 0;
      this.stateReads = 0;
      this.iframe = {};
      players.push(this);
      queueMicrotask(() => options.events.onReady({ target: this }));
    }
    cueVideoById(cue) {
      this.cueCalls++;
      this.cue = cue;
      if (neverCued) return;
      this.timer = setTimeout(() => {
        if (this.destroyed) return;
        this.time = cue.startSeconds;
        this.state = 5;
        if (!silentCue) this.options.events.onStateChange({ data: 5 });
      }, cueDelay);
    }
    playVideo() { this.state = 1; this.options.events.onStateChange({ data: 1 }); }
    pauseVideo() { this.state = 2; this.options.events.onStateChange({ data: 2 }); }
    seekTo(time) { this.time = time; }
    getPlayerState() { this.stateReads++; return this.state; }
    getCurrentTime() { return this.time; }
    getDuration() { return 120; }
    getPlaybackRate() { return 1; }
    setPlaybackRate() {}
    getIframe() { return this.iframe; }
    destroy() { clearTimeout(this.timer); this.destroyed = true; }
  }
  const container = { ownerDocument: { createElement: () => ({}) }, append() {}, replaceChildren() {} };
  const adapter = createYouTubeAdapter(container, { origin: 'https://example.test', loadApi: async () => ({ Player }), readyTimeoutMs: 80, playTimeoutMs: 80 });
  return { players, adapter };
}

test('a delayed cue cannot cancel playback requested after load resolves', async (t) => {
  const { adapter, players } = fixture();
  t.after(() => adapter.destroy());
  await adapter.load(source, 10, 50);
  await adapter.play();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(players[0].getPlayerState(), 1, 'the cue must finish before the play command is sent');
  assert.equal(adapter.isPaused(), false);
  assert.equal(players[0].getCurrentTime(), 10);
});

test('the iframe ready event alone does not resolve a still-loading cue', async (t) => {
  const { adapter } = fixture({ cueDelay: 30 });
  t.after(() => adapter.destroy());
  const events = [];
  adapter.subscribe(event => events.push(event.type));
  let resolved = false;
  const loading = adapter.load(source, 10, 50).then(() => { resolved = true; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(resolved, false);
  assert.equal(events.includes('ready'), false);
  await loading;
  assert.equal(resolved, true);
  assert.equal(events.filter(type => type === 'ready').length, 1);
});

test('already cued constructor content needs no redundant cue to cancel autoplay', async (t) => {
  const { adapter, players } = fixture({ initialCued: true });
  t.after(() => adapter.destroy());
  await adapter.load(source, 10, 50);
  assert.equal(players[0].cueCalls, 0);
  assert.equal(players[0].options.playerVars.start, 10);
  assert.equal(players[0].options.playerVars.end, 50);
  await adapter.play();
  assert.equal(players[0].state, 1);
});

test('a missing CUED notification can be confirmed by the actual player state', async (t) => {
  const { adapter, players } = fixture({ silentCue: true });
  t.after(() => adapter.destroy());
  await adapter.load(source, 10, 50);
  assert.equal(players[0].state, 5);
  assert.equal(players[0].time, 10);
  await adapter.play();
  assert.equal(players[0].state, 1);
});

test('fractional bounds still go through the precise cue call rather than integer URL parameters', async (t) => {
  const { adapter, players } = fixture({ initialCued: true });
  t.after(() => adapter.destroy());
  await adapter.load(source, 10.5, 50.5);
  assert.equal(players[0].cueCalls, 1);
  assert.deepEqual(players[0].cue, { videoId: source.videoId, startSeconds: 10.5, endSeconds: 50.5 });
});

test('an old CUED state alone cannot acknowledge a pending fractional re-cue', async (t) => {
  const { adapter, players } = fixture({ initialCued: true, neverCued: true });
  t.after(() => adapter.destroy());
  await assert.rejects(adapter.load(source, 10.5, 50.5), /timed out/);
  assert.equal(players[0].destroyed, true);
});

test('cue timeout releases both the player and its state-check interval', async (t) => {
  const { adapter, players } = fixture({ neverCued: true });
  t.after(() => adapter.destroy());
  await assert.rejects(adapter.load(source, 10, 50), /timed out/);
  assert.equal(players[0].destroyed, true);
  const reads = players[0].stateReads;
  await new Promise(resolve => setTimeout(resolve, 65));
  assert.equal(players[0].stateReads, reads);
});

test('destroy cancels cue preparation without a late ready event', async (t) => {
  const { adapter, players } = fixture({ neverCued: true });
  t.after(() => adapter.destroy());
  const events = [];
  adapter.subscribe(event => events.push(event.type));
  const loading = assert.rejects(adapter.load(source, 10, 50), /cancelled/);
  await new Promise(resolve => setImmediate(resolve));
  adapter.destroy();
  await loading;
  players[0].options.events.onStateChange({ data: 5 });
  assert.equal(players[0].destroyed, true);
  assert.equal(events.includes('ready'), false);
});

test('switching video during cue preparation cancels the old request and ignores its late events', async (t) => {
  const { adapter, players } = fixture({ cueDelay: 20 });
  t.after(() => adapter.destroy());
  const events = [];
  adapter.subscribe(event => events.push(event.type));
  const first = assert.rejects(adapter.load(source, 10, 50), /cancelled/);
  await new Promise(resolve => setImmediate(resolve));
  const second = adapter.load({ kind: 'youtube', videoId: 'abcdefghijk' }, 20, 60);
  await Promise.all([first, second]);
  assert.equal(players[0].destroyed, true);
  assert.equal(players[1].time, 20);
  const count = events.length;
  players[0].options.events.onStateChange({ data: 5 });
  players[0].options.events.onError({ data: 100 });
  assert.equal(events.length, count);
  await adapter.play();
  players[1].state = 0;
  players[1].options.events.onStateChange({ data: 0 });
  assert.equal(adapter.isPaused(), true);
  assert.equal(events.at(-1), 'ended');
});
