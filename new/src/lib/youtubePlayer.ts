import {
  type PlaybackAdapter,
  type PlaybackEvent,
  type PlaybackSource,
  PlaybackBlockedError,
  validatePlaybackRange,
} from './playback';

export interface YouTubePlayer {
  cueVideoById(options: { videoId: string; startSeconds: number; endSeconds: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}

export interface YouTubePlayerOptions {
  videoId: string;
  width: string;
  height: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady(event: { target: YouTubePlayer }): void;
    onStateChange(event: { data: number }): void;
    onError(event: { data: number }): void;
    onAutoplayBlocked(): void;
  };
}

export interface YouTubeApi {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

type ApiWindow = Window & {
  YT?: YouTubeApi;
  onYouTubeIframeAPIReady?: () => void;
};

let apiPromise: Promise<YouTubeApi> | undefined;

/** Official API loader. Kept out of extension entrypoints: MV3 forbids remote scripts. */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  const host = window as ApiWindow;
  if (host.YT?.Player) return Promise.resolve(host.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = host.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.onerror = null;
      if (host.onYouTubeIframeAPIReady === onReady) host.onYouTubeIframeAPIReady = previous;
      if (error) {
        script.remove();
        reject(error);
      } else if (host.YT?.Player) resolve(host.YT);
      else reject(new Error('YouTube API did not initialize.'));
    };
    const onReady = () => {
      // Preserve a pre-existing consumer without allowing its error to strand this loader.
      try { previous?.(); } finally { finish(); }
    };
    const timeout = setTimeout(() => finish(new Error('YouTube API loading timed out.')), 15_000);
    host.onYouTubeIframeAPIReady = onReady;
    script.onerror = () => finish(new Error('YouTube API could not be loaded. Check the network and try again.'));
    document.head.append(script);
  });
  void apiPromise.catch(() => { apiPromise = undefined; });
  return apiPromise;
}

export function youtubeErrorMessage(code: number) {
  const messages: Record<number, string> = {
    2: 'The YouTube video ID or playback range is invalid.',
    5: 'The browser could not play this YouTube video.',
    100: 'This YouTube video is unavailable or private.',
    101: 'The owner does not allow this video to be embedded.',
    150: 'The owner does not allow this video to be embedded.',
    153: 'YouTube could not identify this page. Use an HTTP(S) page that sends its Referer.',
  };
  return messages[code] ?? `YouTube playback failed (error ${code}).`;
}

/** A visible, unmodified official player; the typing surface belongs outside its container. */
export function createYouTubeAdapter(
  container: HTMLElement,
  options: { loadApi?: () => Promise<YouTubeApi>; origin?: string; readyTimeoutMs?: number; playTimeoutMs?: number } = {},
): PlaybackAdapter {
  let player: YouTubePlayer | undefined;
  let destroyed = false;
  let generation = 0;
  let cancelLoad: (() => void) | undefined;
  let ready = false;
  let playing = false;
  let pendingPlay: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
  const cancelError = () => Object.assign(new Error('YouTube play request was cancelled.'), { name: 'AbortError' });
  const finishPlay = (error?: Error) => {
    const pending = pendingPlay;
    if (!pending) return;
    pendingPlay = undefined;
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve();
  };
  const listeners = new Set<(event: PlaybackEvent) => void>();
  const emit = (event: PlaybackEvent) => {
    if (!destroyed) listeners.forEach((listener) => listener(event));
  };
  return {
    async load(source: PlaybackSource, start: number, end: number) {
      if (destroyed) throw new Error('Player has been destroyed.');
      if (source.kind !== 'youtube' || !/^[A-Za-z0-9_-]{11}$/.test(source.videoId)) {
        throw new Error('A valid YouTube video ID is required.');
      }
      validatePlaybackRange(start, end);
      const origin = options.origin ?? window.location.origin;
      if (!/^https?:\/\//.test(origin)) {
        throw new Error('YouTube playback requires an HTTP(S) page. Use the web demo.');
      }
      finishPlay(cancelError());
      ready = false;
      playing = false;
      cancelLoad?.();
      const currentGeneration = ++generation;
      player?.destroy();
      player = undefined;
      container.replaceChildren();
      const api = await (options.loadApi ?? loadYouTubeApi)();
      if (destroyed || currentGeneration !== generation) throw new Error('YouTube loading was cancelled.');
      const mount = container.ownerDocument.createElement('div');
      container.append(mount);
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const valid = () => !destroyed && currentGeneration === generation;
        const finish = (error?: Error, notify = true) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          cancelLoad = undefined;
          if (error) {
            if (notify && valid()) emit({ type: 'error', message: error.message });
            if (valid()) {
              player?.destroy();
              player = undefined;
              container.replaceChildren();
            }
            reject(error);
          } else resolve();
        };
        const timeout = setTimeout(() => finish(new Error('YouTube player loading timed out.')), options.readyTimeoutMs ?? 15_000);
        cancelLoad = () => finish(new Error('YouTube loading was cancelled.'), false);
        try {
          player = new api.Player(mount, {
            videoId: source.videoId,
            width: '100%',
            height: '100%',
            playerVars: { enablejsapi: 1, playsinline: 1, controls: 1, origin, start, end },
            events: {
              onReady(event) {
                if (!valid()) return;
                try {
                  const iframe = event.target.getIframe();
                  iframe.title = 'YouTube video player';
                  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
                  event.target.cueVideoById({ videoId: source.videoId, startSeconds: start, endSeconds: end });
                  ready = true;
                  emit({ type: 'ready' });
                  finish();
                } catch (error) {
                  finish(error instanceof Error ? error : new Error(String(error)));
                }
              },
              onStateChange(event) {
                if (!valid()) return;
                const states: Record<number, PlaybackEvent['type']> = {
                  0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'ready',
                };
                playing = event.data === 1;
                const type = states[event.data];
                if (type) emit({ type });
                if (playing) finishPlay();
                else if (event.data === 0 || event.data === 2) finishPlay(cancelError());
              },
              onError(event) {
                if (!valid()) return;
                const error = new Error(youtubeErrorMessage(event.data));
                if (!settled) finish(error);
                else emit({ type: 'error', message: error.message });
                finishPlay(error);
              },
              onAutoplayBlocked() {
                if (!valid()) return;
                playing = false;
                const error = new PlaybackBlockedError('YouTube playback was blocked. Press play in the video player to continue.');
                emit({ type: 'blocked', message: error.message });
                finishPlay(error);
              },
            },
          });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    play() {
      if (destroyed || !player || !ready) return Promise.reject(new Error('YouTube player is not ready.'));
      if (playing) return Promise.resolve();
      finishPlay(cancelError());
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const error = new PlaybackBlockedError('YouTube playback did not start. Press play in the video player to continue.');
          emit({ type: 'blocked', message: error.message });
          finishPlay(error);
        }, options.playTimeoutMs ?? 5_000);
        pendingPlay = { resolve, reject, timer };
        try { player!.playVideo(); }
        catch (error) { finishPlay(error instanceof Error ? error : new Error(String(error))); }
      });
    },
    pause() {
      if (destroyed) return;
      finishPlay(cancelError());
      playing = false;
      player?.pauseVideo();
    },
    seek(seconds) {
      if (!destroyed && Number.isFinite(seconds)) player?.seekTo(Math.max(0, seconds), true);
    },
    getCurrentTime() { return destroyed ? 0 : player?.getCurrentTime() ?? 0; },
    subscribe(listener) {
      if (!destroyed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ++generation;
      finishPlay(cancelError());
      cancelLoad?.();
      listeners.clear();
      player?.destroy();
      player = undefined;
      container.replaceChildren();
    },
  };
}
