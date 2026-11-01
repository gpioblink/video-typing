import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface Props { step: 'play' | 'type' | 'replay' | 'finish'; onSkip: () => void }
interface Rect { left: number; top: number; width: number; height: number }
interface Layout { spot: Rect | null; card: Rect }
const MARGIN = 12;
const GAP = 12;
const CARD_WIDTH = 320;
const COPY = {
  play: { number: 1, title: 'まず動画を再生', text: '明るい「再生する」を押しましょう。動画中央の再生ボタンも使えます。再生が始まると入力欄を案内します。' },
  type: { number: 1, title: 'ここで英字を入力', text: '明るいTyping欄をクリックして、聞こえた英字を入力しましょう。空白・記号は自動です。' },
  replay: { number: 2, title: 'もう一度、聞いてみる', text: '明るい「聞き直す」を押してみましょう。入力したところはそのまま残ります。' },
  finish: { number: 3, title: '最後まで入力してみる', text: 'Typing欄で続きを入力しましょう。未完了の問題は繰り返し再生されます。' },
};

function viewport(): Rect {
  const visual = window.visualViewport;
  return { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0,
    width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight };
}

function rectFor(element: HTMLElement | null, bounds: Rect): Rect | null {
  if (!element?.isConnected) return null;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const left = Math.max(bounds.left, rect.left - 6);
  const top = Math.max(bounds.top, rect.top - 6);
  const right = Math.min(bounds.left + bounds.width, rect.right + 6);
  const bottom = Math.min(bounds.top + bounds.height, rect.bottom + 6);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

/** Choose an area outside the spotlight. On short screens only the copy
 * scrolls; the skip action stays in the card's visible footer. */
function cardPosition(spot: Rect, bounds: Rect, desiredHeight: number): Rect | null {
  const left = bounds.left + MARGIN;
  const top = bounds.top + MARGIN;
  const right = bounds.left + bounds.width - MARGIN;
  const bottom = bounds.top + bounds.height - MARGIN;
  const regions = [
    { left, top: spot.top + spot.height + GAP, width: right - left, height: bottom - spot.top - spot.height - GAP },
    { left, top, width: right - left, height: spot.top - GAP - top },
    { left: spot.left + spot.width + GAP, top, width: right - spot.left - spot.width - GAP, height: bottom - top },
    { left, top, width: spot.left - GAP - left, height: bottom - top },
  ].filter(region => region.width >= Math.min(220, bounds.width - MARGIN * 2) && region.height >= 82);
  if (!regions.length) return null;
  const fits = (region: Rect) => region.width >= Math.min(CARD_WIDTH, bounds.width - MARGIN * 2) && region.height >= desiredHeight;
  regions.sort((a, b) => Number(fits(b)) - Number(fits(a))
    || Math.min(b.width, CARD_WIDTH) * Math.min(b.height, desiredHeight) - Math.min(a.width, CARD_WIDTH) * Math.min(a.height, desiredHeight));
  const region = regions[0];
  const width = Math.min(CARD_WIDTH, region.width);
  const height = Math.min(desiredHeight, region.height);
  return {
    left: Math.max(region.left, Math.min(region.left + region.width - width, spot.left + spot.width / 2 - width / 2)),
    top: Math.max(region.top, Math.min(region.top + region.height - height, spot.top + spot.height / 2 - height / 2)),
    width, height,
  };
}

function sameRect(a: Rect | null, b: Rect | null) {
  if (!a || !b) return a === b;
  return (['left', 'top', 'width', 'height'] as const).every(key => Math.abs(a[key] - b[key]) < 0.5);
}

/** A nonmodal tour. The mask does not receive clicks or focus; the original
 * typing surface stays interactive and keeps its normal keyboard behavior. */
export function PracticeTutorial({ step, onSkip }: Props) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef(onSkip);
  skipRef.current = onSkip;
  const descriptionId = useId();

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopImmediatePropagation(); skipRef.current();
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, []);

  useEffect(() => {
    let frame = 0;
    let disposed = false;
    let target: HTMLElement | null = null;
    let raisedPanel: HTMLElement | null = null;
    let originalZIndex = '';
    const restorePanel = () => {
      if (raisedPanel) raisedPanel.style.zIndex = originalZIndex;
      raisedPanel = null;
    };
    const selector = step === 'replay' || step === 'play'
      ? `[data-panel-kind="controls"] button[data-action="${step}"]` : '[data-panel-kind="typing"]';
    const update = () => {
      if (disposed) return;
      const nextTarget = document.querySelector<HTMLElement>(selector);
      if (nextTarget !== target) {
        restorePanel(); target = nextTarget;
        raisedPanel = target?.closest<HTMLElement>('[data-panel-kind]') ?? null;
        if (raisedPanel) { originalZIndex = raisedPanel.style.zIndex; raisedPanel.style.zIndex = '2147483646'; }
      }
      const bounds = viewport();
      const desiredHeight = Math.max(150, (copyRef.current?.scrollHeight ?? 100) + 80);
      let spot = rectFor(target, bounds);
      let card = spot ? cardPosition(spot, bounds, desiredHeight) : null;
      if (spot && !card && step !== 'replay') {
        // A maximized panel has no outside space: focus its actual keyboard,
        // which keeps the guide separate from the user's input surface.
        const keyboard = target?.querySelector<HTMLElement>('[tabindex="0"]') ?? null;
        const inputSpot = rectFor(keyboard, bounds);
        const inputCard = inputSpot ? cardPosition(inputSpot, bounds, desiredHeight) : null;
        if (inputSpot && inputCard) { spot = inputSpot; card = inputCard; }
      }
      if (!card) {
        card = { left: bounds.left + MARGIN, top: bounds.top + MARGIN,
          width: Math.max(1, Math.min(CARD_WIDTH, bounds.width - MARGIN * 2)),
          height: Math.max(1, Math.min(desiredHeight, bounds.height - MARGIN * 2)) };
        if (!spot || (step !== 'replay' && !cardPosition(spot, bounds, 82))) spot = null;
      }
      const next = { spot, card };
      setLayout(previous => previous && sameRect(previous.spot, next.spot) && sameRect(previous.card, next.card) ? previous : next);
      frame = window.requestAnimationFrame(update);
    };
    // Actual rects follow native resize handles, React drags, nested scroll,
    // mobile visual-viewport changes and targets mounted after video loading.
    update();
    return () => { disposed = true; window.cancelAnimationFrame(frame); restorePanel(); };
  }, [step]);

  if (typeof document === 'undefined' || !document.body) return null;
  const copy = COPY[step];
  const spot = layout?.spot;
  const bounds = viewport();
  const card = layout?.card ?? { left: bounds.left + MARGIN, top: bounds.top + MARGIN,
    width: Math.min(CARD_WIDTH, bounds.width - MARGIN * 2), height: Math.min(190, bounds.height - MARGIN * 2) };
  return createPortal(
    <div data-practice-tutorial={step} style={{ position: 'fixed', inset: 0, zIndex: 2147483647, pointerEvents: 'none' }}>
      {spot ? <div data-tutorial-spotlight={step} aria-hidden="true" style={{
        position: 'fixed', ...spot, borderRadius: 12, border: '2px solid #d8efe5', boxSizing: 'border-box',
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.74), 0 0 20px rgba(216, 239, 229, 0.28)', pointerEvents: 'none',
      }} /> : <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.74)', pointerEvents: 'none' }} />}
      <div className="normalTutorial" role="dialog" aria-label="操作チュートリアル" aria-modal="false" aria-describedby={descriptionId}
        style={{ position: 'fixed', left: card.left, top: card.top, width: card.width, maxHeight: card.height,
          display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box', padding: 16,
          border: '1px solid #709588', borderRadius: 14, background: '#162229', color: '#edf2ef',
          font: '14px/1.5 system-ui, sans-serif', boxShadow: '0 14px 46px rgba(0,0,0,0.5)', pointerEvents: 'auto' }}>
        <div ref={copyRef} aria-live="polite" aria-atomic="true" style={{ minHeight: 0, overflowY: 'auto', flex: '1 1 auto' }}>
          <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#a8d5c2' }}>{copy.number} / 3</p>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, lineHeight: 1.3 }}>{spot ? copy.title : '操作欄を準備しています…'}</h2>
          <p id={descriptionId} style={{ margin: 0 }}>{spot ? copy.text : '操作欄が表示されると案内が続きます。今すぐ自由に練習することもできます。'}</p>
        </div>
        <button type="button" onClick={() => skipRef.current()} style={{ flexShrink: 0, alignSelf: 'flex-start',
          padding: '7px 12px', minHeight: 36, border: '1px solid #a9b7b2', borderRadius: 7, background: 'transparent',
          color: 'inherit', font: 'inherit', cursor: 'pointer' }}>スキップ</button>
      </div>
    </div>, document.body,
  );
}
