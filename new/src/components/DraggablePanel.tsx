import React, { useEffect, useRef, useState } from 'react';
import { loadPanelPosition, savePanelPosition } from '../lib/storage';
import type { PanelKind, PanelPosition } from '../types';

interface Props {
  kind: PanelKind;
  title: string;
  defaultPosition: PanelPosition;
  children: React.ReactNode;
}

export function DraggablePanel({ kind, title, defaultPosition, children }: Props) {
  const hostname = window.location.hostname;
  const [position, setPosition] = useState(defaultPosition);
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  const clampPosition = (next: PanelPosition) => ({
    x: Math.max(0, Math.min(next.x, window.innerWidth - 120)),
    y: Math.max(0, Math.min(next.y, window.innerHeight - 80)),
  });

  useEffect(() => {
    loadPanelPosition(hostname, kind).then((saved) => {
      if (saved) {
        setPosition(clampPosition(saved));
      }
    });
  }, [hostname, kind]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!dragRef.current) return;
      setPosition(clampPosition({
        x: Math.max(0, dragRef.current.startX + event.clientX - dragRef.current.x),
        y: Math.max(0, dragRef.current.startY + event.clientY - dragRef.current.y),
      }));
    };

    const onMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      void savePanelPosition(hostname, kind, position);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [hostname, kind, position]);

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        pointerEvents: 'auto',
        minWidth: '240px',
        background: '#24353d',
        color: '#ecf2f1',
        borderRadius: '14px',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.35)',
        overflow: 'hidden',
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
          background: '#162229',
          userSelect: 'none',
        }}
      >
        {title}
      </div>
      <div style={{ padding: kind === 'typing' ? '16px 18px' : '12px' }}>{children}</div>
    </div>
  );
}
