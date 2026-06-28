import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConfigPanel } from './ConfigPanel';
import { DraggablePanel } from './DraggablePanel';
import { SubtitlePanel } from './SubtitlePanel';
import { Hint } from '../legacy-ui/Hint';
import { Window } from '../legacy-ui/TypingPart/Window';
import { searchExtensionChineseDictionary, searchExtensionDictionary } from '../lib/dictionaryClient';
import {
  deleteStoredFrameTypingProgress,
  DEFAULT_OVERLAY_CONFIG,
  loadOverlayConfig,
  saveStoredPlaybackPosition,
  saveOverlayConfig,
  saveStoredTypingProgress,
} from '../lib/storage';
import { emptyCaptionFrame, subtitleCueToCaptionFrame } from '../lib/subtitles';
import { getVideoElement, seekVideo } from '../lib/video';
import { HINT_DEBUG_BUILD_ID } from '../lib/hintDebug';
import type {
  DictionaryWord,
  OverlayConfig,
  StoredFrameProgressData,
  StoredTypingProgressData,
  SubtitleCue,
  Tag,
  TimedCaptionFrame,
} from '../types';

const LOOP_START_PADDING_SECONDS = 1;
const LOOP_END_PADDING_SECONDS = 1;
const SLOW_PLAYBACK_RATE = 0.5;
const MAX_HINT_WORDS = 100;
const TYPE_REVIEW_PRAISE_WORDS = ['Cool!', 'Awesome!', 'Nice!', 'Great!', 'Perfect!'];

interface Props {
  initialSubtitleCues: SubtitleCue[];
  initialSubtitleFileName: string;
  initialTypingProgress: StoredTypingProgressData;
  initialTypingFrames?: TimedCaptionFrame[];
  displaySubtitleCues?: SubtitleCue[];
  displaySubtitleFileName?: string;
  netflixSubtitleTracks?: Array<{
    id: string;
    label: string;
  }>;
  showDebugPanel?: boolean;
  typeReviewMode?: boolean;
  onNativeCueReplay?: (cue: SubtitleCue) => Promise<void> | void;
  onFrameCompleted?: (cue: SubtitleCue) => Promise<void> | void;
  onDisplaySubtitleChange?: (fileName: string, cues: SubtitleCue[]) => Promise<void> | void;
  onLoadNetflixSubtitleTracks?: () => Promise<Array<{
    id: string;
    label: string;
  }>>;
  onNetflixSubtitleTrackChange?: (trackId: string) => Promise<{
    fileName: string;
    cues: SubtitleCue[];
  }>;
  pageUrl: string;
  playbackStorageKey?: string;
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
  netflixSubtitleTracks,
  showDebugPanel = true,
  typeReviewMode = false,
  onNativeCueReplay,
  onFrameCompleted,
  onDisplaySubtitleChange,
  onLoadNetflixSubtitleTracks,
  onNetflixSubtitleTrackChange,
  pageUrl,
  playbackStorageKey,
  shadowRoot,
  targetId,
}: Props) {
  useEffect(() => {
    console.log('[video-typing][hint][runtime-start]', {
      surface: 'overlay',
      buildId: HINT_DEBUG_BUILD_ID,
      extensionId: chrome.runtime.id,
      manifestVersion: chrome.runtime.getManifest().version,
      pageUrl,
    });
  }, [pageUrl]);

  const subtitleCues = initialSubtitleCues;
  const subtitleFileName = initialSubtitleFileName;
  const typingFrames = initialTypingFrames;
  const [typingProgress, setTypingProgress] = useState<StoredTypingProgressData>(initialTypingProgress);
  const [config, setConfig] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
  const [nativeSubtitleState, setNativeSubtitleState] = useState<{
    fileName?: string;
    cues?: SubtitleCue[];
  }>({
    fileName: displaySubtitleFileName,
    cues: displaySubtitleCues,
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hintWords, setHintWords] = useState<DictionaryWord[]>([]);
  const [loopCue, setLoopCue] = useState<SubtitleCue | null>(null);
  const [isMistakeReasonPromptOpen, setIsMistakeReasonPromptOpen] = useState(false);
  const [isUnknownHintSelectionActive, setIsUnknownHintSelectionActive] = useState(false);
  const [pendingHintSearchCount, setPendingHintSearchCount] = useState(0);
  const [activeFrameResetRevision, setActiveFrameResetRevision] = useState(0);
  const [praise, setPraise] = useState<{ id: number; text: string } | null>(null);
  const priorityHintKeysRef = useRef<Set<string>>(new Set());
  const priorityHintRequestIdRef = useRef(0);
  const hintRequestOrderRef = useRef(0);
  const hintWordOrderRef = useRef<Map<string, number>>(new Map());
  const hintFrameGenerationRef = useRef(0);
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
  const unknownHintSelectionHandlerRef = useRef<((word: DictionaryWord) => void) | null>(null);
  const praiseTimerRef = useRef<number | null>(null);

  const cache = useMemo(() => {
    return createCache({
      key: 'video-typing',
      container: shadowRoot,
    });
  }, [shadowRoot]);

  useEffect(() => {
    let isMounted = true;

    void loadOverlayConfig().then((storedConfig) => {
      if (isMounted) {
        setConfig(storedConfig);
      }
    }).catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setNativeSubtitleState({
      fileName: displaySubtitleFileName,
      cues: displaySubtitleCues,
    });
  }, [displaySubtitleCues, displaySubtitleFileName]);

  const handleConfigChange = useCallback((nextConfig: OverlayConfig) => {
    setConfig(nextConfig);
    void saveOverlayConfig(nextConfig);
  }, []);

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

    if (!config.slowPlayback.enabled || mistakeCount < config.slowPlayback.mistakeThreshold) {
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
  }, [
    config.slowPlayback.enabled,
    config.slowPlayback.mistakeThreshold,
    restoreControlledPlaybackRate,
    targetId,
  ]);

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
    const storageKey = playbackStorageKey || pageUrl;
    const persistPlaybackPosition = () => {
      void saveStoredPlaybackPosition(storageKey, currentTimeRef.current);
    };

    window.addEventListener('pagehide', persistPlaybackPosition);

    return () => {
      window.removeEventListener('pagehide', persistPlaybackPosition);
      persistPlaybackPosition();
    };
  }, [pageUrl, playbackStorageKey]);

  const timelineCue = useMemo(() => {
    return subtitleCues.find((cue) => cue.start <= currentTime && currentTime < cue.end) || null;
  }, [currentTime, subtitleCues]);

  // Keep showing the cue currently being typed even while playback moves
  // into the padded pre/post-roll area around that cue.
  const activeCue = loopCue || timelineCue;

  const activeCueIndex = useMemo(() => {
    return activeCue ? findCueIndex(subtitleCues, activeCue) : -1;
  }, [activeCue, subtitleCues]);

  const displayCue = useMemo(() => {
    const displaySubtitleCues = nativeSubtitleState.cues;

    if (!activeCue || !displaySubtitleCues?.length) {
      return activeCue;
    }

    const cueTime = (activeCue.start + activeCue.end) / 2;
    return displaySubtitleCues.find((cue) => cue.start <= cueTime && cueTime < cue.end) || activeCue;
  }, [activeCue, nativeSubtitleState.cues]);

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

  // Keep this ref current during render so an old dictionary promise cannot
  // write into the interval before the frame-change effect runs.
  activeFrameIdRef.current = activeFrame.id;

  useEffect(() => {
    hintFrameGenerationRef.current += 1;
    console.log('[video-typing][hint][frame-reset]', {
      frameId: activeFrame.id,
      generation: hintFrameGenerationRef.current,
      cueText: activeCue?.text || '',
    });
    priorityHintKeysRef.current = new Set();
    priorityHintRequestIdRef.current = 0;
    hintRequestOrderRef.current = 0;
    hintWordOrderRef.current = new Map();
    setPendingHintSearchCount(0);
  }, [activeFrame.id]);

  const resetHintState = useCallback(() => {
    hintFrameGenerationRef.current += 1;
    priorityHintKeysRef.current = new Set();
    priorityHintRequestIdRef.current = 0;
    hintRequestOrderRef.current = 0;
    hintWordOrderRef.current = new Map();
    unknownHintSelectionHandlerRef.current = null;
    setHintWords([]);
    setPendingHintSearchCount(0);
    setIsUnknownHintSelectionActive(false);
  }, []);

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
    if (
      loopCue &&
      isActiveFrameComplete &&
      !isMistakeReasonPromptOpen &&
      pendingHintSearchCount === 0
    ) {
      setLoopCue(null);
    }
  }, [
    isActiveFrameComplete,
    isMistakeReasonPromptOpen,
    loopCue,
    pendingHintSearchCount,
  ]);

  useEffect(() => {
    if (
      !activeCue ||
      (
        isActiveFrameComplete &&
        !isMistakeReasonPromptOpen &&
        pendingHintSearchCount === 0
      )
    ) {
      loopRangeRef.current = null;
      restoreControlledPlaybackRate();
      return;
    }

    const loopPadding = typeReviewMode ? 0 : LOOP_START_PADDING_SECONDS;
    const loopEndPadding = typeReviewMode ? 0 : LOOP_END_PADDING_SECONDS;
    const loopStart = Math.max(0, activeCue.start - loopPadding);
    const loopEnd = activeCue.end + loopEndPadding;

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
    pendingHintSearchCount,
    restoreControlledPlaybackRate,
    subtitleCues,
    typeReviewMode,
  ]);

  useEffect(() => {
    if (!typeReviewMode || loopCue || timelineCue || subtitleCues.length === 0) {
      return;
    }

    const video = getVideoElement(targetId);

    if (!video) {
      return;
    }

    const nextCue = subtitleCues.find((cue) => cue.start > currentTime + 0.05);

    if (nextCue) {
      seekVideo(targetId, nextCue.start);
      setCurrentTime(nextCue.start);
      return;
    }

    const lastCue = subtitleCues[subtitleCues.length - 1];

    if (lastCue && currentTime >= lastCue.end) {
      video.pause();
    }
  }, [
    currentTime,
    loopCue,
    subtitleCues,
    targetId,
    timelineCue,
    typeReviewMode,
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
    if (shouldReplayNativeOnMistake(nextCount, config)) {
      trackNativeReplay(onNativeCueReplay?.(activeCue));
    }
  }, [
    activeCue,
    activeFrame.id,
    applyMistakeSensitivePlaybackRate,
    config,
    onNativeCueReplay,
    trackNativeReplay,
  ]);

  const handleFrameCompleted = useCallback(() => {
    if (!activeCue) {
      return;
    }

    void Promise.resolve(onFrameCompleted?.(activeCue));
    const replay = !typeReviewMode && config.nativeReplay.completionReplayEnabled
      ? onNativeCueReplay?.(activeCue)
      : undefined;

    trackNativeReplay(replay);
  }, [
    activeCue,
    config.nativeReplay.completionReplayEnabled,
    onFrameCompleted,
    onNativeCueReplay,
    trackNativeReplay,
    typeReviewMode,
  ]);

  const handleDisplaySubtitleChange = useCallback(async (fileName: string, cues: SubtitleCue[]) => {
    await onDisplaySubtitleChange?.(fileName, cues);
    setNativeSubtitleState({ fileName, cues });
  }, [onDisplaySubtitleChange]);

  const handleNetflixSubtitleTrackChange = useCallback(async (trackId: string) => {
    if (!onNetflixSubtitleTrackChange) {
      return;
    }

    const nextSubtitle = await onNetflixSubtitleTrackChange(trackId);
    setNativeSubtitleState(nextSubtitle);
  }, [onNetflixSubtitleTrackChange]);

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

  const handleTypeReviewMistakeTagsCleared = useCallback(() => {
    const text = TYPE_REVIEW_PRAISE_WORDS[Math.floor(Math.random() * TYPE_REVIEW_PRAISE_WORDS.length)];

    if (praiseTimerRef.current !== null) {
      window.clearTimeout(praiseTimerRef.current);
    }

    setPraise({ id: Date.now(), text });
    praiseTimerRef.current = window.setTimeout(() => {
      setPraise(null);
      praiseTimerRef.current = null;
    }, 1200);
  }, []);

  useEffect(() => {
    return () => {
      if (praiseTimerRef.current !== null) {
        window.clearTimeout(praiseTimerRef.current);
      }
    };
  }, []);

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

  const handleResetCurrentCueState = useCallback(() => {
    if (!activeCue) {
      return;
    }

    console.log('[video-typing][debug][cue-state-reset]', {
      frameId: activeFrame.id,
      cueText: activeCue.text,
    });
    resetHintState();
    setTypingProgress((state) => {
      if (!(activeFrame.id in state)) {
        return state;
      }

      const next = { ...state };
      delete next[activeFrame.id];
      return next;
    });
    void deleteStoredFrameTypingProgress(pageUrl, activeFrame.id);
    const nextMistakeCounts = { ...mistakeCountsRef.current };
    delete nextMistakeCounts[activeFrame.id];
    mistakeCountsRef.current = nextMistakeCounts;
    nativeReplayCountRef.current = 0;
    shouldResumeAfterMistakeReasonRef.current = false;
    setIsMistakeReasonPromptOpen(false);
    setLoopCue(activeCue);
    setActiveFrameResetRevision((revision) => revision + 1);
    restoreControlledPlaybackRate();
  }, [
    activeCue,
    activeFrame.id,
    pageUrl,
    resetHintState,
    restoreControlledPlaybackRate,
  ]);

  const handleJumpToCue = useCallback((cueNumber: number) => {
    if (!Number.isInteger(cueNumber)) {
      return;
    }

    const targetCue = subtitleCues[cueNumber - 1];

    if (!targetCue) {
      return;
    }

    console.log('[video-typing][debug][cue-jump]', {
      fromCueNumber: activeCueIndex >= 0 ? activeCueIndex + 1 : null,
      toCueNumber: cueNumber,
      cueText: targetCue.text,
    });
    resetHintState();
    nativeReplayCountRef.current = 0;
    shouldResumeAfterMistakeReasonRef.current = false;
    loopRangeRef.current = null;
    setIsMistakeReasonPromptOpen(false);
    setLoopCue(targetCue);
    setCurrentTime(targetCue.start);
    setActiveFrameResetRevision((revision) => revision + 1);
    restoreControlledPlaybackRate();
    seekVideo(targetId, targetCue.start);
  }, [
    activeCueIndex,
    resetHintState,
    restoreControlledPlaybackRate,
    subtitleCues,
    targetId,
  ]);

  const stopOverlayKeyboardEventPropagation = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
  }, []);

  const handleRequestExplanation = useCallback((
    query: string,
    options?: {
      contextText?: string;
      priority?: boolean;
      silentIfMissing?: boolean;
      sourceText?: string;
      clearExisting?: boolean;
    },
  ) => {
    const isChineseTypingMode = hasChineseTypingWords(typingFrames);
    const displayQuery = isChineseTypingMode ? options?.sourceText || query : query;
    const contextText = options?.contextText ?? activeCue?.text ?? '';
    const isPriorityHint = options?.priority ?? !options?.silentIfMissing;
    const requestedFrameId = activeFrame.id;
    const frameGeneration = hintFrameGenerationRef.current;
    const requestOrder = hintRequestOrderRef.current + 1;
    const requestId = `${requestedFrameId}:${frameGeneration}:${requestOrder}:${query}`;
    const priorityRequestId = isPriorityHint
      ? priorityHintRequestIdRef.current + 1
      : priorityHintRequestIdRef.current;

    hintRequestOrderRef.current = requestOrder;
    console.log('[video-typing][hint][request-start]', {
      requestId,
      query,
      displayQuery,
      contextText,
      requestedFrameId,
      frameGeneration,
      requestOrder,
      isPriorityHint,
      options,
    });

    if (isPriorityHint) {
      priorityHintRequestIdRef.current = priorityRequestId;
    }

    if (options?.clearExisting) {
      priorityHintKeysRef.current = new Set();
      hintWordOrderRef.current = new Map();
      setHintWords([]);
    }

    const mergeSearchResult = (nextWords: DictionaryWord[]) => {
      if (
        activeFrameIdRef.current !== requestedFrameId ||
        hintFrameGenerationRef.current !== frameGeneration
      ) {
        console.log('[video-typing][hint][result-dropped-frame-mismatch]', {
          requestId,
          requestedFrameId,
          currentFrameId: activeFrameIdRef.current,
          requestedGeneration: frameGeneration,
          currentGeneration: hintFrameGenerationRef.current,
          nextTitles: nextWords.map((word) => word.title),
        });
        return;
      }

      if (isPriorityHint && priorityHintRequestIdRef.current !== priorityRequestId) {
        console.log('[video-typing][hint][result-dropped-priority-mismatch]', {
          requestId,
          priorityRequestId,
          currentPriorityRequestId: priorityHintRequestIdRef.current,
        });
        return;
      }

      if (isPriorityHint) {
        priorityHintKeysRef.current = new Set(nextWords.map(getHintWordKey));
      }

      for (const word of nextWords) {
        hintWordOrderRef.current.set(getHintWordKey(word), requestOrder);
      }

      setHintWords((state) => {
        const merged = mergeHintWords(
          state,
          nextWords,
          priorityHintKeysRef.current,
          hintWordOrderRef.current,
        );
        console.log('[video-typing][hint][result-merged]', {
          requestId,
          incomingTitles: nextWords.map((word) => word.title),
          beforeTitles: state.map((word) => word.title),
          afterTitles: merged.map((word) => word.title),
        });
        return merged;
      });
    };
    const trackSearch = (search: Promise<void>) => {
      setPendingHintSearchCount((count) => {
        const nextCount = count + 1;
        console.log('[video-typing][hint][pending-change]', {
          requestId,
          phase: 'start',
          count: nextCount,
        });
        return nextCount;
      });

      return search.finally(() => {
        if (
          activeFrameIdRef.current !== requestedFrameId ||
          hintFrameGenerationRef.current !== frameGeneration
        ) {
          console.log('[video-typing][hint][pending-finish-ignored-frame-mismatch]', {
            requestId,
            requestedFrameId,
            currentFrameId: activeFrameIdRef.current,
          });
          return;
        }

        setPendingHintSearchCount((count) => {
          const nextCount = Math.max(0, count - 1);
          console.log('[video-typing][hint][pending-change]', {
            requestId,
            phase: 'finish',
            count: nextCount,
          });
          return nextCount;
        });
      });
    };

    if (isChineseTypingMode) {
      return trackSearch(searchExtensionChineseDictionary(displayQuery, contextText, requestId).then((entries) => {
        console.log('[video-typing][hint][search-resolved]', {
          requestId,
          entryHeadwords: entries.map((entry) => entry.headword),
        });
        if (entries.length === 0 && options?.silentIfMissing) {
          console.log('[video-typing][hint][empty-result-suppressed]', { requestId });
          return;
        }

        const nextWords: DictionaryWord[] = entries.length > 0
          ? createDictionaryHintWords(entries)
          : [{
            title: displayQuery,
            content: 'Dictionary entry was not found.',
          }];

        mergeSearchResult(nextWords);
      }).catch(() => {
        if (options?.silentIfMissing) {
          return;
        }

        mergeSearchResult([{
          title: displayQuery,
          content: 'Dictionary search failed.',
        }]);
      }));
    }

    return trackSearch(searchExtensionDictionary(query, contextText, requestId).then((entries) => {
      console.log('[video-typing][hint][search-resolved]', {
        requestId,
        entryHeadwords: entries.map((entry) => entry.headword),
      });
      if (entries.length === 0 && options?.silentIfMissing) {
        console.log('[video-typing][hint][empty-result-suppressed]', { requestId });
        return;
      }

      const nextWords: DictionaryWord[] = entries.length > 0
        ? createDictionaryHintWords(entries)
        : [{
          title: displayQuery,
          content: 'Dictionary entry was not found.',
        }];

      mergeSearchResult(nextWords);
    }).catch((error) => {
      console.log('[video-typing][hint][search-error]', { requestId, error });
      if (options?.silentIfMissing) {
        return;
      }

      mergeSearchResult([{
        title: displayQuery,
        content: 'Dictionary search failed.',
      }]);
    }));
  }, [activeCue?.text, activeFrame.id, typingFrames?.length]);

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
            resetRevision={activeFrameResetRevision}
            sendCompleted={handleFrameCompleted}
            requestExplanation={handleRequestExplanation}
            onMistakeInput={handleMistakeInput}
            onMistakeReasonPromptOpen={handleMistakeReasonPromptOpen}
            onMistakeReasonPromptClose={handleMistakeReasonPromptClose}
            onFrameInteracted={handleFrameInteracted}
            onFinishedCharIdsChange={handleFinishedCharIdsChange}
            onTagsChange={handleTagsChange}
            hintWords={hintWords}
            onUnknownHintSelectionActiveChange={setIsUnknownHintSelectionActive}
            onUnknownHintSelectionHandlerChange={(handler) => {
              unknownHintSelectionHandlerRef.current = handler;
            }}
            onTypeReviewMistakeTagsCleared={handleTypeReviewMistakeTagsCleared}
            typeReviewMode={typeReviewMode}
          />
        </DraggablePanel>
        <DraggablePanel
          kind="hint"
          title="Hint"
          defaultPosition={{ x: 700, y: 120 }}
          defaultSize={{ width: 360, height: 400 }}
        >
          <Hint
            words={hintWords}
            selectable={isUnknownHintSelectionActive}
            onWordSelect={(word) => unknownHintSelectionHandlerRef.current?.(word)}
          />
        </DraggablePanel>
        {showDebugPanel ? (
          <DraggablePanel
            kind="config"
            title="Config"
            defaultPosition={{ x: 24, y: 24 }}
            defaultSize={{ width: 380, height: 520 }}
          >
            <ConfigPanel
              config={config}
              currentCueNumber={activeCueIndex >= 0 ? activeCueIndex + 1 : null}
              cueCount={subtitleCues.length}
              subtitleFileName={subtitleFileName}
              displaySubtitleFileName={nativeSubtitleState.fileName}
              netflixSubtitleTracks={netflixSubtitleTracks}
              onConfigChange={handleConfigChange}
              onJumpToCue={handleJumpToCue}
              canResetCurrentCueState={Boolean(activeCue)}
              onResetCurrentCueState={handleResetCurrentCueState}
              onDisplaySubtitleChange={handleDisplaySubtitleChange}
              onLoadNetflixSubtitleTracks={onLoadNetflixSubtitleTracks}
              onNetflixSubtitleTrackChange={onNetflixSubtitleTrackChange ? handleNetflixSubtitleTrackChange : undefined}
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
            fileName={nativeSubtitleState.fileName || subtitleFileName}
          />
        </DraggablePanel>
        {praise ? <PraiseOverlay key={praise.id} text={praise.text} /> : null}
      </div>
    </CacheProvider>
  );
}

function PraiseOverlay({ text }: { text: string }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => setActive(true));
    const hideTimer = window.setTimeout(() => setActive(false), 760);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(hideTimer);
    };
  }, []);

  return (
    <div style={praiseOverlayStyle} aria-hidden="true">
      <div
        style={{
          ...praiseTextStyle,
          opacity: active ? 1 : 0,
          transform: active ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.82)',
        }}
      >
        {text}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2147483646,
  pointerEvents: 'none',
};

const praiseOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  pointerEvents: 'none',
  zIndex: 2147483647,
};

const praiseTextStyle: React.CSSProperties = {
  maxWidth: 'calc(100vw - 32px)',
  padding: '18px 28px',
  borderRadius: '999px',
  background: 'rgba(216, 239, 229, 0.94)',
  color: '#102016',
  fontSize: '72px',
  fontWeight: 900,
  lineHeight: 1,
  letterSpacing: 0,
  textShadow: '0 2px 0 rgba(255, 255, 255, 0.36)',
  boxShadow: '0 22px 70px rgba(0, 0, 0, 0.34)',
  transition: 'opacity 220ms ease, transform 360ms cubic-bezier(0.2, 1.4, 0.35, 1)',
  overflowWrap: 'break-word',
  textAlign: 'center',
};

function getHintWordKey(word: DictionaryWord) {
  return word.dictionaryEntryKey || `${word.title}\u0000${word.content}`;
}

function findCueIndex(cues: SubtitleCue[], targetCue: SubtitleCue) {
  const exactIndex = cues.findIndex((cue) => (
    cue.start === targetCue.start &&
    cue.end === targetCue.end &&
    cue.text === targetCue.text
  ));

  if (exactIndex !== -1) {
    return exactIndex;
  }

  return cues.findIndex((cue) => (
    cue.start === targetCue.start &&
    cue.end === targetCue.end
  ));
}

function hasChineseTypingWords(typingFrames?: TimedCaptionFrame[]) {
  return Boolean(typingFrames?.some((frame) => frame.words?.length));
}

function shouldReplayNativeOnMistake(mistakeCount: number, config: OverlayConfig) {
  if (!config.nativeReplay.mistakeReplayEnabled || mistakeCount < config.nativeReplay.mistakeThreshold) {
    return false;
  }

  return (mistakeCount - config.nativeReplay.mistakeThreshold) % config.nativeReplay.mistakeInterval === 0;
}

function createDictionaryHintWords(
  entries: Array<{
    normalizedHeadword: string;
    headword: string;
    body: string;
  }>,
): DictionaryWord[] {
  const groups = new Map<string, {
    title: string;
    bodies: string[];
  }>();

  for (const entry of entries) {
    const key = entry.normalizedHeadword;
    const group = groups.get(key);

    if (group) {
      group.bodies.push(entry.body);
      continue;
    }

    groups.set(key, {
      title: entry.headword,
      bodies: [entry.body],
    });
  }

  return Array.from(groups, ([normalizedHeadword, group]) => ({
    title: group.title,
    content: group.bodies.join('\n\n'),
    dictionaryEntryKey: `headword:${normalizedHeadword}`,
  }));
}

function mergeHintWords(
  state: DictionaryWord[],
  nextWords: DictionaryWord[],
  _priorityKeys = new Set<string>(),
  wordOrder = new Map<string, number>(),
) {
  const existingKeys = new Set(nextWords.map(getHintWordKey));
  const existingEntryKeys = new Set(nextWords.flatMap((word) => (
    word.dictionaryEntryKey ? [word.dictionaryEntryKey] : []
  )));
  const filtered = state.filter((word) => (
    !existingKeys.has(getHintWordKey(word)) &&
    !(word.dictionaryEntryKey && existingEntryKeys.has(word.dictionaryEntryKey))
  ));
  const merged = [...nextWords, ...filtered];
  const compareByRequestOrder = (left: DictionaryWord, right: DictionaryWord) => (
    (wordOrder.get(getHintWordKey(right)) || 0) -
    (wordOrder.get(getHintWordKey(left)) || 0)
  );
  return merged.sort(compareByRequestOrder).slice(0, MAX_HINT_WORDS);
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
      areHintSelectionsEqual(leftTag.hint, rightTag.hint) &&
      leftTag.pastedCharIds.length === rightTag.pastedCharIds.length &&
      leftTag.pastedCharIds.every((charId, charIndex) => charId === rightTag.pastedCharIds[charIndex])
    );
  });
}

function areHintSelectionsEqual(left: Tag['hint'], right: Tag['hint']) {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.headword === right.headword &&
    left.meaning === right.meaning &&
    left.dictionaryEntryKey === right.dictionaryEntryKey &&
    left.selectedText === right.selectedText &&
    left.selectedAt === right.selectedAt
  );
}
