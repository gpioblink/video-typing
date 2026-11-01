/** Observe actual media time, including seeks while paused. Polling supplements
 * media events; it never substitutes wall clock time for the player's clock. */
export interface OverlayTimelineSnapshot {
  currentTime: number;
  duration: number;
}

export interface OverlayTimelineObserver {
  seek: (seconds: number) => void;
  dispose: () => void;
}

type TimerScheduler = {
  setInterval: (callback: () => void, delay: number) => ReturnType<typeof setInterval>;
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
};

export function observeOverlayTimeline(
  video: HTMLVideoElement,
  callbacks: {
    onSample: (snapshot: OverlayTimelineSnapshot, event: string) => void;
    onExternalSeek: () => void;
    onUnavailable: () => void;
    seek: (seconds: number) => void;
  },
  scheduler: TimerScheduler = globalThis,
): OverlayTimelineObserver {
  let disposed = false;
  let controlledSeek: number | null = null;
  const sample = (event: string) => {
    if (disposed) return;
    if (video.isConnected === false) {
      callbacks.onUnavailable();
      dispose();
      return;
    }
    callbacks.onSample({
      currentTime: Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0,
      duration: Number.isFinite(video.duration) ? Math.max(0, video.duration) : 0,
    }, event);
  };
  const onEvent = (event: Event) => {
    if (disposed) return;
    if (event.type === 'seeking') {
      if (controlledSeek !== null && Math.abs(video.currentTime - controlledSeek) < 0.25) {
        controlledSeek = null;
      } else {
        controlledSeek = null;
        callbacks.onExternalSeek();
      }
    }
    if (event.type === 'emptied' || event.type === 'error') {
      controlledSeek = null;
      callbacks.onUnavailable();
    }
    sample(event.type);
  };
  const events = [
    'timeupdate', 'play', 'pause', 'seeking', 'seeked', 'loadedmetadata',
    'durationchange', 'ended', 'emptied', 'error',
  ];
  for (const event of events) video.addEventListener(event, onEvent);
  const timer = scheduler.setInterval(() => sample('poll'), 100);
  sample('initial');

  function dispose() {
    if (disposed) return;
    disposed = true;
    scheduler.clearInterval(timer);
    for (const event of events) video.removeEventListener(event, onEvent);
  }

  return {
    seek(seconds) {
      if (disposed || !Number.isFinite(seconds)) return;
      controlledSeek = Math.max(0, seconds);
      callbacks.seek(controlledSeek);
    },
    dispose,
  };
}

/** Padded final cues must loop at the media boundary, and pausing must never
 * cause a seek. An ended event may restart an unfinished cue explicitly. */
export function shouldReplayOverlayLoop(
  currentTime: number,
  duration: number,
  loopEnd: number,
  paused: boolean,
  seeking: boolean,
  event: string,
) {
  const end = duration > 0 ? Math.min(loopEnd, duration) : loopEnd;
  return !seeking && currentTime >= end && (!paused || event === 'ended');
}
