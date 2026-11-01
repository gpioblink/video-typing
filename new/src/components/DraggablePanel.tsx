import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  loadPanelPosition,
  loadPanelSize,
  savePanelPosition,
  savePanelSize,
} from '../lib/storage';
import type { PanelKind, PanelPosition, PanelSize } from '../types';
import { clampPanelGeometry } from '../lib/practiceLayout';

interface Props {
  kind: PanelKind;
  title: string;
  defaultPosition: PanelPosition;
  defaultSize: PanelSize;
  titleBackground?: string;
  minimizable?: boolean;
  defaultMinimized?: boolean;
  storageScope?: string;
  layoutRevision?: number;
  minimumSize?: PanelSize;
  onClose?: () => void;
  reveal?: boolean;
  children: React.ReactNode;
}

const DEFAULT_MINIMUM = { width: 240, height: 160 };

// Different panels share a stored map. Serialize their read/modify/write saves
// so a layout reset cannot discard another panel's position in the same UI.
let panelWrites: Promise<unknown> = Promise.resolve();
function persistPanel(scope: string, kind: PanelKind, position: PanelPosition, size?: PanelSize) {
  const next = panelWrites.catch(() => undefined).then(async () => {
    if (size) await savePanelSize(scope, kind, size);
    await savePanelPosition(scope, kind, position);
  });
  panelWrites = next;
  void next.catch(() => undefined);
}

export function DraggablePanel({
  kind,
  title,
  defaultPosition,
  defaultSize,
  titleBackground = '#162229',
  minimizable = false,
  defaultMinimized = false,
  storageScope,
  layoutRevision = 0,
  minimumSize = DEFAULT_MINIMUM,
  onClose,
  reveal = false,
  children,
}: Props) {
  const scope = storageScope ?? window.location.hostname;
  const initial = useRef(clampPanelGeometry(defaultPosition, defaultSize, minimumSize, window.innerWidth, window.innerHeight, minimizable && defaultMinimized));
  const [position, setPosition] = useState(initial.current.position);
  const [size, setSize] = useState(initial.current.size);
  const [isMinimized, setIsMinimized] = useState(defaultMinimized);
  const minimized = minimizable && isMinimized;
  const minimizedRef = useRef(minimized);
  minimizedRef.current = minimized;
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef(size);
  const positionRef = useRef(position);

  const minimumRef = useRef(minimumSize);
  minimumRef.current = minimumSize;
  const loadRevisionRef = useRef(0);
  const previousLayout = useRef({ scope, revision: layoutRevision });
  const fit = (nextPosition: PanelPosition, nextSize = sizeRef.current, collapsed = minimizedRef.current) => (
    clampPanelGeometry(nextPosition, nextSize, minimumRef.current, window.innerWidth, window.innerHeight, collapsed)
  );
  const apply = (next: ReturnType<typeof clampPanelGeometry>) => {
    positionRef.current = next.position;
    sizeRef.current = next.size;
    setPosition(next.position);
    setSize(next.size);
  };

  useLayoutEffect(() => {
    let active = true;
    const generation = ++loadRevisionRef.current;
    const reset = previousLayout.current.revision !== layoutRevision;
    const changedScope = previousLayout.current.scope !== scope;
    previousLayout.current = { scope, revision: layoutRevision };
    const defaults = fit(defaultPosition, defaultSize, minimizable && defaultMinimized);
    if (reset || changedScope) {
      setIsMinimized(defaultMinimized);
      apply(defaults);
    }
    if (reset) {
      persistPanel(scope, kind, defaults.position, defaults.size);
    } else {
      void panelWrites.catch(() => undefined).then(() => Promise.all([
        loadPanelPosition(scope, kind), loadPanelSize(scope, kind),
      ])).then(([savedPosition, savedSize]) => {
        if (!active || generation !== loadRevisionRef.current) return;
        apply(fit(savedPosition || defaultPosition, savedSize || defaultSize));
      }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [scope, kind, layoutRevision]);

  useLayoutEffect(() => {
    if (!reveal) return;
    setIsMinimized(false);
    apply(fit(positionRef.current, sizeRef.current, false));
  }, [reveal]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!dragRef.current) return;
      apply(fit({
        x: dragRef.current.startX + event.clientX - dragRef.current.x,
        y: dragRef.current.startY + event.clientY - dragRef.current.y,
      }));
    };

    const onMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      persistPanel(scope, kind, positionRef.current);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [scope, kind]);

  useEffect(() => {
    const panelElement = panelRef.current;

    if (!panelElement || minimized) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry || minimizedRef.current
        || previousLayout.current.scope !== scope
        || previousLayout.current.revision !== layoutRevision) return;

      // An entry may have been queued before a responsive layout reset. Read
      // the currently committed box; never restore the entry's older size.
      const box = panelElement.getBoundingClientRect();
      const next = fit(positionRef.current, {
        width: Math.round(box.width),
        height: Math.round(box.height),
      });
      if (next.size.width === sizeRef.current.width && next.size.height === sizeRef.current.height
        && next.position.x === positionRef.current.x && next.position.y === positionRef.current.y) return;
      loadRevisionRef.current += 1;
      apply(next);
      persistPanel(scope, kind, next.position, next.size);
    });

    resizeObserver.observe(panelElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [scope, kind, minimized, layoutRevision]);

  useEffect(() => {
    const onWindowResize = () => {
      loadRevisionRef.current += 1;
      const next = fit(positionRef.current);
      apply(next);
      persistPanel(scope, kind, next.position, next.size);
    };

    window.addEventListener('resize', onWindowResize);

    return () => {
      window.removeEventListener('resize', onWindowResize);
    };
  }, [scope, kind]);

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label={title}
      data-panel-kind={kind}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        pointerEvents: 'auto',
        width: size.width,
        height: minimized ? 40 : size.height,
        minWidth: Math.min(minimumSize.width, Math.max(1, window.innerWidth - 16)),
        minHeight: minimized ? 0 : Math.min(minimumSize.height, Math.max(1, window.innerHeight - 16)),
        background: '#24353d',
        color: '#ecf2f1',
        borderRadius: '14px',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.35)',
        overflow: 'hidden',
        resize: minimized ? 'none' : 'both',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        onMouseDown={(event) => {
          loadRevisionRef.current += 1;
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            startX: position.x,
            startY: position.y,
          };
        }}
        style={{
          cursor: 'move',
          padding: '10px 12px',
          fontSize: '13px',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          background: titleBackground,
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <span>{title}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {minimizable ? <button
          type="button"
          aria-label={`${title}を${minimized ? '開く' : '折りたたむ'}`}
          aria-expanded={!minimized}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => {
            loadRevisionRef.current += 1;
            const next = fit(positionRef.current, sizeRef.current, !minimized);
            setIsMinimized(value => !value);
            apply(next);
            persistPanel(scope, kind, next.position);
          }}
          style={{
            appearance: 'none', border: '1px solid rgba(236, 242, 241, 0.25)',
            borderRadius: '4px', background: 'transparent', color: 'inherit',
            padding: '0 6px', font: 'inherit', cursor: 'pointer', lineHeight: '18px',
          }}
        >{minimized ? '+' : '−'}</button> : null}
        {onClose && <button type="button" aria-label={`${title}を閉じる`} onMouseDown={event => event.stopPropagation()} onClick={onClose}
          style={{ border: 0, background: 'transparent', color: 'inherit', fontSize: 20, padding: '0 4px', lineHeight: '20px', cursor: 'pointer' }}>×</button>}
        </span>
      </div>
      <div
        hidden={minimized}
        style={{
          padding: kind === 'typing' ? '16px 18px' : '12px',
          overflow: 'auto',
          flex: 1,
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
