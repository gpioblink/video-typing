import {
  isNetflixHostname,
  NETFLIX_SEEK_EVENT_NAME,
  type NetflixSeekEventDetail,
} from './netflixSeek';
import { type PlaybackAdapter, type PlaybackEvent, validatePlaybackRange } from './playback';

const VIDEO_ATTR = 'data-video-typing-target-id';

/** The media surface the normal OverlayApp needs. Native videos satisfy it too. */
export interface MediaTarget extends EventTarget {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly seeking: boolean;
  readonly ended: boolean;
  playbackRate: number;
  readonly isConnected: boolean;
  /** Requested destination while an asynchronous adapter seek is in flight. */
  readonly pendingSeekTime?: number | null;
  readonly seekRange?: { start: number; end: number };
  play(): Promise<void>;
  pause(): void;
}

interface RegisteredTarget {
  target: MediaTarget;
  dispose(): void;
}

const targets = new Map<string, RegisteredTarget>();

export interface PlaybackTargetOptions {
  start: number;
  end: number;
  controls?: {
    play(): Promise<void>;
    pause(): void;
    seek(seconds: number): void;
  };
  isConnected?: () => boolean;
  pollIntervalMs?: number;
}

/** Expose the actual adapter to OverlayApp; no hidden video or synthetic clock. */
export function registerPlaybackTarget(
  targetId: string,
  adapter: PlaybackAdapter,
  options: PlaybackTargetOptions,
) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(targetId)) throw new Error('Invalid media target ID.');
  validatePlaybackRange(options.start, options.end);
  targets.get(targetId)?.dispose();
  const events = new EventTarget();
  let disposed = false;
  let seeking = false;
  let ended = false;
  let pendingSeek: number | null = null;
  let requestedSeek: { time: number; at: number } | null = null;
  let lastTime = finiteTime(adapter.getCurrentTime());
  let lastSampleAt = Date.now();
  let lastDuration = 0;
  let lastRate = 1;
  let lastPaused = adapter.isPaused();
  const emit = (name: string) => { if (!disposed) events.dispatchEvent(new Event(name)); };
  const clamp = (time: number) => Math.max(options.start, Math.min(options.end, time));
  const controls = options.controls ?? {
    play: () => adapter.play(),
    pause: () => adapter.pause(),
    seek(seconds: number) {
      const paused = adapter.isPaused();
      adapter.seek(seconds);
      // YouTube seekTo can resume a cued/ended player; keep a paused seek paused.
      if (paused) adapter.pause();
    },
  };

  function finiteTime(value: number) { return Number.isFinite(value) ? Math.max(0, value) : 0; }
  function isRequestedSeek(time: number) {
    return requestedSeek !== null && Date.now() - requestedSeek.at < 2_000 && Math.abs(time - requestedSeek.time) < 0.5;
  }

  const target: MediaTarget = Object.assign(events, {
    async play() {
      if (disposed) return;
      await controls.play();
    },
    pause() { if (!disposed) controls.pause(); },
  }) as MediaTarget;
  Object.defineProperties(target, {
    currentTime: {
      get: () => finiteTime(adapter.getCurrentTime()),
      set: (value: number) => {
        if (disposed || !Number.isFinite(value)) return;
        const time = clamp(value);
        pendingSeek = time;
        requestedSeek = { time, at: Date.now() };
        seeking = true;
        ended = false;
        // pendingSeekTime lets the observer identify its own seek even before
        // an iframe's actual clock reaches the requested destination.
        emit('seeking');
        try { controls.seek(time); }
        catch (error) {
          pendingSeek = null;
          seeking = false;
          emit('error');
          throw error;
        }
        sample();
      },
    },
    duration: {
      get: () => {
        const duration = adapter.getDuration();
        return Number.isFinite(duration) && duration > 0 ? Math.min(options.end, duration) : options.end;
      },
    },
    paused: { get: () => disposed || adapter.isPaused() },
    seeking: { get: () => seeking },
    ended: { get: () => ended },
    playbackRate: {
      get: () => adapter.getPlaybackRate(),
      set: (value: number) => {
        if (disposed || !Number.isFinite(value) || value <= 0) return;
        adapter.setPlaybackRate(value);
        sample();
      },
    },
    isConnected: { get: () => !disposed && (options.isConnected?.() ?? true) },
    pendingSeekTime: { get: () => pendingSeek },
    seekRange: { get: () => ({ start: options.start, end: options.end }) },
  });

  function sample() {
    if (disposed) return;
    const now = Date.now();
    const time = target.currentTime;
    const elapsed = Math.max(0, (now - lastSampleAt) / 1000);
    if (pendingSeek !== null) {
      if (Math.abs(time - pendingSeek) < 0.25 || (requestedSeek !== null && now - requestedSeek.at > 5_000)) {
        pendingSeek = null;
        seeking = false;
        emit('seeked');
      }
    } else if (!seeking && !isRequestedSeek(time)) {
      // The iframe API has no seeking event. Detect jumps in its real clock,
      // allowing normal progress, playback rates and delayed background polls.
      // A pause event can arrive after a throttled polling interval. The
      // media was still playing during that interval, so a normal forward
      // advance must not release the cue as if the user had sought.
      const couldHaveAdvanced = !target.paused || !lastPaused;
      const expectedProgress = couldHaveAdvanced ? elapsed * Math.max(0.25, target.playbackRate, lastRate) : 0;
      const delta = time - lastTime;
      if (delta < -0.5 || delta > Math.max(0.5, expectedProgress * 1.5 + 0.25)) {
        seeking = true;
        emit('seeking');
        seeking = false;
        ended = false;
        emit('seeked');
      }
    }
    const duration = target.duration;
    if (duration !== lastDuration) { lastDuration = duration; emit('durationchange'); }
    const rate = target.playbackRate;
    if (rate !== lastRate) { lastRate = rate; emit('ratechange'); }
    const changed = time !== lastTime;
    lastTime = time;
    lastSampleAt = now;
    lastPaused = target.paused;
    if (changed) emit('timeupdate');
  }

  const onPlaybackEvent = (event: PlaybackEvent) => {
    if (disposed) return;
    if (event.type === 'ready') {
      lastTime = target.currentTime;
      lastSampleAt = Date.now();
      ended = false;
      emit('loadedmetadata');
    } else if (event.type === 'playing') {
      ended = false;
      emit('play');
    } else if (event.type === 'paused' || event.type === 'blocked') {
      emit('pause');
    } else if (event.type === 'ended') {
      lastTime = target.currentTime;
      lastSampleAt = Date.now();
      ended = true;
      seeking = false;
      pendingSeek = null;
      emit('ended');
    } else if (event.type === 'error') {
      emit('error');
    } else if (event.type === 'seeking') {
      if (pendingSeek === null && !isRequestedSeek(target.currentTime)) {
        seeking = true;
        ended = false;
        emit('seeking');
      }
    } else if (event.type === 'seeked') {
      const wasSeeking = seeking;
      pendingSeek = null;
      seeking = false;
      // Suppress the second seeking/seeked pair from a native video whose
      // currentTime setter already produced a controlled bridge seek.
      if (wasSeeking) emit('seeked');
      requestedSeek = null;
    }
    sample();
  };
  const unsubscribe = adapter.subscribe(onPlaybackEvent);
  const timer = setInterval(sample, options.pollIntervalMs ?? 100);
  const registration: RegisteredTarget = {
    target,
    dispose() {
      if (disposed) return;
      // Consumers observe removal through the same lifecycle event as HTML5.
      disposed = true;
      clearInterval(timer);
      unsubscribe();
      if (targets.get(targetId) === registration) targets.delete(targetId);
      events.dispatchEvent(new Event('emptied'));
    },
  };
  targets.set(targetId, registration);
  return { target, dispose: registration.dispose, sample };
}

export function getVideoElement(targetId: string): MediaTarget | null {
  const registered = targets.get(targetId);
  if (registered) return registered.target;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(targetId) || typeof document === 'undefined') return null;
  return document.querySelector<HTMLVideoElement>(`video[${VIDEO_ATTR}="${targetId}"]`);
}

export function seekVideo(targetId: string, nextTime: number) {
  if (!Number.isFinite(nextTime)) return;
  const nextTimeSeconds = Math.max(0, nextTime);
  const registered = targets.get(targetId);
  if (registered) {
    registered.target.currentTime = nextTimeSeconds;
    return;
  }

  if (isNetflixHostname(window.location.hostname)) {
    window.dispatchEvent(new CustomEvent<NetflixSeekEventDetail>(NETFLIX_SEEK_EVENT_NAME, {
      detail: {
        targetId,
        nextTimeSeconds,
        nextTimeMs: Math.round(nextTimeSeconds * 1000),
      },
    }));
    return;
  }

  const video = getVideoElement(targetId);
  if (!video) return;
  video.currentTime = nextTimeSeconds;
}
