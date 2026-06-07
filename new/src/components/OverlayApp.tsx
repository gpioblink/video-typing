import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import React, { useMemo } from 'react';
import { DebugPanel } from './DebugPanel';
import { DraggablePanel } from './DraggablePanel';
import { Hint } from '../legacy-ui/Hint';
import { Window } from '../legacy-ui/TypingPart/Window';
import { mockFrame, mockWords } from '../data/mockData';

interface Props {
  targetId: string;
  shadowRoot: ShadowRoot;
}

export function OverlayApp({ shadowRoot, targetId }: Props) {
  const cache = useMemo(() => {
    return createCache({
      key: 'video-typing',
      container: shadowRoot,
    });
  }, [shadowRoot]);

  return (
    <CacheProvider value={cache}>
      <div style={overlayStyle}>
        <DraggablePanel kind="typing" title="Typing" defaultPosition={{ x: 24, y: 220 }}>
          <Window
            frame={mockFrame}
            sendCompleted={() => {}}
            requestExplanation={() => {}}
            sendMistake={() => {}}
          />
        </DraggablePanel>
        <DraggablePanel kind="hint" title="Hint" defaultPosition={{ x: 700, y: 120 }}>
          <Hint words={mockWords} />
        </DraggablePanel>
        <DraggablePanel kind="debug" title="Debug" defaultPosition={{ x: 24, y: 24 }}>
          <DebugPanel targetId={targetId} />
        </DraggablePanel>
      </div>
    </CacheProvider>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2147483646,
  pointerEvents: 'none',
};
