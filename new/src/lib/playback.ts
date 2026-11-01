/** Common clock/control contract for packaged HTML5 media and the official YouTube player. */
export type PlaybackSource =
  | { kind: 'media'; src: string }
  | { kind: 'youtube'; videoId: string };

export interface PlaybackEvent {
  type: 'ready' | 'playing' | 'paused' | 'ended' | 'buffering' | 'time' | 'blocked' | 'error';
  message?: string;
}

export interface PlaybackAdapter {
  load(source: PlaybackSource, start: number, end: number): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  getCurrentTime(): number;
  destroy(): void;
  subscribe(listener: (event: PlaybackEvent) => void): () => void;
}

export class PlaybackBlockedError extends Error {
  constructor(message = 'Playback was blocked. Press the play button to continue.') {
    super(message);
    this.name = 'PlaybackBlockedError';
  }
}

export function validatePlaybackRange(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error('Invalid playback range.');
  }
}

export function createHtml5Adapter(video: HTMLVideoElement): PlaybackAdapter {
  const listeners = new Set<(event: PlaybackEvent) => void>();
  let destroyed = false;
  let cancelLoad: (() => void) | undefined;
  const emit = (event: PlaybackEvent) => {
    if (!destroyed) listeners.forEach((listener) => listener(event));
  };
  const events: [string, () => void][] = [
    ['playing', () => emit({ type: 'playing' })],
    ['pause', () => emit({ type: 'paused' })],
    ['ended', () => emit({ type: 'ended' })],
    ['waiting', () => emit({ type: 'buffering' })],
    ['timeupdate', () => emit({ type: 'time' })],
    ['seeked', () => emit({ type: 'time' })],
    ['error', () => emit({ type: 'error', message: `Video could not be loaded (media error ${video.error?.code ?? 'unknown'}).` })],
  ];
  events.forEach(([name, handler]) => video.addEventListener(name, handler));
  return {
    load(source, start, end) {
      if (destroyed) return Promise.reject(new Error('Player has been destroyed.'));
      if (source.kind !== 'media') return Promise.reject(new Error('HTML5 player requires a media source.'));
      try {
        validatePlaybackRange(start, end);
        const url = new URL(source.src, video.ownerDocument.baseURI);
        if (!['http:', 'https:', 'chrome-extension:', 'blob:'].includes(url.protocol) || url.username || url.password) {
          throw new Error('Unsupported media URL.');
        }
      } catch (error) {
        return Promise.reject(error);
      }
      cancelLoad?.();
      video.pause();
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          video.removeEventListener('loadedmetadata', ready);
          video.removeEventListener('error', failed);
          cancelLoad = undefined;
          if (error) reject(error);
          else resolve();
        };
        const ready = () => {
          if (Number.isFinite(video.duration) && end > video.duration + 0.25) {
            finish(new Error('The clip range exceeds the video duration.'));
            return;
          }
          try {
            video.currentTime = start;
            emit({ type: 'ready' });
            finish();
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
          }
        };
        const failed = () => finish(new Error('Video could not be loaded.'));
        const timeout = setTimeout(() => finish(new Error('Video loading timed out.')), 15_000);
        cancelLoad = () => finish(new Error('Video loading was cancelled.'));
        video.addEventListener('loadedmetadata', ready);
        video.addEventListener('error', failed);
        video.src = source.src;
        video.load();
      });
    },
    async play() {
      if (destroyed) throw new Error('Player has been destroyed.');
      try {
        await video.play();
      } catch (error) {
        if (error instanceof Error && error.name === 'NotAllowedError') {
          emit({ type: 'blocked' });
          throw new PlaybackBlockedError();
        }
        throw error;
      }
    },
    pause() { if (!destroyed) video.pause(); },
    seek(seconds) {
      if (destroyed || !Number.isFinite(seconds)) return;
      video.currentTime = Math.max(0, seconds);
      emit({ type: 'time' });
    },
    getCurrentTime() { return destroyed ? 0 : video.currentTime; },
    subscribe(listener) {
      if (!destroyed) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelLoad?.();
      events.forEach(([name, handler]) => video.removeEventListener(name, handler));
      listeners.clear();
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}

export interface PlaybackClip {
  source: PlaybackSource;
  start: number;
  end: number;
  cues: { start: number; end: number }[];
}

export interface ClipSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'completed' | 'blocked' | 'error';
  currentTime: number;
  cueIndex: number;
  error?: string;
}

/** The actual player clock is authoritative, including after native player controls seek/pause. */
export class ClipSession {
  private snapshot: ClipSnapshot;
  private listeners = new Set<(snapshot: ClipSnapshot) => void>();
  private unsubscribe: () => void;
  private timer: ReturnType<typeof setInterval> | undefined;
  private destroyed = false;
  private generation = 0;
  private playRevision = 0;
  private adapter: PlaybackAdapter;
  private clip: PlaybackClip;

  constructor(
    adapter: PlaybackAdapter,
    clip: PlaybackClip,
    options: { pollIntervalMs?: number } = {},
  ) {
    this.adapter = adapter;
    this.clip = clip;
    validatePlaybackRange(clip.start, clip.end);
    if (!clip.cues.length || clip.cues.some((cue, index) => (
      !Number.isFinite(cue.start) || !Number.isFinite(cue.end)
      || cue.start < clip.start || cue.end > clip.end || cue.end <= cue.start
      || (index > 0 && cue.start < clip.cues[index - 1].end)
    ))) throw new Error('Invalid clip cues.');
    this.snapshot = { status: 'idle', currentTime: clip.start, cueIndex: -1 };
    this.unsubscribe = adapter.subscribe((event) => this.onPlaybackEvent(event));
    this.timer = setInterval(() => this.tick(), options.pollIntervalMs ?? 100);
  }

  getSnapshot() { return this.snapshot; }

  subscribe(listener: (snapshot: ClipSnapshot) => void) {
    if (!this.destroyed) {
      this.listeners.add(listener);
      listener(this.snapshot);
    }
    return () => { this.listeners.delete(listener); };
  }

  private update(patch: Partial<ClipSnapshot>) {
    if (this.destroyed) return;
    const next = { ...this.snapshot, ...patch };
    if (next.status === this.snapshot.status && next.currentTime === this.snapshot.currentTime
      && next.cueIndex === this.snapshot.cueIndex && next.error === this.snapshot.error) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener(next));
  }

  private onPlaybackEvent(event: PlaybackEvent) {
    if (this.destroyed) return;
    if (event.type === 'error') {
      ++this.playRevision;
      this.update({ status: 'error', error: event.message || 'Video playback failed.' });
      return;
    }
    if (this.snapshot.status === 'idle' || this.snapshot.status === 'loading' || this.snapshot.status === 'error') return;
    if (event.type === 'blocked') {
      ++this.playRevision;
      this.update({ status: 'blocked' });
    } else if (event.type === 'ended') {
      const time = this.adapter.getCurrentTime();
      if (time < this.clip.end - 0.25) this.update({ status: 'error', error: 'Video ended before the clip finished.' });
      else this.complete();
    } else if (this.snapshot.status !== 'completed') {
      if (event.type === 'playing') this.update({ status: 'playing' });
      if (event.type === 'paused') {
        ++this.playRevision;
        this.update({ status: 'paused' });
      }
    }
    this.tick();
  }

  private complete() {
    ++this.playRevision;
    this.update({ status: 'completed', currentTime: this.clip.end, cueIndex: -1 });
    this.adapter.pause();
  }

  tick() {
    if (this.destroyed || ['idle', 'loading', 'error', 'completed'].includes(this.snapshot.status)) return;
    const time = this.adapter.getCurrentTime();
    if (!Number.isFinite(time)) return;
    if (time >= this.clip.end - 0.04) {
      this.complete();
      return;
    }
    // Native seeks outside the practice range return to the start; API seeks are clamped below.
    if (time < this.clip.start - 0.1) {
      this.adapter.seek(this.clip.start);
      return;
    }
    const currentTime = Math.max(this.clip.start, time);
    const cueIndex = this.clip.cues.findIndex((cue) => currentTime >= cue.start && currentTime < cue.end);
    this.update({ currentTime, cueIndex });
  }

  async start(autoplay = true) {
    if (this.destroyed) return;
    const generation = ++this.generation;
    ++this.playRevision;
    this.update({ status: 'loading', currentTime: this.clip.start, cueIndex: -1, error: undefined });
    try {
      await this.adapter.load(this.clip.source, this.clip.start, this.clip.end);
      if (this.destroyed || generation !== this.generation || this.snapshot.status === 'error') return;
      this.update({ status: 'ready' });
      this.tick();
      if (autoplay) await this.play();
    } catch (error) {
      if (!this.destroyed && generation === this.generation) {
        this.update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  async play() {
    if (this.destroyed || ['idle', 'loading', 'error'].includes(this.snapshot.status)) return;
    if (this.snapshot.status === 'completed') return this.retry();
    const generation = this.generation;
    const playRevision = ++this.playRevision;
    try {
      await this.adapter.play();
      if (!this.destroyed && generation === this.generation && playRevision === this.playRevision && this.snapshot.status !== 'blocked') {
        this.update({ status: 'playing' });
        this.tick();
      }
    } catch (error) {
      if (!this.destroyed && generation === this.generation && playRevision === this.playRevision) {
        if (error instanceof PlaybackBlockedError) this.update({ status: 'blocked' });
        else this.update({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  pause() {
    if (this.destroyed || ['idle', 'loading', 'error', 'completed'].includes(this.snapshot.status)) return;
    ++this.playRevision;
    this.adapter.pause();
    this.update({ status: 'paused' });
    this.tick();
  }

  seek(seconds: number) {
    if (this.destroyed || !Number.isFinite(seconds) || ['idle', 'loading', 'error'].includes(this.snapshot.status)) return;
    ++this.playRevision;
    const wasPlaying = this.snapshot.status === 'playing';
    if (this.snapshot.status === 'completed') this.update({ status: 'paused' });
    this.adapter.seek(Math.max(this.clip.start, Math.min(this.clip.end, seconds)));
    // YouTube seekTo may resume unless explicitly paused, so preserve the caller's paused state.
    if (!wasPlaying) this.adapter.pause();
    this.tick();
  }

  async replayCue() {
    if (this.destroyed) return;
    const cue = this.clip.cues[this.snapshot.cueIndex] ?? this.clip.cues[0];
    this.seek(cue.start);
    await this.play();
  }

  async retry() {
    if (this.destroyed) return;
    if (this.snapshot.status === 'error' || this.snapshot.status === 'idle') return this.start();
    if (this.snapshot.status === 'loading') return;
    ++this.generation;
    ++this.playRevision;
    this.adapter.pause();
    this.update({ status: 'ready', currentTime: this.clip.start, cueIndex: -1, error: undefined });
    this.adapter.seek(this.clip.start);
    this.tick();
    await this.play();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    ++this.generation;
    ++this.playRevision;
    clearInterval(this.timer);
    this.unsubscribe();
    this.listeners.clear();
    this.adapter.destroy();
  }
}
