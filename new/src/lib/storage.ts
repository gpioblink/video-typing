import type {
  PanelKind,
  PanelPosition,
  StoredPanelPositions,
  StoredPlaybackPositionData,
  StoredSubtitleData,
  StoredTypingProgressData,
} from '../types';

const STORAGE_KEY = 'videoTypingPrototypePanelPositions';
const SUBTITLE_STORAGE_KEY = 'videoTypingPrototypeSubtitles';
const PROGRESS_STORAGE_KEY = 'videoTypingPrototypeTypingProgress';
const PLAYBACK_STORAGE_KEY = 'videoTypingPrototypePlaybackPositions';

export async function loadPanelPosition(hostname: string, kind: PanelKind) {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const positions = (result[STORAGE_KEY] || {}) as StoredPanelPositions;
  return positions[hostname]?.[kind];
}

export async function savePanelPosition(hostname: string, kind: PanelKind, position: PanelPosition) {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const positions = (result[STORAGE_KEY] || {}) as StoredPanelPositions;
  const next = {
    ...positions,
    [hostname]: {
      ...(positions[hostname] || {}),
      [kind]: position,
    },
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

export async function loadStoredSubtitle(url: string) {
  const result = await chrome.storage.local.get(SUBTITLE_STORAGE_KEY);
  const subtitles = (result[SUBTITLE_STORAGE_KEY] || {}) as Record<string, StoredSubtitleData>;
  return subtitles[url];
}

export async function saveStoredSubtitle(url: string, subtitle: StoredSubtitleData) {
  const result = await chrome.storage.local.get(SUBTITLE_STORAGE_KEY);
  const subtitles = (result[SUBTITLE_STORAGE_KEY] || {}) as Record<string, StoredSubtitleData>;
  await chrome.storage.local.set({
    [SUBTITLE_STORAGE_KEY]: {
      ...subtitles,
      [url]: subtitle,
    },
  });
}

export async function loadStoredTypingProgress(url: string) {
  const result = await chrome.storage.local.get(PROGRESS_STORAGE_KEY);
  const progress = (result[PROGRESS_STORAGE_KEY] || {}) as Record<string, StoredTypingProgressData>;
  return progress[url] || {};
}

export async function saveStoredTypingProgress(
  url: string,
  frameId: string,
  finishedCharIds: string[],
) {
  const result = await chrome.storage.local.get(PROGRESS_STORAGE_KEY);
  const progress = (result[PROGRESS_STORAGE_KEY] || {}) as Record<string, StoredTypingProgressData>;
  await chrome.storage.local.set({
    [PROGRESS_STORAGE_KEY]: {
      ...progress,
      [url]: {
        ...(progress[url] || {}),
        [frameId]: finishedCharIds,
      },
    },
  });
}

export async function loadStoredPlaybackPosition(url: string) {
  const result = await chrome.storage.local.get(PLAYBACK_STORAGE_KEY);
  const positions = (result[PLAYBACK_STORAGE_KEY] || {}) as Record<string, StoredPlaybackPositionData>;
  return positions[url];
}

export async function saveStoredPlaybackPosition(url: string, currentTime: number) {
  const result = await chrome.storage.local.get(PLAYBACK_STORAGE_KEY);
  const positions = (result[PLAYBACK_STORAGE_KEY] || {}) as Record<string, StoredPlaybackPositionData>;
  await chrome.storage.local.set({
    [PLAYBACK_STORAGE_KEY]: {
      ...positions,
      [url]: { currentTime },
    },
  });
}
