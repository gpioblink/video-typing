import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  NETFLIX_BRIDGE_REQUEST_EVENT_NAME,
  NETFLIX_BRIDGE_RESPONSE_EVENT_NAME,
  NETFLIX_SEEK_BRIDGE_INSTALLED_KEY,
  NETFLIX_SEEK_EVENT_NAME,
  type NetflixBridgeRequest,
  type NetflixBridgeRequestDetail,
  type NetflixBridgeResponseDetail,
  type NetflixSeekEventDetail,
  type NetflixSubtitleResponse,
  type NetflixTrackKind,
  type NetflixTrackListResponse,
  type NetflixTrackOption,
} from '../src/lib/netflixSeek';

interface NetflixPlayer {
  getAudioTrack?: () => unknown;
  getAudioTrackList?: () => unknown[];
  getCurrentTime?: () => number;
  getTextTrack?: () => unknown;
  getTextTrackList?: () => unknown[];
  getTimedTextTrack?: () => unknown;
  getTimedTextTrackList?: () => unknown[];
  pause?: () => void;
  play?: () => void;
  seek?: (timeMs: number) => void;
  setAudioTrack?: (track: unknown) => void;
  setTextTrack?: (track: unknown) => void;
  setTimedTextTrack?: (track: unknown) => void;
}

interface NetflixVideoPlayerApi {
  getAllPlayerSessionIds?: () => string[];
  getVideoPlayerBySessionId?: (sessionId: string) => NetflixPlayer | undefined;
}

interface NetflixPlayerApi {
  getOpenPlaybackSessions?: () => Array<{ playbackInitiator?: string; sessionId?: string }>;
  videoPlayer?: NetflixVideoPlayerApi;
}

interface NetflixGlobal {
  appContext?: {
    getPlayerApp?: () => {
      getAPI?: () => NetflixPlayerApi | undefined;
    };
    state?: {
      playerApp?: {
        getAPI?: () => NetflixPlayerApi | undefined;
      };
    };
  };
}

type NetflixBridgeWindow = Window & {
  [NETFLIX_SEEK_BRIDGE_INSTALLED_KEY]?: boolean;
  netflix?: NetflixGlobal;
};

const subtitleTrackById = new Map<string, unknown>();
const audioTrackById = new Map<string, unknown>();
let nativeReplayPromise: Promise<void> | null = null;

export default defineContentScript({
  registration: 'runtime',
  world: 'MAIN',
  main() {
    const bridgeWindow = window as NetflixBridgeWindow;

    if (bridgeWindow[NETFLIX_SEEK_BRIDGE_INSTALLED_KEY]) {
      return;
    }

    bridgeWindow[NETFLIX_SEEK_BRIDGE_INSTALLED_KEY] = true;
    window.addEventListener(NETFLIX_SEEK_EVENT_NAME, handleNetflixSeek);
    window.addEventListener(NETFLIX_BRIDGE_REQUEST_EVENT_NAME, (event) => {
      void handleNetflixBridgeRequest(event);
    });
  },
});

function handleNetflixSeek(event: Event) {
  const detail = (event as CustomEvent<NetflixSeekEventDetail>).detail;

  if (!detail || !Number.isFinite(detail.nextTimeMs)) {
    return;
  }

  const player = getActiveNetflixPlayer();

  if (!player?.seek) {
    console.warn('[video-typing] Netflix player seek API is not available.');
    return;
  }

  try {
    player.seek(Math.max(0, detail.nextTimeMs));
  } catch (error) {
    console.warn('[video-typing] Netflix seek failed.', error);
  }
}

async function handleNetflixBridgeRequest(event: Event) {
  const detail = (event as CustomEvent<NetflixBridgeRequestDetail>).detail;

  if (!detail?.requestId || !detail.request) {
    return;
  }

  try {
    const result = await runNetflixBridgeRequest(detail.request);
    sendBridgeResponse({
      requestId: detail.requestId,
      ok: true,
      result,
    });
  } catch (error) {
    console.warn('[video-typing] Netflix bridge request failed.', error);
    sendBridgeResponse({
      requestId: detail.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runNetflixBridgeRequest(request: NetflixBridgeRequest) {
  switch (request.type) {
    case 'getTrackList':
      return getNetflixTrackList();
    case 'fetchSubtitle':
      return fetchNetflixSubtitle(request.trackId);
    case 'setAudioTrack':
      setAudioTrackById(request.trackId);
      return undefined;
    case 'replayNativeAudio':
      nativeReplayPromise = (nativeReplayPromise || Promise.resolve())
        .catch(() => undefined)
        .then(() => replayNativeAudio(
          request.englishAudioTrackId,
          request.nativeAudioTrackId,
          request.startSeconds,
          request.endSeconds,
        ));
      await nativeReplayPromise;
      return undefined;
    default:
      throw new Error('Unknown Netflix bridge request.');
  }
}

function sendBridgeResponse(detail: NetflixBridgeResponseDetail) {
  window.dispatchEvent(new CustomEvent<NetflixBridgeResponseDetail>(NETFLIX_BRIDGE_RESPONSE_EVENT_NAME, {
    detail,
  }));
}

function getActiveNetflixPlayer() {
  const bridgeWindow = window as NetflixBridgeWindow;
  const api = getNetflixPlayerApi(bridgeWindow);
  const videoPlayer = api?.videoPlayer;
  const openSession = api?.getOpenPlaybackSessions?.()
    ?.find((session) => session.playbackInitiator === 'USER' && session.sessionId);

  if (openSession?.sessionId) {
    const player = videoPlayer?.getVideoPlayerBySessionId?.(openSession.sessionId);

    if (player) {
      return player;
    }
  }

  const sessionIds = videoPlayer?.getAllPlayerSessionIds?.();
  const sessionId = sessionIds?.find((id) => id.includes('watch'))
    || sessionIds?.find((id) => id.includes('preview'))
    || sessionIds?.[0];

  if (!sessionId) {
    return undefined;
  }

  return videoPlayer?.getVideoPlayerBySessionId?.(sessionId);
}

function getNetflixPlayerApi(bridgeWindow = window as NetflixBridgeWindow) {
  return bridgeWindow.netflix?.appContext?.getPlayerApp?.()?.getAPI?.()
    || bridgeWindow.netflix?.appContext?.state?.playerApp?.getAPI?.();
}

function getNetflixTrackList(): NetflixTrackListResponse {
  const player = requireActiveNetflixPlayer();
  const subtitleTracks = getSubtitleTrackList(player);
  const audioTracks = toArray(player.getAudioTrackList?.());

  subtitleTrackById.clear();
  audioTrackById.clear();

  const subtitles = subtitleTracks
    .map((track, index) => normalizeTrackOption(track, 'subtitle', index))
    .filter((track, index) => {
      if (!track) return false;
      const rawTrack = subtitleTracks[index];
      subtitleTrackById.set(track.id, rawTrack);
      return !track.isNoneTrack && !isOffTrack(rawTrack) && !track.isImageBased;
    }) as NetflixTrackOption[];
  const audios = audioTracks
    .map((track, index) => normalizeTrackOption(track, 'audio', index))
    .filter((track, index) => {
      if (!track) return false;
      const rawTrack = audioTracks[index];
      audioTrackById.set(track.id, rawTrack);
      return !track.isNoneTrack && !isOffTrack(rawTrack);
    }) as NetflixTrackOption[];

  return { subtitles, audios };
}

async function fetchNetflixSubtitle(trackId: string): Promise<NetflixSubtitleResponse> {
  const player = requireActiveNetflixPlayer();
  const track = findSubtitleTrackById(player, trackId);

  if (!track) {
    throw new Error('Netflix subtitle track was not found.');
  }

  const directUrl = findSubtitleDownloadUrl(track);

  if (directUrl) {
    const text = await fetch(directUrl).then((response) => response.text());
    return {
      text,
      format: detectSubtitleResponseFormat(directUrl, text),
      fileName: getSubtitleFileName(track, directUrl),
    };
  }

  const text = await captureSubtitleResponseForTrack(player, track);
  return {
    text,
    format: detectSubtitleResponseFormat('', text),
    fileName: getSubtitleFileName(track, ''),
  };
}

function getSubtitleTrackList(player: NetflixPlayer) {
  return toArray(player.getTimedTextTrackList?.()).length > 0
    ? toArray(player.getTimedTextTrackList?.())
    : toArray(player.getTextTrackList?.());
}

function getCurrentSubtitleTrack(player: NetflixPlayer) {
  return player.getTimedTextTrack?.() || player.getTextTrack?.() || undefined;
}

function setSubtitleTrack(player: NetflixPlayer, track: unknown) {
  if (player.setTimedTextTrack) {
    player.setTimedTextTrack(track);
    return;
  }

  if (player.setTextTrack) {
    player.setTextTrack(track);
    return;
  }

  throw new Error('Netflix subtitle track switch API is not available.');
}

function findSubtitleTrackById(player: NetflixPlayer, trackId: string) {
  const cachedTrack = subtitleTrackById.get(trackId);

  if (cachedTrack) {
    return cachedTrack;
  }

  return getSubtitleTrackList(player).find((track, index) => normalizeTrackId(track, 'subtitle', index) === trackId);
}

function findAudioTrackById(player: NetflixPlayer, trackId: string) {
  const cachedTrack = audioTrackById.get(trackId);

  if (cachedTrack) {
    return cachedTrack;
  }

  return toArray(player.getAudioTrackList?.()).find((track, index) => normalizeTrackId(track, 'audio', index) === trackId);
}

function setAudioTrackById(trackId: string) {
  const player = requireActiveNetflixPlayer();
  const track = findAudioTrackById(player, trackId);

  if (!track) {
    throw new Error('Netflix audio track was not found.');
  }

  if (!player.setAudioTrack) {
    throw new Error('Netflix audio track switch API is not available.');
  }

  player.setAudioTrack(track);
}

async function replayNativeAudio(
  englishAudioTrackId: string,
  nativeAudioTrackId: string,
  startSeconds: number,
  endSeconds: number,
) {
  const player = requireActiveNetflixPlayer();
  const englishTrack = findAudioTrackById(player, englishAudioTrackId);
  const nativeTrack = findAudioTrackById(player, nativeAudioTrackId);

  if (!englishTrack || !nativeTrack) {
    throw new Error('Netflix replay audio tracks were not found.');
  }

  const video = document.querySelector('video');
  const wasPaused = Boolean(video?.paused);

  if (video) {
    video.playbackRate = 1;
  }

  try {
    player.setAudioTrack?.(nativeTrack);
    player.seek?.(Math.max(0, Math.round(startSeconds * 1000)));
    player.play?.();
    await video?.play?.().catch(() => undefined);
    await waitForNetflixPlaybackTime(player, startSeconds, endSeconds);
  } finally {
    try {
      player.setAudioTrack?.(englishTrack);
    } finally {
      if (wasPaused) {
        player.pause?.();
        video?.pause?.();
      }
    }
  }
}

function waitForNetflixPlaybackTime(player: NetflixPlayer, startSeconds: number, endSeconds: number) {
  const endMs = endSeconds * 1000;
  const timeoutMs = Math.max(1000, (endSeconds - startSeconds + 4) * 1000);
  const startedAt = Date.now();

  return new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      const playerTime = player.getCurrentTime?.();
      const videoTime = document.querySelector('video')?.currentTime;
      const currentMs = Number.isFinite(playerTime) ? Number(playerTime) : (videoTime || 0) * 1000;

      if (currentMs >= endMs || Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        resolve();
      }
    }, 100);
  });
}

function captureSubtitleResponseForTrack(player: NetflixPlayer, track: unknown) {
  return new Promise<string>((resolve, reject) => {
    const originalFetch = window.fetch;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const currentTrack = getCurrentSubtitleTrack(player);
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Netflix subtitle response was not captured.'));
    }, 4000);
    let settled = false;

    const finish = (text: string) => {
      if (settled || !isSubtitleResponse(text)) {
        return;
      }

      settled = true;
      cleanup();
      resolve(text);
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalOpen;
      XMLHttpRequest.prototype.send = originalSend;

      if (currentTrack) {
        try {
          setSubtitleTrack(player, currentTrack);
        } catch {
          // Ignore restore failures.
        }
      }
    };

    window.fetch = async (...args) => {
      const response = await originalFetch.apply(window, args);
      const url = typeof args[0] === 'string' ? args[0] : String((args[0] as Request | undefined)?.url || '');

      if (isSubtitleUrl(url)) {
        void response.clone().text().then(finish).catch(() => undefined);
      }

      return response;
    };

    XMLHttpRequest.prototype.open = function open(method: string, url: string | URL, ...rest: unknown[]) {
      (this as XMLHttpRequest & { __videoTypingNetflixSubtitleUrl?: string }).__videoTypingNetflixSubtitleUrl = String(url);
      return originalOpen.apply(this, [method, url, ...rest] as Parameters<XMLHttpRequest['open']>);
    };

    XMLHttpRequest.prototype.send = function send(...args: unknown[]) {
      this.addEventListener('load', function onLoad() {
        const url = (this as XMLHttpRequest & { __videoTypingNetflixSubtitleUrl?: string }).__videoTypingNetflixSubtitleUrl || '';

        if (!isSubtitleUrl(url)) {
          return;
        }

        try {
          finish(String(this.responseText || ''));
        } catch {
          // Ignore inaccessible response bodies.
        }
      }, { once: true });

      return originalSend.apply(this, args as [Document | XMLHttpRequestBodyInit | null | undefined]);
    };

    try {
      const offTrack = getSubtitleTrackList(player).find(isOffTrack);

      if (offTrack) {
        setSubtitleTrack(player, offTrack);
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => setSubtitleTrack(player, track));
        });
      } else {
        setSubtitleTrack(player, track);
      }
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function requireActiveNetflixPlayer() {
  const player = getActiveNetflixPlayer();

  if (!player) {
    throw new Error('Netflix player is not available.');
  }

  return player;
}

function normalizeTrackOption(track: unknown, kind: NetflixTrackKind, index: number): NetflixTrackOption | null {
  if (!track || typeof track !== 'object') {
    return null;
  }

  const candidate = track as Record<string, unknown>;
  return {
    id: normalizeTrackId(track, kind, index),
    kind,
    displayName: String(candidate.displayName || candidate.languageDescription || candidate.label || candidate.bcp47 || candidate.language || `${kind} ${index + 1}`),
    language: typeof candidate.language === 'string' ? candidate.language : undefined,
    bcp47: typeof candidate.bcp47 === 'string' ? candidate.bcp47 : undefined,
    trackType: typeof candidate.trackType === 'string' ? candidate.trackType : typeof candidate.rawTrackType === 'string' ? candidate.rawTrackType : undefined,
    isNoneTrack: Boolean(candidate.isNoneTrack),
    isForcedNarrative: Boolean(candidate.isForcedNarrative),
    isClosedCaptions: Boolean(candidate.isClosedCaptions || candidate.rawTrackType === 'closedcaptions'),
    isImageBased: Boolean(candidate.isImageBased),
  };
}

function normalizeTrackId(track: unknown, kind: NetflixTrackKind, index: number) {
  const candidate = track && typeof track === 'object' ? track as Record<string, unknown> : {};
  return String(candidate.trackId || candidate.new_track_id || candidate.id || `${kind}-${index}`);
}

function isOffTrack(track: unknown) {
  const candidate = track && typeof track === 'object' ? track as Record<string, unknown> : {};
  const displayName = String(candidate.displayName || '').toLowerCase();
  const trackId = String(candidate.trackId || candidate.new_track_id || '').toLowerCase();
  return Boolean(candidate.isNoneTrack) || displayName === 'off' || trackId.includes('none');
}

function findSubtitleDownloadUrl(value: unknown, seen = new Set<unknown>()): string | null {
  if (!value || seen.has(value)) {
    return null;
  }

  if (typeof value === 'string') {
    return isSubtitleUrl(value) ? value : null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findSubtitleDownloadUrl(item, seen);
      if (url) return url;
    }
    return null;
  }

  const object = value as Record<string, unknown>;
  const preferredKeys = [
    'ttDownloadables',
    'downloadUrls',
    'downloadUrl',
    'urls',
    'url',
    'webvtt',
    'dfxp',
    'simplesdh',
    'nflx-cmisc',
    'imsc1.1',
  ];

  for (const key of preferredKeys) {
    const url = findSubtitleDownloadUrl(object[key], seen);
    if (url) return url;
  }

  for (const item of Object.values(object)) {
    const url = findSubtitleDownloadUrl(item, seen);
    if (url) return url;
  }

  return null;
}

function isSubtitleUrl(url: string) {
  const lowerUrl = url.toLowerCase();
  return (
    /^https?:\/\//.test(url) &&
    (
      lowerUrl.includes('nflxvideo.net') ||
      lowerUrl.includes('timedtext') ||
      lowerUrl.includes('.vtt') ||
      lowerUrl.includes('.xml') ||
      lowerUrl.includes('dfxp')
    )
  );
}

function isSubtitleResponse(text: string) {
  const trimmed = text.trimStart().toLowerCase();
  return trimmed.startsWith('webvtt') || trimmed.startsWith('<?xml') || trimmed.includes('<tt');
}

function detectSubtitleResponseFormat(url: string, text: string): NetflixSubtitleResponse['format'] {
  const lowerUrl = url.toLowerCase();
  const trimmedText = text.trimStart().toLowerCase();

  if (lowerUrl.includes('webvtt') || lowerUrl.endsWith('.vtt') || trimmedText.startsWith('webvtt')) {
    return 'vtt';
  }

  if (lowerUrl.includes('dfxp') || lowerUrl.endsWith('.xml') || trimmedText.startsWith('<?xml') || trimmedText.includes('<tt')) {
    return 'ttml';
  }

  return 'txt';
}

function getSubtitleFileName(track: unknown, url: string) {
  const candidate = track && typeof track === 'object' ? track as Record<string, unknown> : {};
  const displayName = String(candidate.displayName || candidate.languageDescription || candidate.bcp47 || candidate.language || 'Netflix subtitle');
  const extension = url.toLowerCase().includes('webvtt') || url.toLowerCase().endsWith('.vtt') ? 'vtt' : 'ttml';
  return `${displayName}.${extension}`;
}

function toArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}
