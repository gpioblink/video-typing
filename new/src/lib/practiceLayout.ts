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

/** Initial practice positions use viewport coordinates, as do DraggablePanel
 * and the fixed player. Fullscreen reserves the player's bottom 80px controls. */
export function calculatePracticeLayout(width: number, height: number, mode: PracticeDisplayMode): PracticeLayout {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Viewport dimensions must be positive finite numbers.');
  const w = Math.floor(width), h = Math.floor(height);
  const fullscreen = mode === 'fullscreen';
  const margin = Math.min(16, Math.max(0, (w - 200) / 2));
  const bottom = h - FOOTER - (fullscreen ? 80 : 0);
  const usable = bottom - HEADER;
  const innerWidth = w - margin * 2;
  const panels: PracticeLayout['panels'] = {};
  const panel = (kind: PanelKind, x: number, y: number, panelWidth: number, panelHeight: number, minHeight: number, minimized = false) => {
    panels[kind] = {
      position: { x, y }, size: { width: panelWidth, height: panelHeight },
      minimumSize: { width: Math.min(240, panelWidth), height: minHeight },
      defaultMinimized: minimized,
    };
  };
  let player = { x: 0, y: HEADER, width: w, height: Math.max(200, h - HEADER) };
  const columns = w >= 640 && usable >= (fullscreen ? 364 : 480);
  if (columns) {
    const rightWidth = bound(Math.floor(w * 0.28), 240, 350);
    const leftWidth = innerWidth - rightWidth - 16;
    const rightX = w - margin - rightWidth;
    const controlsHeight = Math.min(w >= 960 ? 210 : 160, usable - 40 - 160 - GAP * 2);
    const hintHeight = Math.min(fullscreen ? 240 : 400, usable - controlsHeight - 40 - GAP * 2);
    const rightHeight = controlsHeight + COLLAPSED_HEIGHT + hintHeight + GAP * 2;
    const rightTop = fullscreen ? bottom - rightHeight : HEADER;
    panel('controls', rightX, rightTop, rightWidth, controlsHeight, 140);
    panel('config', rightX, rightTop + controlsHeight + GAP, rightWidth, Math.min(400, usable), 160, true);
    panel('hint', rightX, rightTop + controlsHeight + GAP * 2 + COLLAPSED_HEIGHT, rightWidth, hintHeight, 160);
    if (!fullscreen) {
      const playerHeight = bound(Math.min(usable - 160 - 96 - GAP * 2, leftWidth * 9 / 16), 200, 360);
      const playerWidth = Math.min(leftWidth, playerHeight * 16 / 9);
      player = { x: margin + (leftWidth - playerWidth) / 2, y: HEADER, width: playerWidth, height: playerHeight };
      const remaining = usable - playerHeight - GAP * 2;
      const typingHeight = Math.min(260, remaining - 96);
      const subtitleHeight = Math.min(180, remaining - typingHeight);
      panel('typing', margin, HEADER + playerHeight + GAP, leftWidth, typingHeight, 160);
      panel('subtitle', margin, HEADER + playerHeight + GAP * 2 + typingHeight, leftWidth, subtitleHeight, 96);
    } else {
      const subtitleHeight = Math.min(160, Math.max(96, usable - 260 - GAP));
      const typingHeight = Math.min(260, usable - subtitleHeight - GAP);
      panel('typing', margin, bottom - subtitleHeight - GAP - typingHeight, leftWidth, typingHeight, 160);
      panel('subtitle', margin, bottom - subtitleHeight, leftWidth, subtitleHeight, 96);
    }
  } else {
    // A single main column keeps narrow screens usable. Config and Hint share
    // a row of collapsed headers; their expanded sizes remain intact.
    let gap = GAP;
    let controlsHeight = 160, subtitleHeight = 96;
    let controlsMinimized = false, subtitleMinimized = false, typingMinimized = false;
    const videoHeight = fullscreen ? 0 : 200;
    const gapCount = fullscreen ? 3 : 4;
    const required = () => videoHeight + (controlsMinimized ? 40 : controlsHeight) + 40
      + (typingMinimized ? 40 : 160) + (subtitleMinimized ? 40 : subtitleHeight) + gapCount * gap;
    if (required() > usable) controlsHeight = 140;
    if (required() > usable) controlsMinimized = true;
    if (required() > usable) subtitleMinimized = true;
    if (required() > usable) gap = Math.max(4, Math.floor((usable - required() + gapCount * gap) / gapCount));
    if (required() > usable) typingMinimized = true;
    const extra = Math.max(0, usable - required());
    const typingHeight = typingMinimized ? 160 : Math.min(260, 160 + extra);
    let y = fullscreen ? bottom - required() - (typingMinimized ? 0 : typingHeight - 160) : HEADER;
    if (!fullscreen) {
      player = { x: margin, y, width: innerWidth, height: 200 };
      y += 200 + gap;
    }
    panel('controls', margin, y, innerWidth, controlsHeight, 140, controlsMinimized);
    y += (controlsMinimized ? 40 : controlsHeight) + gap;
    const auxiliaryWidth = (innerWidth - gap) / 2;
    panel('config', margin, y, auxiliaryWidth, Math.min(400, Math.max(160, usable)), 160, true);
    panel('hint', margin + auxiliaryWidth + gap, y, auxiliaryWidth, 200, 160, true);
    y += 40 + gap;
    panel('typing', margin, y, innerWidth, typingHeight, 160, typingMinimized);
    y += (typingMinimized ? 40 : typingHeight) + gap;
    panel('subtitle', margin, y, innerWidth, subtitleHeight, 96, subtitleMinimized);
  }
  return { player, panels };
}
