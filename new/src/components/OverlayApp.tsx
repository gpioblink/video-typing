import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DebugPanel } from './DebugPanel';
import { DraggablePanel } from './DraggablePanel';
import { SubtitlePanel } from './SubtitlePanel';
import { Hint } from '../legacy-ui/Hint';
import { Window } from '../legacy-ui/TypingPart/Window';
import { mockWords } from '../data/mockData';
import {
  saveStoredPlaybackPosition,
  saveStoredSubtitle,
  saveStoredTypingProgress,
} from '../lib/storage';
import { emptyCaptionFrame, subtitleCueToCaptionFrame } from '../lib/subtitles';
import { getVideoElement } from '../lib/video';
import type { DictionaryWord, StoredTypingProgressData, SubtitleCue, TagContent } from '../types';

interface Props {
  initialSubtitleCues: SubtitleCue[];
  initialSubtitleFileName: string;
  initialTypingProgress: StoredTypingProgressData;
  pageUrl: string;
  targetId: string;
  shadowRoot: ShadowRoot;
}

export function OverlayApp({
  initialSubtitleCues,
  initialSubtitleFileName,
  initialTypingProgress,
  pageUrl,
  shadowRoot,
  targetId,
}: Props) {
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>(initialSubtitleCues);
  const [subtitleFileName, setSubtitleFileName] = useState(initialSubtitleFileName);
  const [typingProgress, setTypingProgress] = useState<StoredTypingProgressData>(initialTypingProgress);
  const [subtitleError, setSubtitleError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hintWords, setHintWords] = useState<DictionaryWord[]>(mockWords);
  const [latestMistakeReason, setLatestMistakeReason] = useState<TagContent | null>(null);
  const [latestMistakeQuery, setLatestMistakeQuery] = useState('');
  const currentTimeRef = useRef(0);

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

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    const persistPlaybackPosition = () => {
      void saveStoredPlaybackPosition(pageUrl, currentTimeRef.current);
    };

    window.addEventListener('pagehide', persistPlaybackPosition);

    return () => {
      window.removeEventListener('pagehide', persistPlaybackPosition);
      persistPlaybackPosition();
    };
  }, [pageUrl]);

  const activeCue = useMemo(() => {
    return subtitleCues.find((cue) => cue.start <= currentTime && currentTime < cue.end) || null;
  }, [currentTime, subtitleCues]);

  const activeFrame = useMemo(() => {
    if (activeCue) {
      return subtitleCueToCaptionFrame(activeCue);
    }

    return emptyCaptionFrame();
  }, [activeCue]);

  const activeFinishedCharIds = useMemo(() => {
    return typingProgress[activeFrame.id] || [];
  }, [activeFrame.id, typingProgress]);

  const handleFinishedCharIdsChange = useCallback((finishedCharIds: string[]) => {
    setTypingProgress((state) => {
      const currentFinishedCharIds = state[activeFrame.id] || [];

      if (
        currentFinishedCharIds.length === finishedCharIds.length &&
        currentFinishedCharIds.every((charId, index) => charId === finishedCharIds[index])
      ) {
        return state;
      }

      const next = {
        ...state,
        [activeFrame.id]: finishedCharIds,
      };
      void saveStoredTypingProgress(pageUrl, activeFrame.id, finishedCharIds);
      return next;
    });
  }, [activeFrame.id, pageUrl]);

  const handleRequestExplanation = useCallback((query: string) => {
    setLatestMistakeQuery(query);
    setHintWords((state) => {
      const nextWord = {
        title: query,
        content: 'Matched subtitle text. Dictionary lookup is not connected in the overlay yet.',
      };
      const filtered = state.filter((word) => word.title !== query);
      return [nextWord, ...filtered].slice(0, 10);
    });
  }, []);

  const handleMistake = useCallback((reason: TagContent) => {
    setLatestMistakeReason(reason);
  }, []);

  return (
    <CacheProvider value={cache}>
      <div style={overlayStyle}>
        <DraggablePanel kind="typing" title="Typing" defaultPosition={{ x: 24, y: 220 }}>
          <Window
            frame={activeFrame}
            initialFinishedCharIds={activeFinishedCharIds}
            sendCompleted={() => {}}
            requestExplanation={handleRequestExplanation}
            sendMistake={handleMistake}
            onFinishedCharIdsChange={handleFinishedCharIdsChange}
          />
        </DraggablePanel>
        <DraggablePanel kind="hint" title="Hint" defaultPosition={{ x: 700, y: 120 }}>
          <Hint
            latestMistakeReason={latestMistakeReason}
            latestQuery={latestMistakeQuery}
            words={hintWords}
          />
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
