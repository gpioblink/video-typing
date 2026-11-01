import type { PanelKind, PanelPosition, PanelSize } from '../types';

export type PracticeDisplayMode = 'mini' | 'fullscreen';
export interface PracticePanelLayout {
  position: PanelPosition;
  size: PanelSize;
  minimumSize?: PanelSize;
  defaultMinimized?: boolean;
}
export interface PracticeLayout {
  player: { x: number; y: number; width: number; height: number };
  panels: Partial<Record<PanelKind, PracticePanelLayout>>;
}

const HEADER = 72;
const FOOTER = 16;
const GAP = 12;
const COLLAPSED_HEIGHT = 40;
const DEFAULT_MINIMUM = { width: 240, height: 160 };
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const bound = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Clamp the expanded size separately from the visible collapsed header. */
export function clampPanelGeometry(
  position: PanelPosition,
  size: PanelSize,
  minimumSize: PanelSize = DEFAULT_MINIMUM,
  width = window.innerWidth,
  height = window.innerHeight,
  minimized = false,
) {
  const viewportWidth = Math.max(1, finite(width, 1));
  const viewportHeight = Math.max(1, finite(height, 1));
  const availableWidth = Math.max(1, viewportWidth - FOOTER);
  const availableHeight = Math.max(1, viewportHeight - FOOTER);
  const minWidth = bound(finite(minimumSize.width, 240), 1, availableWidth);
  const minHeight = bound(finite(minimumSize.height, 160), 1, availableHeight);
  const nextSize = {
    width: bound(finite(size.width, minWidth), minWidth, availableWidth),
    height: bound(finite(size.height, minHeight), minHeight, availableHeight),
  };
  return {
    size: nextSize,
    position: {
      x: bound(finite(position.x, 0), 0, Math.max(0, viewportWidth - nextSize.width)),
      y: bound(finite(position.y, 0), 0, Math.max(0, viewportHeight - (minimized ? COLLAPSED_HEIGHT : nextSize.height))),
    },
  };
}

/** Four learning panels share a viewport-centred work area. The right hint
 * column limits its symmetric width instead of moving typing off-centre. */
export function calculatePracticeLayout(width: number, height: number, mode: PracticeDisplayMode): PracticeLayout {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Viewport dimensions must be positive finite numbers.');
  const w = Math.floor(width), h = Math.floor(height);
  const fullscreen = mode === 'fullscreen';
  const margin = Math.min(16, Math.max(0, (w - 200) / 2));
  const center = w / 2;
  const bottom = h - FOOTER - (fullscreen ? 80 : 0);
  const hintExpanded = w >= 960;
  const hintWidth = hintExpanded
    ? bound(Math.floor(w * 0.28), 240, 350)
    : Math.min(216, (w - margin * 2 - GAP) / 2);
  const hintLeft = w - margin - hintWidth;
  const symmetricWidth = hintExpanded
    ? 2 * (hintLeft - GAP - center)
    : w - margin * 2;
  const typingWidth = Math.max(1, Math.min(760, symmetricWidth));
  const captionWidth = Math.min(typingWidth, Math.max(200, typingWidth / 2));
  const configWidth = Math.min(216, hintExpanded ? typingWidth : hintWidth);
  const panels: PracticeLayout['panels'] = {};
  const panel = (kind: PanelKind, x: number, y: number, panelWidth: number, panelHeight: number, minimumHeight: number, minimized = false) => {
    panels[kind] = {
      position: { x, y }, size: { width: panelWidth, height: panelHeight },
      minimumSize: { width: Math.min(200, panelWidth), height: minimumHeight },
      defaultMinimized: minimized,
    };
  };
  panel('config', margin, HEADER, configWidth, Math.min(400, h - HEADER - FOOTER), 160, true);
  panel('hint', hintLeft, HEADER, hintWidth, hintExpanded ? bottom - HEADER : 200, 160, !hintExpanded);

  let gap = GAP;
  let captionHeight = 160;
  let typingHeight: number;
  let player = { x: 0, y: HEADER, width: w, height: Math.max(200, h - HEADER) };
  if (fullscreen) {
    // Narrow screens put the two auxiliary headers above the centred captions.
    const workTop = HEADER + (hintExpanded ? 0 : COLLAPSED_HEIGHT + GAP);
    typingHeight = Math.min(260, Math.max(160, bottom - workTop - captionHeight - gap));
  } else {
    let playerTop = HEADER + (hintExpanded ? 0 : COLLAPSED_HEIGHT + GAP);
    // On short viewports auxiliary headers may share the player's upper corners.
    // The native player's bottom control strip always remains uncovered.
    if (bottom - playerTop < 200 + 160 + captionHeight + gap * 2) playerTop = HEADER;
    if (bottom - playerTop < 200 + 160 + captionHeight + gap * 2) captionHeight = 140;
    if (bottom - playerTop < 200 + 160 + captionHeight + gap * 2) {
      gap = Math.max(2, Math.min(GAP, (bottom - playerTop - 200 - 160 - captionHeight) / 2));
    }
    typingHeight = Math.min(260, Math.max(160, bottom - playerTop - 200 - captionHeight - gap * 2));
    const captionTop = bottom - typingHeight - gap - captionHeight;
    const playerHeight = Math.max(200, Math.min(hintExpanded ? 360 : 200, captionTop - gap - playerTop, symmetricWidth * 9 / 16));
    const playerWidth = Math.min(640, symmetricWidth, playerHeight * 16 / 9);
    player = { x: center - playerWidth / 2, y: playerTop, width: playerWidth, height: playerHeight };
  }
  const typingTop = bottom - typingHeight;
  panel('typing', center - typingWidth / 2, typingTop, typingWidth, typingHeight, 160);
  panel('subtitle', center - captionWidth / 2, typingTop - gap - captionHeight, captionWidth, captionHeight, 140);
  return { player, panels };
}
