import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import React, { useEffect, useMemo, useState } from 'react';
import { DebugPanel } from './DebugPanel';
import { DraggablePanel } from './DraggablePanel';
import { SubtitlePanel } from './SubtitlePanel';
import { Hint } from '../legacy-ui/Hint';
import { Window } from '../legacy-ui/TypingPart/Window';
import { mockWords } from '../data/mockData';
import { saveStoredSubtitle } from '../lib/storage';
import { emptyCaptionFrame, subtitleCueToCaptionFrame } from '../lib/subtitles';
import { getVideoElement } from '../lib/video';
import type { SubtitleCue } from '../types';

interface Props {
  initialSubtitleCues: SubtitleCue[];
  initialSubtitleFileName: string;
  pageUrl: string;
  targetId: string;
  shadowRoot: ShadowRoot;
}

export function OverlayApp({
  initialSubtitleCues,
  initialSubtitleFileName,
  pageUrl,
  shadowRoot,
  targetId,
}: Props) {
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>(initialSubtitleCues);
  const [subtitleFileName, setSubtitleFileName] = useState(initialSubtitleFileName);
  const [subtitleError, setSubtitleError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const cache = useMemo(() => {
    return createCache({
      key: 'video-typing',
      container: shadowRoot,
    });
  }, [shadowRoot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const video = getVideoElement(targetId);
      setCurrentTime(video?.currentTime || 0);
      setDuration(video?.duration || 0);
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [targetId]);

  const activeCue = useMemo(() => {
    return subtitleCues.find((cue) => cue.start <= currentTime && currentTime < cue.end) || null;
  }, [currentTime, subtitleCues]);

  const activeFrame = useMemo(() => {
    if (activeCue) {
      return subtitleCueToCaptionFrame(activeCue);
    }

    return emptyCaptionFrame();
  }, [activeCue]);

  return (
    <CacheProvider value={cache}>
      <div style={overlayStyle}>
        <DraggablePanel kind="typing" title="Typing" defaultPosition={{ x: 24, y: 220 }}>
          <Window
            frame={activeFrame}
            sendCompleted={() => {}}
            requestExplanation={() => {}}
            sendMistake={() => {}}
          />
        </DraggablePanel>
        <DraggablePanel kind="hint" title="Hint" defaultPosition={{ x: 700, y: 120 }}>
          <Hint words={mockWords} />
        </DraggablePanel>
        <DraggablePanel kind="debug" title="Debug" defaultPosition={{ x: 24, y: 24 }}>
          <DebugPanel
            targetId={targetId}
            currentTime={currentTime}
            duration={duration}
            subtitleFileName={subtitleFileName}
            subtitleError={subtitleError}
            onSubtitleLoaded={(cues, fileName) => {
              void saveStoredSubtitle(pageUrl, { cues, fileName });
              setSubtitleCues(cues);
              setSubtitleFileName(fileName);
              setSubtitleError('');
            }}
            onSubtitleError={(message) => {
              setSubtitleCues([]);
              setSubtitleFileName('');
              setSubtitleError(message);
            }}
          />
        </DraggablePanel>
        <DraggablePanel kind="subtitle" title="Subtitle" defaultPosition={{ x: 180, y: 520 }}>
          <SubtitlePanel
            cueText={activeCue?.text || ''}
            fileName={subtitleFileName}
          />
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
