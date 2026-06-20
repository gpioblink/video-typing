import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DebugPanel } from './DebugPanel';
import { DraggablePanel } from './DraggablePanel';
import { SubtitlePanel } from './SubtitlePanel';
import { Hint } from '../legacy-ui/Hint';
import { Window } from '../legacy-ui/TypingPart/Window';
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
  TimedCaptionFrame,
} from '../types';

const LOOP_START_PADDING_SECONDS = 1;
const LOOP_END_PADDING_SECONDS = 1;

interface Props {
  initialSubtitleCues: SubtitleCue[];
  initialSubtitleFileName: string;
  initialTypingProgress: StoredTypingProgressData;
  initialTypingFrames?: TimedCaptionFrame[];
  displaySubtitleCues?: SubtitleCue[];
  displaySubtitleFileName?: string;
  showDebugPanel?: boolean;
  onFrameMistake?: (cue: SubtitleCue, mistakeCount: number) => void;
  onFrameCompleted?: (cue: SubtitleCue) => Promise<void> | void;
  pageUrl: string;
  targetId: string;
  shadowRoot: Node;
}

export function OverlayApp({
  initialSubtitleCues,
  initialSubtitleFileName,
  initialTypingProgress,
  initialTypingFrames,
  displaySubtitleCues,
  displaySubtitleFileName,
  showDebugPanel = true,
  onFrameMistake,
  onFrameCompleted,
  pageUrl,
  shadowRoot,
  targetId,
}: Props) {
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>(initialSubtitleCues);
  const [subtitleFileName, setSubtitleFileName] = useState(initialSubtitleFileName);
  const [typingFrames, setTypingFrames] = useState<TimedCaptionFrame[] | undefined>(initialTypingFrames);
  const [typingProgress, setTypingProgress] = useState<StoredTypingProgressData>(initialTypingProgress);
  const [subtitleError, setSubtitleError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hintWords, setHintWords] = useState<DictionaryWord[]>([]);
  const [loopCue, setLoopCue] = useState<SubtitleCue | null>(null);
  const currentTimeRef = useRef(0);
  const loopRangeRef = useRef<{ start: number; end: number } | null>(null);
  const mistakeCountsRef = useRef<Record<string, number>>({});

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

  // Keep showing the cue currently being typed even while playback moves
  // into the padded pre/post-roll area around that cue.
  const activeCue = loopCue || timelineCue;

  const displayCue = useMemo(() => {
    if (!activeCue || !displaySubtitleCues?.length) {
      return activeCue;
    }

    const cueTime = (activeCue.start + activeCue.end) / 2;
    return displaySubtitleCues.find((cue) => cue.start <= cueTime && cueTime < cue.end) || activeCue;
  }, [activeCue, displaySubtitleCues]);

  const activeTypingFrame = useMemo(() => {
    if (!activeCue || !typingFrames?.length) {
      return null;
    }

    const cueTime = (activeCue.start + activeCue.end) / 2;
    return typingFrames.find((frame) => (
      frame.start === activeCue.start &&
      frame.end === activeCue.end
    )) || typingFrames.find((frame) => (
      frame.start <= cueTime && cueTime < frame.end
    )) || null;
  }, [activeCue, typingFrames]);

  const activeFrame = useMemo(() => {
    if (activeTypingFrame) {
      const storedProgress = typingProgress[activeTypingFrame.id];

      return {
        ...activeTypingFrame,
        tags: storedProgress?.tags || activeTypingFrame.tags || [],
      };
    }

    if (activeCue) {
      const frame = subtitleCueToCaptionFrame(activeCue);
      const storedProgress = typingProgress[frame.id];

      return {
        ...frame,
        tags: storedProgress?.tags || [],
      };
    }

    return emptyCaptionFrame();
  }, [activeCue, activeTypingFrame, typingProgress]);

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

    const loopStart = Math.max(0, activeCue.start - LOOP_START_PADDING_SECONDS);
    const loopEnd = activeCue.end + LOOP_END_PADDING_SECONDS;

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

  const handleMistakeInput = useCallback(() => {
    if (!activeCue) {
      return;
    }

    const nextCount = (mistakeCountsRef.current[activeFrame.id] || 0) + 1;
    mistakeCountsRef.current = {
      ...mistakeCountsRef.current,
      [activeFrame.id]: nextCount,
    };
    onFrameMistake?.(activeCue, nextCount);
  }, [activeCue, activeFrame.id, onFrameMistake]);

  const handleFrameCompleted = useCallback(() => {
    if (!activeCue) {
      return;
    }

    void onFrameCompleted?.(activeCue);
  }, [activeCue, onFrameCompleted]);

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

  const handleRequestExplanation = useCallback((query: string, options?: { silentIfMissing?: boolean }) => {
    void searchExtensionDictionary(query).then((entries) => {
      if (entries.length === 0 && options?.silentIfMissing) {
        return;
      }

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
      if (options?.silentIfMissing) {
        return;
      }

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
            sendCompleted={handleFrameCompleted}
            requestExplanation={handleRequestExplanation}
            sendMistake={() => {}}
            onMistakeInput={handleMistakeInput}
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
        {showDebugPanel ? (
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
              onSubtitleLoaded={(cues, fileName, nextTypingFrames) => {
                void saveStoredSubtitle(
                  pageUrl,
                  nextTypingFrames ? { cues, fileName, typingFrames: nextTypingFrames } : { cues, fileName },
                );
                setSubtitleCues(cues);
                setTypingFrames(nextTypingFrames);
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
        ) : null}
        <DraggablePanel
          kind="subtitle"
          title="Subtitle"
          defaultPosition={{ x: 180, y: 520 }}
          defaultSize={{ width: 520, height: 180 }}
        >
          <SubtitlePanel
            cueText={displayCue?.text || ''}
            fileName={displaySubtitleFileName || subtitleFileName}
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
