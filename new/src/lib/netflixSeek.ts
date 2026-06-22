export const NETFLIX_SEEK_EVENT_NAME = 'video-typing:netflix-seek';
export const NETFLIX_BRIDGE_REQUEST_EVENT_NAME = 'video-typing:netflix-request';
export const NETFLIX_BRIDGE_RESPONSE_EVENT_NAME = 'video-typing:netflix-response';
export const NETFLIX_SEEK_BRIDGE_INSTALLED_KEY = '__videoTypingNetflixSeekBridgeInstalled__';

export interface NetflixSeekEventDetail {
  targetId: string;
  nextTimeSeconds: number;
  nextTimeMs: number;
}

export type NetflixTrackKind = 'subtitle' | 'audio';

export interface NetflixTrackOption {
  id: string;
  kind: NetflixTrackKind;
  displayName: string;
  language?: string;
  bcp47?: string;
  trackType?: string;
  isNoneTrack?: boolean;
  isForcedNarrative?: boolean;
  isClosedCaptions?: boolean;
  isImageBased?: boolean;
}

export interface NetflixTrackListResponse {
  subtitles: NetflixTrackOption[];
  audios: NetflixTrackOption[];
}

export interface NetflixSubtitleResponse {
  text: string;
  format: 'ttml' | 'vtt' | 'srt' | 'xml' | 'txt';
  fileName: string;
}

export type NetflixBridgeRequest =
  | { type: 'getTrackList' }
  | { type: 'fetchSubtitle'; trackId: string }
  | { type: 'setAudioTrack'; trackId: string }
  | {
    type: 'replayNativeAudio';
    englishAudioTrackId: string;
    nativeAudioTrackId: string;
    startSeconds: number;
    endSeconds: number;
  };

export interface NetflixBridgeRequestDetail {
  requestId: string;
  request: NetflixBridgeRequest;
}

export interface NetflixBridgeResponseDetail<T = unknown> {
  requestId: string;
  ok: boolean;
  result?: T;
  error?: string;
}

export function isNetflixHostname(hostname: string) {
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === 'netflix.com' || normalizedHostname.endsWith('.netflix.com');
}

export function requestNetflixBridge<T>(request: NetflixBridgeRequest, timeoutMs = 8000) {
  return new Promise<T>((resolve, reject) => {
    const requestId = `video-typing-netflix-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener(NETFLIX_BRIDGE_RESPONSE_EVENT_NAME, handleResponse);
      reject(new Error('Netflix bridge request timed out.'));
    }, timeoutMs);

    const handleResponse = (event: Event) => {
      const detail = (event as CustomEvent<NetflixBridgeResponseDetail<T>>).detail;

      if (detail?.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener(NETFLIX_BRIDGE_RESPONSE_EVENT_NAME, handleResponse);

      if (!detail.ok) {
        reject(new Error(detail.error || 'Netflix bridge request failed.'));
        return;
      }

      resolve(detail.result as T);
    };

    window.addEventListener(NETFLIX_BRIDGE_RESPONSE_EVENT_NAME, handleResponse);
    window.dispatchEvent(new CustomEvent<NetflixBridgeRequestDetail>(NETFLIX_BRIDGE_REQUEST_EVENT_NAME, {
      detail: {
        requestId,
        request,
      },
    }));
  });
}

export function getNetflixTrackList() {
  return requestNetflixBridge<NetflixTrackListResponse>({ type: 'getTrackList' });
}

export function fetchNetflixSubtitle(trackId: string) {
  return requestNetflixBridge<NetflixSubtitleResponse>({ type: 'fetchSubtitle', trackId }, 12000);
}

export function setNetflixAudioTrack(trackId: string) {
  return requestNetflixBridge<void>({ type: 'setAudioTrack', trackId });
}

export function replayNetflixNativeAudio(
  englishAudioTrackId: string,
  nativeAudioTrackId: string,
  startSeconds: number,
  endSeconds: number,
) {
  return requestNetflixBridge<void>({
    type: 'replayNativeAudio',
    englishAudioTrackId,
    nativeAudioTrackId,
    startSeconds,
    endSeconds,
  }, Math.max(8000, (endSeconds - startSeconds + 4) * 1000));
}
