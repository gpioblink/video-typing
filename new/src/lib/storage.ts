import type { PanelKind, PanelPosition, StoredPanelPositions } from '../types';

const STORAGE_KEY = 'videoTypingPrototypePanelPositions';

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
