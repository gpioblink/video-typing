import type {
  ExternalHistoryItem,
  ID,
  PanelKind,
  PanelPosition,
  PanelSize,
  StoredExternalHistoryMeta,
  StoredFrameProgressData,
  StoredPanelPositions,
  StoredPanelSizes,
  StoredPlaybackPositionData,
  StoredSubtitleData,
  Tag,
  StoredTypingProgressData,
} from '../types';

const STORAGE_KEY = 'videoTypingPrototypePanelPositions';
const PANEL_SIZE_STORAGE_KEY = 'videoTypingPrototypePanelSizes';
const SUBTITLE_STORAGE_KEY = 'videoTypingPrototypeSubtitles';
const PROGRESS_STORAGE_KEY = 'videoTypingPrototypeTypingProgress';
const PLAYBACK_STORAGE_KEY = 'videoTypingPrototypePlaybackPositions';
const EXTERNAL_HISTORY_META_STORAGE_KEY = 'videoTypingPrototypeExternalHistoryMeta';

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

export async function loadPanelSize(hostname: string, kind: PanelKind) {
  const result = await chrome.storage.local.get(PANEL_SIZE_STORAGE_KEY);
  const sizes = (result[PANEL_SIZE_STORAGE_KEY] || {}) as StoredPanelSizes;
  return sizes[hostname]?.[kind];
}

export async function savePanelSize(hostname: string, kind: PanelKind, size: PanelSize) {
  const result = await chrome.storage.local.get(PANEL_SIZE_STORAGE_KEY);
  const sizes = (result[PANEL_SIZE_STORAGE_KEY] || {}) as StoredPanelSizes;
  const next = {
    ...sizes,
    [hostname]: {
      ...(sizes[hostname] || {}),
      [kind]: size,
    },
  };
  await chrome.storage.local.set({ [PANEL_SIZE_STORAGE_KEY]: next });
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

export async function deleteStoredSubtitle(url: string) {
  const result = await chrome.storage.local.get(SUBTITLE_STORAGE_KEY);
  const subtitles = { ...((result[SUBTITLE_STORAGE_KEY] || {}) as Record<string, StoredSubtitleData>) };
  delete subtitles[url];
  await chrome.storage.local.set({ [SUBTITLE_STORAGE_KEY]: subtitles });
}

export async function loadStoredTypingProgress(url: string) {
  const result = await chrome.storage.local.get(PROGRESS_STORAGE_KEY);
  const progress = (result[PROGRESS_STORAGE_KEY] || {}) as Record<string, Record<string, unknown>>;
  return normalizeTypingProgress(progress[url]);
}

export async function saveStoredTypingProgress(
  url: string,
  frameId: string,
  frameProgress: StoredFrameProgressData,
) {
  const result = await chrome.storage.local.get(PROGRESS_STORAGE_KEY);
  const progress = (result[PROGRESS_STORAGE_KEY] || {}) as Record<string, Record<string, unknown>>;
  const currentUrlProgress = normalizeTypingProgress(progress[url]);
  await chrome.storage.local.set({
    [PROGRESS_STORAGE_KEY]: {
      ...progress,
      [url]: {
        ...currentUrlProgress,
        [frameId]: normalizeFrameProgress(frameProgress),
      },
    },
  });
}

export async function deleteStoredTypingProgress(url: string) {
  const result = await chrome.storage.local.get(PROGRESS_STORAGE_KEY);
  const progress = { ...((result[PROGRESS_STORAGE_KEY] || {}) as Record<string, Record<string, unknown>>) };
  delete progress[url];
  await chrome.storage.local.set({ [PROGRESS_STORAGE_KEY]: progress });
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

export async function deleteStoredPlaybackPosition(url: string) {
  const result = await chrome.storage.local.get(PLAYBACK_STORAGE_KEY);
  const positions = { ...((result[PLAYBACK_STORAGE_KEY] || {}) as Record<string, StoredPlaybackPositionData>) };
  delete positions[url];
  await chrome.storage.local.set({ [PLAYBACK_STORAGE_KEY]: positions });
}

export async function loadExternalHistoryMeta(url: string) {
  const result = await chrome.storage.local.get(EXTERNAL_HISTORY_META_STORAGE_KEY);
  const meta = (result[EXTERNAL_HISTORY_META_STORAGE_KEY] || {}) as Record<string, StoredExternalHistoryMeta>;
  return meta[url];
}

export async function saveExternalHistoryMeta(url: string, nextMeta: StoredExternalHistoryMeta) {
  const result = await chrome.storage.local.get(EXTERNAL_HISTORY_META_STORAGE_KEY);
  const meta = (result[EXTERNAL_HISTORY_META_STORAGE_KEY] || {}) as Record<string, StoredExternalHistoryMeta>;
  await chrome.storage.local.set({
    [EXTERNAL_HISTORY_META_STORAGE_KEY]: {
      ...meta,
      [url]: nextMeta,
    },
  });
}

export async function clearStoredProgressState(storageKey: string) {
  await Promise.all([
    deleteStoredTypingProgress(storageKey),
    deleteStoredPlaybackPosition(storageKey),
  ]);
}

export async function clearStoredSubtitleSetting(url: string) {
  await deleteStoredSubtitle(url);
}

export async function listExternalHistoryItems(): Promise<ExternalHistoryItem[]> {
  const result = await chrome.storage.local.get([
    SUBTITLE_STORAGE_KEY,
    PROGRESS_STORAGE_KEY,
    PLAYBACK_STORAGE_KEY,
    EXTERNAL_HISTORY_META_STORAGE_KEY,
  ]);
  const subtitles = (result[SUBTITLE_STORAGE_KEY] || {}) as Record<string, StoredSubtitleData>;
  const progress = (result[PROGRESS_STORAGE_KEY] || {}) as Record<string, Record<string, unknown>>;
  const positions = (result[PLAYBACK_STORAGE_KEY] || {}) as Record<string, StoredPlaybackPositionData>;
  const meta = (result[EXTERNAL_HISTORY_META_STORAGE_KEY] || {}) as Record<string, StoredExternalHistoryMeta>;
  const urls = new Set([
    ...Object.keys(subtitles),
    ...Object.keys(progress),
    ...Object.keys(positions),
  ]);

  return Array.from(urls).map((url) => {
    const typingProgress = normalizeTypingProgress(progress[url]);
    const itemMeta = meta[url];
    const fallbackUpdatedAt = getLatestTypingProgressUpdatedAt(typingProgress) ?? 0;

    return {
      url,
      title: itemMeta?.title || getUrlFallbackTitle(url),
      updatedAt: itemMeta?.updatedAt ?? fallbackUpdatedAt,
      subtitle: subtitles[url],
      typingProgress,
      playbackPosition: positions[url],
      meta: itemMeta,
    };
  }).sort((left, right) => right.updatedAt - left.updatedAt);
}

function normalizeTypingProgress(progress: Record<string, unknown> | undefined): StoredTypingProgressData {
  if (!progress) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(progress).map(([frameId, frameProgress]) => [
      frameId,
      normalizeFrameProgress(frameProgress),
    ]),
  );
}

function normalizeFrameProgress(frameProgress: unknown): StoredFrameProgressData {
  if (Array.isArray(frameProgress)) {
    return {
      finishedCharIds: normalizeIdArray(frameProgress),
      tags: [],
      updatedAt: undefined,
    };
  }

  if (!frameProgress || typeof frameProgress !== 'object') {
    return {
      finishedCharIds: [],
      tags: [],
      updatedAt: undefined,
    };
  }

  const candidate = frameProgress as {
    finishedCharIds?: unknown;
    tags?: unknown;
    updatedAt?: unknown;
  };

  return {
    finishedCharIds: normalizeIdArray(candidate.finishedCharIds),
    tags: normalizeTags(candidate.tags),
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : undefined,
  };
}

function normalizeIdArray(value: unknown): ID[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is ID => typeof item === 'string');
}

function normalizeTags(value: unknown): Tag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const candidate = item as {
      id?: unknown;
      pastedCharIds?: unknown;
      content?: unknown;
    };

    if (
      typeof candidate.id !== 'string' ||
      !Array.isArray(candidate.pastedCharIds) ||
      !candidate.pastedCharIds.every((charId) => typeof charId === 'string') ||
      (candidate.content !== 'unaudible' &&
        candidate.content !== 'ignorance' &&
        candidate.content !== 'spelling' &&
        candidate.content !== 'others')
    ) {
      return [];
    }

    return [{
      id: candidate.id,
      pastedCharIds: candidate.pastedCharIds,
      content: candidate.content,
    }];
  });
}

function getLatestTypingProgressUpdatedAt(progress: StoredTypingProgressData) {
  let latestUpdatedAt: number | undefined;

  for (const frameProgress of Object.values(progress)) {
    if (typeof frameProgress.updatedAt !== 'number') {
      continue;
    }

    latestUpdatedAt = typeof latestUpdatedAt === 'number'
      ? Math.max(latestUpdatedAt, frameProgress.updatedAt)
      : frameProgress.updatedAt;
  }

  return latestUpdatedAt;
}

function getUrlFallbackTitle(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname || url;
  } catch {
    return url;
  }
}
