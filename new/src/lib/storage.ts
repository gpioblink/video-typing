import type {
  PanelKind,
  PanelPosition,
  StoredPanelPositions,
  StoredSubtitleData,
} from '../types';

const STORAGE_KEY = 'videoTypingPrototypePanelPositions';
const SUBTITLE_STORAGE_KEY = 'videoTypingPrototypeSubtitles';

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
