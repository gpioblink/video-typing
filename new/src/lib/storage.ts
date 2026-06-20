import type {
  ID,
  PanelKind,
  PanelPosition,
  PanelSize,
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
