import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DebugPanel } from './DebugPanel';
import { DraggablePanel } from './DraggablePanel';
import { SubtitlePanel } from './SubtitlePanel';
import { Hint } from '../legacy-ui/Hint';
import { Window } from '../legacy-ui/TypingPart/Window';
import { mockWords } from '../data/mockData';
import { searchExtensionDictionary } from '../lib/dictionaryClient';
import {
  saveStoredPlaybackPosition,
  saveStoredSubtitle,
  saveStoredTypingProgress,
} from '../lib/storage';
import { emptyCaptionFrame, subtitleCueToCaptionFrame } from '../lib/subtitles';
import { getVideoElement, seekVideo } from '../lib/video';
import type {
  DictionaryWord,
  StoredFrameProgressData,
  StoredTypingProgressData,
  SubtitleCue,
  Tag,
} from '../types';

const LOOP_END_PADDING_SECONDS = 1;
const NEXT_CUE_GUARD_SECONDS = 0.1;

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
  const [loopCue, setLoopCue] = useState<SubtitleCue | null>(null);
  const currentTimeRef = useRef(0);
  const loopRangeRef = useRef<{ start: number; end: number } | null>(null);

  const cache = useMemo(() => {
    return createCache({
      key: 'video-typing',
      container: shadowRoot,
    });
  }, [shadowRoot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const video = getVideoElement(targetId);
      if (!video) {
        setCurrentTime(0);
        setDuration(0);
        return;
      }

      const loopRange = loopRangeRef.current;

      if (loopRange && video.currentTime >= loopRange.end) {
        seekVideo(targetId, loopRange.start);
        setCurrentTime(loopRange.start);
        setDuration(video.duration || 0);
        return;
      }

      setCurrentTime(video.currentTime || 0);
      setDuration(video.duration || 0);
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

  const timelineCue = useMemo(() => {
    return subtitleCues.find((cue) => cue.start <= currentTime && currentTime < cue.end) || null;
  }, [currentTime, subtitleCues]);

  const activeCue = loopCue || timelineCue;

  const activeFrame = useMemo(() => {
    if (activeCue) {
      const frame = subtitleCueToCaptionFrame(activeCue);
      const storedProgress = typingProgress[frame.id];

      return {
        ...frame,
        tags: storedProgress?.tags || [],
      };
    }

    return emptyCaptionFrame();
  }, [activeCue, typingProgress]);

  const activeProgress = useMemo<StoredFrameProgressData>(() => {
    return typingProgress[activeFrame.id] || { finishedCharIds: [], tags: [], updatedAt: undefined };
  }, [activeFrame.id, typingProgress]);

  const isActiveFrameComplete = useMemo(() => {
    const typeableCharCount = activeFrame.caption.filter((char) => char.isTypeable).length;

    return typeableCharCount === 0 || activeProgress.finishedCharIds.length >= typeableCharCount;
  }, [activeFrame.caption, activeProgress.finishedCharIds]);

  useEffect(() => {
    if (!loopCue && timelineCue && !isActiveFrameComplete) {
      setLoopCue(timelineCue);
    }
  }, [isActiveFrameComplete, loopCue, timelineCue]);

  useEffect(() => {
    if (loopCue && isActiveFrameComplete) {
      setLoopCue(null);
    }
  }, [isActiveFrameComplete, loopCue]);

  useEffect(() => {
    if (!activeCue || isActiveFrameComplete) {
      loopRangeRef.current = null;
      return;
    }

    const nextCue = subtitleCues.find((cue) => cue.start > activeCue.start);
    const loopStart = activeCue.start;
    const paddedEnd = activeCue.end + LOOP_END_PADDING_SECONDS;
    const nextCueBoundary = nextCue
      ? Math.max(activeCue.start, nextCue.start - NEXT_CUE_GUARD_SECONDS)
      : Number.POSITIVE_INFINITY;
    const loopEnd = Math.min(paddedEnd, nextCueBoundary);

    loopRangeRef.current = {
      start: loopStart,
      end: loopEnd,
    };
  }, [activeCue, isActiveFrameComplete, subtitleCues]);

  const handleFinishedCharIdsChange = useCallback((finishedCharIds: string[]) => {
    setTypingProgress((state) => {
      const currentFrameProgress = state[activeFrame.id] || { finishedCharIds: [], tags: [], updatedAt: undefined };
      const currentFinishedCharIds = currentFrameProgress.finishedCharIds;

      if (
        currentFinishedCharIds.length === finishedCharIds.length &&
        currentFinishedCharIds.every((charId, index) => charId === finishedCharIds[index])
      ) {
        return state;
      }

      const nextFrameProgress = {
        ...currentFrameProgress,
        finishedCharIds,
        updatedAt: finishedCharIds.length > 0 ? Date.now() : currentFrameProgress.updatedAt,
      };
      const next = {
        ...state,
        [activeFrame.id]: nextFrameProgress,
      };
      void saveStoredTypingProgress(pageUrl, activeFrame.id, nextFrameProgress);
      return next;
    });
  }, [activeFrame.id, pageUrl]);

  const handleFrameInteracted = useCallback(() => {
    setTypingProgress((state) => {
      const currentFrameProgress = state[activeFrame.id] || { finishedCharIds: [], tags: [], updatedAt: undefined };
      const nextFrameProgress = {
        ...currentFrameProgress,
        updatedAt: Date.now(),
      };

      if (currentFrameProgress.updatedAt === nextFrameProgress.updatedAt) {
        return state;
      }

      const next = {
        ...state,
        [activeFrame.id]: nextFrameProgress,
      };
      void saveStoredTypingProgress(pageUrl, activeFrame.id, nextFrameProgress);
      return next;
    });
  }, [activeFrame.id, pageUrl]);

  const handleTagsChange = useCallback((tags: Tag[]) => {
    setTypingProgress((state) => {
      const currentFrameProgress = state[activeFrame.id] || { finishedCharIds: [], tags: [], updatedAt: undefined };

      if (areTagsEqual(currentFrameProgress.tags, tags)) {
        return state;
      }

      const nextFrameProgress = {
        ...currentFrameProgress,
        tags,
      };
      const next = {
        ...state,
        [activeFrame.id]: nextFrameProgress,
      };
      void saveStoredTypingProgress(pageUrl, activeFrame.id, nextFrameProgress);
      return next;
    });
  }, [activeFrame.id, pageUrl]);

  const handleRequestExplanation = useCallback((query: string) => {
    void searchExtensionDictionary(query).then((entries) => {
      const nextWords = entries.length > 0
        ? entries.map((entry) => ({
          title: entry.headword,
          content: entry.body,
        }))
        : [{
          title: query,
          content: 'Dictionary entry was not found.',
        }];

      setHintWords((state) => {
        const existingKeys = new Set(nextWords.map((word) => `${word.title}\u0000${word.content}`));
        const filtered = state.filter((word) => !existingKeys.has(`${word.title}\u0000${word.content}`));
        return [...nextWords, ...filtered].slice(0, 10);
      });
    }).catch(() => {
      setHintWords((state) => {
        const nextWord = {
          title: query,
          content: 'Dictionary search failed.',
        };
        const filtered = state.filter((word) => word.title !== nextWord.title || word.content !== nextWord.content);
        return [nextWord, ...filtered].slice(0, 10);
      });
    });
  }, []);

  return (
    <CacheProvider value={cache}>
      <div style={overlayStyle}>
        <DraggablePanel
          kind="typing"
          title="Typing"
          defaultPosition={{ x: 24, y: 220 }}
          defaultSize={{ width: 760, height: 260 }}
        >
          <Window
            frame={activeFrame}
            initialFinishedCharIds={activeProgress.finishedCharIds}
            sendCompleted={() => {}}
            requestExplanation={handleRequestExplanation}
            sendMistake={() => {}}
            onFrameInteracted={handleFrameInteracted}
            onFinishedCharIdsChange={handleFinishedCharIdsChange}
            onTagsChange={handleTagsChange}
          />
        </DraggablePanel>
        <DraggablePanel
          kind="hint"
          title="Hint"
          defaultPosition={{ x: 700, y: 120 }}
          defaultSize={{ width: 360, height: 400 }}
        >
          <Hint words={hintWords} />
        </DraggablePanel>
        <DraggablePanel
          kind="debug"
          title="Debug"
          defaultPosition={{ x: 24, y: 24 }}
          defaultSize={{ width: 340, height: 260 }}
        >
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
        <DraggablePanel
          kind="subtitle"
          title="Subtitle"
          defaultPosition={{ x: 180, y: 520 }}
          defaultSize={{ width: 520, height: 180 }}
        >
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

function areTagsEqual(left: Tag[], right: Tag[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftTag, index) => {
    const rightTag = right[index];

    return (
      leftTag.id === rightTag.id &&
      leftTag.content === rightTag.content &&
      leftTag.pastedCharIds.length === rightTag.pastedCharIds.length &&
      leftTag.pastedCharIds.every((charId, charIndex) => charId === rightTag.pastedCharIds[charIndex])
    );
  });
}
