import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DebugPanel } from './DebugPanel';
import { DraggablePanel } from './DraggablePanel';
import { SubtitlePanel } from './SubtitlePanel';
import { Hint } from '../legacy-ui/Hint';
import { Window } from '../legacy-ui/TypingPart/Window';
import { searchExtensionChineseDictionary, searchExtensionDictionary } from '../lib/dictionaryClient';
import {
  saveStoredPlaybackPosition,
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
const SLOW_PLAYBACK_MISTAKE_THRESHOLD = 5;
const SLOW_PLAYBACK_RATE = 0.5;

interface Props {
  initialSubtitleCues: SubtitleCue[];
  initialSubtitleFileName: string;
  initialTypingProgress: StoredTypingProgressData;
  initialTypingFrames?: TimedCaptionFrame[];
  displaySubtitleCues?: SubtitleCue[];
  displaySubtitleFileName?: string;
  showDebugPanel?: boolean;
  onFrameMistake?: (cue: SubtitleCue, mistakeCount: number) => Promise<void> | void;
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
  const subtitleCues = initialSubtitleCues;
  const subtitleFileName = initialSubtitleFileName;
  const typingFrames = initialTypingFrames;
  const [typingProgress, setTypingProgress] = useState<StoredTypingProgressData>(initialTypingProgress);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hintWords, setHintWords] = useState<DictionaryWord[]>([]);
  const [loopCue, setLoopCue] = useState<SubtitleCue | null>(null);
  const [isMistakeReasonPromptOpen, setIsMistakeReasonPromptOpen] = useState(false);
  const currentTimeRef = useRef(0);
  const loopRangeRef = useRef<{ start: number; end: number } | null>(null);
  const mistakeCountsRef = useRef<Record<string, number>>({});
  const activeFrameIdRef = useRef('');
  const nativeReplayCountRef = useRef(0);
  const controlledPlaybackRateRef = useRef<{
    frameId: string;
    loopIndex: number;
  } | null>(null);
  const shouldResumeAfterMistakeReasonRef = useRef(false);

  const cache = useMemo(() => {
    return createCache({
      key: 'video-typing',
      container: shadowRoot,
    });
  }, [shadowRoot]);

  const restoreControlledPlaybackRate = useCallback((video = getVideoElement(targetId)) => {
    if (!video) {
      controlledPlaybackRateRef.current = null;
      return;
    }

    if (nativeReplayCountRef.current > 0) {
      video.playbackRate = 1;
      controlledPlaybackRateRef.current = null;
      return;
    }

    video.playbackRate = 1;
    controlledPlaybackRateRef.current = null;
  }, [targetId]);

  const applyMistakeSensitivePlaybackRate = useCallback((
    frameId: string,
    mistakeCount: number,
    options?: { advanceLoop?: boolean },
  ) => {
    const video = getVideoElement(targetId);

    if (!video) {
      return;
    }

    if (nativeReplayCountRef.current > 0) {
      video.playbackRate = 1;
      return;
    }

    if (mistakeCount < SLOW_PLAYBACK_MISTAKE_THRESHOLD) {
      if (controlledPlaybackRateRef.current) {
        restoreControlledPlaybackRate(video);
      } else {
        video.playbackRate = 1;
      }
      return;
    }

    if (controlledPlaybackRateRef.current?.frameId !== frameId) {
      restoreControlledPlaybackRate(video);
      controlledPlaybackRateRef.current = {
        frameId,
        loopIndex: 0,
      };
    } else if (options?.advanceLoop) {
      controlledPlaybackRateRef.current.loopIndex += 1;
    }

    const controlledPlaybackRate = controlledPlaybackRateRef.current;

    if (!controlledPlaybackRate) {
      return;
    }

    video.playbackRate = controlledPlaybackRate.loopIndex % 2 === 0
      ? SLOW_PLAYBACK_RATE
      : 1;
  }, [restoreControlledPlaybackRate, targetId]);

  const trackNativeReplay = useCallback((replay: Promise<void> | void) => {
    if (!replay) {
      return;
    }

    nativeReplayCountRef.current += 1;
    void replay
      .catch(() => undefined)
      .finally(() => {
        nativeReplayCountRef.current = Math.max(0, nativeReplayCountRef.current - 1);

        if (nativeReplayCountRef.current > 0) {
          return;
        }

        const frameId = activeFrameIdRef.current;

        if (frameId && loopRangeRef.current) {
          applyMistakeSensitivePlaybackRate(frameId, mistakeCountsRef.current[frameId] || 0);
        } else {
          restoreControlledPlaybackRate();
        }
      });
  }, [applyMistakeSensitivePlaybackRate, restoreControlledPlaybackRate]);

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
        const frameId = activeFrameIdRef.current;
        const mistakeCount = frameId ? mistakeCountsRef.current[frameId] || 0 : 0;
        if (frameId) {
          applyMistakeSensitivePlaybackRate(frameId, mistakeCount, { advanceLoop: true });
        }
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
  }, [applyMistakeSensitivePlaybackRate, targetId]);

  useEffect(() => {
    return () => {
      restoreControlledPlaybackRate();
    };
  }, [restoreControlledPlaybackRate]);

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

  const isTypingCueActive = useMemo(() => {
    if (!activeCue) {
      return false;
    }

    return activeCue.start <= currentTime && currentTime < activeCue.end;
  }, [activeCue, currentTime]);

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

  useEffect(() => {
    activeFrameIdRef.current = activeFrame.id;
  }, [activeFrame.id]);

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
    if (loopCue && isActiveFrameComplete && !isMistakeReasonPromptOpen) {
      setLoopCue(null);
    }
  }, [isActiveFrameComplete, isMistakeReasonPromptOpen, loopCue]);

  useEffect(() => {
    if (!activeCue || (isActiveFrameComplete && !isMistakeReasonPromptOpen)) {
      loopRangeRef.current = null;
      restoreControlledPlaybackRate();
      return;
    }

    const loopStart = Math.max(0, activeCue.start - LOOP_START_PADDING_SECONDS);
    const loopEnd = activeCue.end + LOOP_END_PADDING_SECONDS;

    loopRangeRef.current = {
      start: loopStart,
      end: loopEnd,
    };
    applyMistakeSensitivePlaybackRate(activeFrame.id, mistakeCountsRef.current[activeFrame.id] || 0);
  }, [
    activeCue,
    activeFrame.id,
    applyMistakeSensitivePlaybackRate,
    isActiveFrameComplete,
    isMistakeReasonPromptOpen,
    restoreControlledPlaybackRate,
    subtitleCues,
  ]);

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
    applyMistakeSensitivePlaybackRate(activeFrame.id, nextCount);
    trackNativeReplay(onFrameMistake?.(activeCue, nextCount));
  }, [activeCue, activeFrame.id, applyMistakeSensitivePlaybackRate, onFrameMistake, trackNativeReplay]);

  const handleFrameCompleted = useCallback(() => {
    if (!activeCue) {
      return;
    }

    trackNativeReplay(onFrameCompleted?.(activeCue));
  }, [activeCue, onFrameCompleted, trackNativeReplay]);

  const handleMistakeReasonPromptOpen = useCallback(() => {
    setIsMistakeReasonPromptOpen(true);
    const video = getVideoElement(targetId);

    if (!video) {
      shouldResumeAfterMistakeReasonRef.current = false;
      return;
    }

    shouldResumeAfterMistakeReasonRef.current = !video.paused;
    video.pause();
  }, [targetId]);

  const handleMistakeReasonPromptClose = useCallback(() => {
    setIsMistakeReasonPromptOpen(false);
    const video = getVideoElement(targetId);
    const shouldResume = shouldResumeAfterMistakeReasonRef.current;

    shouldResumeAfterMistakeReasonRef.current = false;

    if (!video || !shouldResume) {
      return;
    }

    void video.play().catch(() => undefined);
  }, [targetId]);

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

  const stopOverlayKeyboardEventPropagation = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
  }, []);

  const handleRequestExplanation = useCallback((
    query: string,
    options?: { silentIfMissing?: boolean; sourceText?: string },
  ) => {
    const isChineseTypingMode = Boolean(typingFrames?.length);
    const displayQuery = isChineseTypingMode ? options?.sourceText || query : query;

    if (isChineseTypingMode) {
      void searchExtensionChineseDictionary(displayQuery, activeCue?.text || '').then((entries) => {
        if (entries.length === 0 && options?.silentIfMissing) {
          return;
        }

        const nextWords: DictionaryWord[] = entries.length > 0
          ? entries.map((entry) => ({
            title: entry.headword,
            content: entry.body,
            dictionaryEntryKey: entry.key,
          }))
          : [{
            title: displayQuery,
            content: 'Dictionary entry was not found.',
          }];

        setHintWords((state) => mergeHintWords(state, nextWords));
      }).catch(() => {
        if (options?.silentIfMissing) {
          return;
        }

        setHintWords((state) => mergeHintWords(state, [{
          title: displayQuery,
          content: 'Dictionary search failed.',
        }]));
      });

      return;
    }

    void searchExtensionDictionary(query, activeCue?.text || '').then((entries) => {
      if (entries.length === 0 && options?.silentIfMissing) {
        return;
      }

      const nextWords: DictionaryWord[] = entries.length > 0
        ? entries.map((entry) => ({
          title: entry.headword,
          content: entry.body,
          dictionaryEntryKey: entry.key,
        }))
        : [{
          title: displayQuery,
          content: 'Dictionary entry was not found.',
        }];

      setHintWords((state) => mergeHintWords(state, nextWords));
    }).catch(() => {
      if (options?.silentIfMissing) {
        return;
      }

      setHintWords((state) => mergeHintWords(state, [{
          title: displayQuery,
          content: 'Dictionary search failed.',
        }]));
    });
  }, [activeCue?.text, typingFrames?.length]);

  return (
    <CacheProvider value={cache}>
      <div
        style={overlayStyle}
        onKeyDown={stopOverlayKeyboardEventPropagation}
        onKeyUp={stopOverlayKeyboardEventPropagation}
        onKeyPress={stopOverlayKeyboardEventPropagation}
      >
        <DraggablePanel
          kind="typing"
          title="Typing"
          defaultPosition={{ x: 24, y: 220 }}
          defaultSize={{ width: 760, height: 260 }}
          titleBackground={isTypingCueActive ? '#1f7a3a' : '#162229'}
        >
          <Window
            frame={activeFrame}
            initialFinishedCharIds={activeProgress.finishedCharIds}
            sendCompleted={handleFrameCompleted}
            requestExplanation={handleRequestExplanation}
            onMistakeInput={handleMistakeInput}
            onMistakeReasonPromptOpen={handleMistakeReasonPromptOpen}
            onMistakeReasonPromptClose={handleMistakeReasonPromptClose}
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

function mergeHintWords(state: DictionaryWord[], nextWords: DictionaryWord[]) {
  const existingKeys = new Set(nextWords.map((word) => `${word.title}\u0000${word.content}`));
  const existingEntryKeys = new Set(nextWords.flatMap((word) => (
    word.dictionaryEntryKey ? [word.dictionaryEntryKey] : []
  )));
  const filtered = state.filter((word) => (
    !existingKeys.has(`${word.title}\u0000${word.content}`) &&
    !(word.dictionaryEntryKey && existingEntryKeys.has(word.dictionaryEntryKey))
  ));

  return [...nextWords, ...filtered].slice(0, 10);
}

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
