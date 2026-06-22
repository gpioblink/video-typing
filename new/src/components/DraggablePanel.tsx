import React, { useEffect, useRef, useState } from 'react';
import {
  loadPanelPosition,
  loadPanelSize,
  savePanelPosition,
  savePanelSize,
} from '../lib/storage';
import type { PanelKind, PanelPosition, PanelSize } from '../types';

interface Props {
  kind: PanelKind;
  title: string;
  defaultPosition: PanelPosition;
  defaultSize: PanelSize;
  titleBackground?: string;
  children: React.ReactNode;
}

const MIN_PANEL_WIDTH = 240;
const MIN_PANEL_HEIGHT = 160;

export function DraggablePanel({
  kind,
  title,
  defaultPosition,
  defaultSize,
  titleBackground = '#162229',
  children,
}: Props) {
  const hostname = window.location.hostname;
  const [position, setPosition] = useState(defaultPosition);
  const [size, setSize] = useState(defaultSize);
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef(size);
  const positionRef = useRef(position);

  const clampSize = (next: PanelSize) => ({
    width: Math.max(MIN_PANEL_WIDTH, Math.min(next.width, window.innerWidth - 16)),
    height: Math.max(MIN_PANEL_HEIGHT, Math.min(next.height, window.innerHeight - 16)),
  });

  const clampPosition = (next: PanelPosition, nextSize = sizeRef.current) => ({
    x: Math.max(0, Math.min(next.x, window.innerWidth - nextSize.width)),
    y: Math.max(0, Math.min(next.y, window.innerHeight - nextSize.height)),
  });

  useEffect(() => {
    loadPanelPosition(hostname, kind).then((saved) => {
      if (saved) {
        const nextPosition = clampPosition(saved);
        positionRef.current = nextPosition;
        setPosition(nextPosition);
      }
    });
    loadPanelSize(hostname, kind).then((saved) => {
      if (saved) {
        const nextSize = clampSize(saved);
        sizeRef.current = nextSize;
        setSize(nextSize);
        const nextPosition = clampPosition(positionRef.current, nextSize);
        positionRef.current = nextPosition;
        setPosition(nextPosition);
      }
    });
  }, [hostname, kind]);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!dragRef.current) return;
      const nextPosition = clampPosition({
        x: Math.max(0, dragRef.current.startX + event.clientX - dragRef.current.x),
        y: Math.max(0, dragRef.current.startY + event.clientY - dragRef.current.y),
      });
      positionRef.current = nextPosition;
      setPosition(nextPosition);
    };

    const onMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      void savePanelPosition(hostname, kind, positionRef.current);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [hostname, kind]);

  useEffect(() => {
    const panelElement = panelRef.current;

    if (!panelElement) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

      const nextSize = clampSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });

      if (nextSize.width === sizeRef.current.width && nextSize.height === sizeRef.current.height) {
        return;
      }

      sizeRef.current = nextSize;
      setSize(nextSize);

      const nextPosition = clampPosition(positionRef.current, nextSize);
      positionRef.current = nextPosition;
      setPosition(nextPosition);

      void savePanelSize(hostname, kind, nextSize);
      void savePanelPosition(hostname, kind, nextPosition);
    });

    resizeObserver.observe(panelElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [hostname, kind]);

  useEffect(() => {
    const onWindowResize = () => {
      const nextSize = clampSize(sizeRef.current);
      const nextPosition = clampPosition(positionRef.current, nextSize);

      sizeRef.current = nextSize;
      positionRef.current = nextPosition;
      setSize(nextSize);
      setPosition(nextPosition);
    };

    window.addEventListener('resize', onWindowResize);

    return () => {
      window.removeEventListener('resize', onWindowResize);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        pointerEvents: 'auto',
        width: size.width,
        height: size.height,
        minWidth: `${MIN_PANEL_WIDTH}px`,
        minHeight: `${MIN_PANEL_HEIGHT}px`,
        background: '#24353d',
        color: '#ecf2f1',
        borderRadius: '14px',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.35)',
        overflow: 'hidden',
        resize: 'both',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        onMouseDown={(event) => {
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
        }}
      >
        {title}
      </div>
      <div
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
