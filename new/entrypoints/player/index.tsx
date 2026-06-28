import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { OverlayApp } from '../../src/components/OverlayApp';
import { Line } from '../../src/legacy-ui/TypingPart/Line';
import type { GameChar } from '../../src/legacy-ui/TypingPart/Window';
import {
  createLocalPlayerStorageKey,
  ensureFileHandlePermission,
  listLocalPlayerSessions,
  saveLocalPlayerSession,
  touchLocalPlayerSession,
} from '../../src/lib/localPlayerDb';
import {
  clearStoredProgressState,
  clearStoredSubtitleSetting,
  listExternalHistoryItems,
  loadStoredPlaybackPosition,
  loadStoredTypingProgress,
} from '../../src/lib/storage';
import { isChineseTypingJsonFile, parseChineseTypingJson } from '../../src/lib/chineseTyping';
import {
  buildSessionReviewFrames,
  buildSessionTypeReviewFrames,
  buildStoredSubtitleReviewFrames,
  createTypeReviewTypingProgress,
  createStoredSubtitleUnknownWordCsvRows,
  createUnknownWordCsv,
  createUnknownWordCsvRows,
  type ReviewFrame,
} from '../../src/lib/localPlayerReview';
import { parseSubtitleFile, subtitleCueToCaptionFrame } from '../../src/lib/subtitles';
import type {
  CaptionFrame,
  ExternalHistoryItem,
  StoredLocalPlayerSession,
  StoredTypingProgressData,
  SubtitleCue,
  TimedCaptionFrame,
} from '../../src/types';
import '../../src/styles/player.css';

const VIDEO_ATTR = 'data-video-typing-target-id';
const MAIN_VIDEO_ACCEPT = {
  description: 'MP4 video',
  accept: { 'video/mp4': ['.mp4'] },
};
const SUBTITLE_ACCEPT = {
  description: 'Subtitle',
  accept: {
    'application/json': ['.json'],
    'text/plain': ['.srt', '.vtt', '.ttml', '.xml', '.txt', '.json'],
    'text/vtt': ['.vtt'],
  },
};
const SOURCE_SUBTITLE_ACCEPT = {
  description: 'Original subtitle',
  accept: {
    'text/plain': ['.srt', '.vtt', '.ttml', '.xml', '.txt'],
    'text/vtt': ['.vtt'],
  },
};

interface ActiveSession {
  session: StoredLocalPlayerSession;
  mainVideoFile: File;
  nativeAudioFile?: File;
  storageKey: string;
  typingProgress: StoredTypingProgressData;
  initialTime?: number;
  typeReviewMode?: boolean;
  typeReviewCueCount?: number;
}

function PlayerApp() {
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const nativeAudioRef = useRef<HTMLVideoElement>(null);
  const replayPromiseRef = useRef<Promise<void> | null>(null);
  const [mainVideoHandle, setMainVideoHandle] = useState<FileSystemFileHandle | null>(null);
  const [nativeAudioHandle, setNativeAudioHandle] = useState<FileSystemFileHandle | null>(null);
  const [subtitleHandle, setSubtitleHandle] = useState<FileSystemFileHandle | null>(null);
  const [nativeSubtitleHandle, setNativeSubtitleHandle] = useState<FileSystemFileHandle | null>(null);
  const [sessions, setSessions] = useState<StoredLocalPlayerSession[]>([]);
  const [externalHistoryItems, setExternalHistoryItems] = useState<ExternalHistoryItem[]>([]);
  const [progressSummaries, setProgressSummaries] = useState<Record<string, string>>({});
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [reviewSession, setReviewSession] = useState<{
    title: string;
    reviewFrames: ReviewFrame[];
  } | null>(null);
  const [mainVideoUrl, setMainVideoUrl] = useState('');
  const [nativeAudioUrl, setNativeAudioUrl] = useState('');
  const [status, setStatus] = useState('');
  const [routeSessionId, setRouteSessionId] = useState(() => getRouteSessionId());

  const targetId = useMemo(() => `video-typing-local-${Date.now()}`, []);

  const refreshSessions = useCallback(() => {
    void Promise.all([
      listLocalPlayerSessions(),
      listExternalHistoryItems(),
    ]).then(async ([items, externalItems]) => {
      setSessions(items);
      setExternalHistoryItems(externalItems);
      const summaries = await Promise.all(items.map(async (session) => {
        const progress = await loadStoredTypingProgress(createLocalPlayerStorageKey(session.id));
        return [session.id, summarizeSessionProgress(session, progress)] as const;
      }));
      setProgressSummaries(Object.fromEntries(summaries));
    }).catch(() => setStatus('Failed to load history.'));
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    const handleHashChange = () => {
      setRouteSessionId(getRouteSessionId());
    };

    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  useEffect(() => {
    const hashSessionId = routeSessionId;

    if (!hashSessionId) {
      setActiveSession(null);
      return;
    }

    setReviewSession(null);
    void listLocalPlayerSessions()
      .then((items) => {
        const session = items.find((item) => item.id === hashSessionId);
        if (session) {
          return startStoredSession(session);
        }
        return undefined;
      })
      .catch(() => setStatus('Failed to open local player history item.'));
  }, [routeSessionId]);

  useEffect(() => {
    const video = mainVideoRef.current;

    if (!video || !activeSession) {
      return;
    }

    video.setAttribute(VIDEO_ATTR, targetId);
    if (typeof activeSession.initialTime === 'number') {
      video.currentTime = Math.max(0, activeSession.initialTime);
    }
  }, [activeSession, targetId]);

  useEffect(() => {
    return () => {
      if (mainVideoUrl) {
        URL.revokeObjectURL(mainVideoUrl);
      }
      if (nativeAudioUrl) {
        URL.revokeObjectURL(nativeAudioUrl);
      }
    };
  }, [mainVideoUrl, nativeAudioUrl]);

  const replaceObjectUrls = (mainFile: File, nativeFile?: File) => {
    if (mainVideoUrl) {
      URL.revokeObjectURL(mainVideoUrl);
    }
    if (nativeAudioUrl) {
      URL.revokeObjectURL(nativeAudioUrl);
    }

    setMainVideoUrl(URL.createObjectURL(mainFile));
    setNativeAudioUrl(nativeFile ? URL.createObjectURL(nativeFile) : '');
  };

  const startStoredSession = async (
    session: StoredLocalPlayerSession,
    options?: { typeReviewMode?: boolean },
  ) => {
    setStatus('');

    const hasMainPermission = await ensureFileHandlePermission(session.mainVideoHandle);
    if (!hasMainPermission) {
      setStatus('Main video permission was not granted.');
      return;
    }

    const hasNativePermission = session.nativeAudioHandle
      ? await ensureFileHandlePermission(session.nativeAudioHandle)
      : true;
    if (!hasNativePermission) {
      setStatus('Native audio permission was not granted.');
      return;
    }

    const mainVideoFile = await session.mainVideoHandle.getFile();
    const nativeAudioFile = session.nativeAudioHandle
      ? await session.nativeAudioHandle.getFile()
      : undefined;
    const storageKey = createLocalPlayerStorageKey(session.id);
    const [storedTypingProgress, playbackPosition] = await Promise.all([
      loadStoredTypingProgress(storageKey),
      loadStoredPlaybackPosition(storageKey),
    ]);
    let activePlayerSession = session;
    let typingProgress = storedTypingProgress;
    let initialTime = getResumePlaybackPosition(session, storedTypingProgress) ?? playbackPosition?.currentTime;
    let typeReviewCueCount: number | undefined;

    if (options?.typeReviewMode) {
      const typeReviewFrames = buildSessionTypeReviewFrames(session, storedTypingProgress);

      if (typeReviewFrames.length === 0) {
        setStatus('No ignorance or unaudible cues to review.');
        return;
      }

      activePlayerSession = {
        ...session,
        subtitleCues: typeReviewFrames.map((reviewFrame) => reviewFrame.cue),
        typingFrames: typeReviewFrames.map((reviewFrame) => ({
          ...reviewFrame.frame,
          tags: reviewFrame.tags,
        })),
      };
      typingProgress = createTypeReviewTypingProgress(typeReviewFrames);
      initialTime = activePlayerSession.subtitleCues[0]?.start;
      typeReviewCueCount = typeReviewFrames.length;
    }

    replaceObjectUrls(mainVideoFile, nativeAudioFile);
    setActiveSession({
      session: activePlayerSession,
      mainVideoFile,
      nativeAudioFile,
      storageKey,
      typingProgress,
      initialTime,
      typeReviewMode: Boolean(options?.typeReviewMode),
      typeReviewCueCount,
    });
    await touchLocalPlayerSession(session.id);
    refreshSessions();
  };

  const handleStartNewSession = async () => {
    if (!mainVideoHandle || !subtitleHandle) {
      setStatus('Main video and subtitle file are required.');
      return;
    }

    try {
      setStatus('');
      const sourceSubtitleHandle = isChineseTypingJsonFile(subtitleHandle.name)
        ? await pickFileHandle([SOURCE_SUBTITLE_ACCEPT])
        : null;

      if (isChineseTypingJsonFile(subtitleHandle.name) && !sourceSubtitleHandle) {
        setStatus('Original Chinese subtitle file is required.');
        return;
      }

      const [mainVideoFile, subtitleFile] = await Promise.all([
        mainVideoHandle.getFile(),
        subtitleHandle.getFile(),
      ]);
      const nativeSubtitleFile = nativeSubtitleHandle ? await nativeSubtitleHandle.getFile() : undefined;
      const subtitleText = await subtitleFile.text();
      const subtitleData = await readTypingSubtitleData(
        subtitleFile,
        subtitleText,
        sourceSubtitleHandle,
        setStatus,
      );

      if (subtitleData.subtitleCues.length === 0) {
        setStatus('No usable subtitle cues found.');
        return;
      }

      const nativeSubtitleCues = nativeSubtitleFile
        ? parseSubtitleFile(nativeSubtitleFile.name, await nativeSubtitleFile.text())
        : undefined;

      const now = Date.now();
      const session: StoredLocalPlayerSession = {
        id: crypto.randomUUID(),
        title: mainVideoFile.name,
        createdAt: now,
        updatedAt: now,
        mainVideoHandle,
        nativeAudioHandle: nativeAudioHandle || undefined,
        subtitleFileName: subtitleData.subtitleFileName,
        subtitleCues: subtitleData.subtitleCues,
        typingFrames: subtitleData.typingFrames,
        nativeSubtitleFileName: nativeSubtitleFile?.name,
        nativeSubtitleCues,
      };

      await saveLocalPlayerSession(session);
      setMainVideoHandle(null);
      setNativeAudioHandle(null);
      setSubtitleHandle(null);
      setNativeSubtitleHandle(null);
      setStatus('Added to built-in player history.');
      refreshSessions();
    } catch {
      setStatus('Failed to add local player session.');
    }
  };

  const handleDeleteLocalProgress = async (session: StoredLocalPlayerSession) => {
    try {
      await clearStoredProgressState(createLocalPlayerStorageKey(session.id));
      setStatus('Deleted built-in player progress.');
      refreshSessions();
    } catch {
      setStatus('Failed to delete built-in player progress.');
    }
  };

  const handleExportUnknownWordsCsv = async (session: StoredLocalPlayerSession) => {
    try {
      const progress = await loadStoredTypingProgress(createLocalPlayerStorageKey(session.id));
      const rows = createUnknownWordCsvRows(session, progress);
      downloadUnknownWordsCsv(session.title, rows);
      setStatus(`Exported ${rows.length.toLocaleString()} unknown word rows.`);
    } catch {
      setStatus('Failed to export unknown words CSV.');
    }
  };

  const handleOpenSubtitleReview = async (session: StoredLocalPlayerSession) => {
    try {
      const typingProgress = await loadStoredTypingProgress(createLocalPlayerStorageKey(session.id));
      setReviewSession({
        title: session.title,
        reviewFrames: buildSessionReviewFrames(session, typingProgress),
      });
      setStatus('');
    } catch {
      setStatus('Failed to open subtitle review.');
    }
  };

  const handleOpenTypeReview = async (session: StoredLocalPlayerSession) => {
    await startStoredSession(session, { typeReviewMode: true });
  };

  const handleExportExternalUnknownWordsCsv = (item: ExternalHistoryItem) => {
    if (!item.subtitle) {
      setStatus('External site subtitle setting is missing.');
      return;
    }

    try {
      const rows = createStoredSubtitleUnknownWordCsvRows(item.subtitle, item.typingProgress);
      downloadUnknownWordsCsv(item.title, rows);
      setStatus(`Exported ${rows.length.toLocaleString()} unknown word rows.`);
    } catch {
      setStatus('Failed to export external site unknown words CSV.');
    }
  };

  const handleOpenExternalSubtitleReview = (item: ExternalHistoryItem) => {
    if (!item.subtitle) {
      setStatus('External site subtitle setting is missing.');
      return;
    }

    setReviewSession({
      title: item.title,
      reviewFrames: buildStoredSubtitleReviewFrames(item.subtitle, item.typingProgress),
    });
    setStatus('');
  };

  const handleOpenExternalPage = (item: ExternalHistoryItem) => {
    window.open(item.url, '_blank', 'noopener,noreferrer');
    setStatus('Opened page. Click the extension button on that tab to resume.');
  };

  const handleDeleteExternalProgress = async (item: ExternalHistoryItem) => {
    try {
      await clearStoredProgressState(item.url);
      setStatus('Deleted external site progress.');
      refreshSessions();
    } catch {
      setStatus('Failed to delete external site progress.');
    }
  };

  const handleDeleteExternalSubtitle = async (item: ExternalHistoryItem) => {
    try {
      await clearStoredSubtitleSetting(item.url);
      setStatus('Deleted external site subtitle setting.');
      refreshSessions();
    } catch {
      setStatus('Failed to delete external site subtitle setting.');
    }
  };

  const replayNativeCue = useCallback((cue: SubtitleCue) => {
    const mainVideo = mainVideoRef.current;
    const nativeVideo = nativeAudioRef.current;

    if (!mainVideo || !nativeVideo || !activeSession?.nativeAudioFile) {
      return Promise.resolve();
    }

    const replay = async () => {
      const shouldResumeMain = !mainVideo.paused;
      const wasMainMuted = mainVideo.muted;
      mainVideo.muted = true;
      mainVideo.currentTime = Math.max(0, cue.start);
      mainVideo.playbackRate = 1;
      nativeVideo.pause();
      nativeVideo.currentTime = Math.max(0, cue.start);
      nativeVideo.playbackRate = 1;

      try {
        await Promise.all([
          mainVideo.play().catch(() => undefined),
          nativeVideo.play(),
        ]);
        await waitForMediaTime(nativeVideo, cue.end);
      } finally {
        nativeVideo.pause();
        nativeVideo.playbackRate = 1;
        mainVideo.muted = wasMainMuted;

        if (!shouldResumeMain) {
          mainVideo.pause();
        }
      }
    };

    const nextReplay = (replayPromiseRef.current || Promise.resolve())
      .catch(() => undefined)
      .then(replay);

    replayPromiseRef.current = nextReplay;
    return nextReplay;
  }, [activeSession?.nativeAudioFile]);

  const handleFrameMistake = useCallback((cue: SubtitleCue, mistakeCount: number) => {
    if (mistakeCount > 0 && mistakeCount % 5 === 0) {
      return replayNativeCue(cue);
    }
  }, [replayNativeCue]);

  const handleFrameCompleted = useCallback(async (cue: SubtitleCue) => {
    if (activeSession) {
      await touchLocalPlayerSession(activeSession.session.id);
      refreshSessions();
    }

    if (activeSession?.typeReviewMode) {
      return;
    }

    await replayNativeCue(cue);
  }, [activeSession, refreshSessions, replayNativeCue]);

  return (
    <main className={activeSession ? 'playerPage playbackPage' : 'playerPage'}>
      <div className="playerShell">
        <header className="playerHeader">
          <div>
            <h1>{activeSession ? activeSession.session.title : 'Local player'}</h1>
            <p>
              {activeSession
                ? activeSession.typeReviewMode
                  ? `タイプ復習: ${activeSession.typeReviewCueCount?.toLocaleString() || 0} cues / ${activeSession.session.subtitleFileName}`
                  : activeSession.session.subtitleFileName
                : 'Register an MP4 file and subtitles, then resume from history.'}
            </p>
          </div>
          <div className="playerActions">
            {activeSession ? (
              <button
                className="playerButton"
                type="button"
                onClick={() => {
                  if (mainVideoUrl) {
                    URL.revokeObjectURL(mainVideoUrl);
                    setMainVideoUrl('');
                  }
                  if (nativeAudioUrl) {
                    URL.revokeObjectURL(nativeAudioUrl);
                    setNativeAudioUrl('');
                  }
                  window.location.hash = '';
                }}
              >
                Back to history
              </button>
            ) : (
              <button className="playerButton" type="button" onClick={refreshSessions}>
                Refresh history
              </button>
            )}
          </div>
        </header>

        {!activeSession ? (
          reviewSession ? (
            <SubtitleReviewView
              title={reviewSession.title}
              reviewFrames={reviewSession.reviewFrames}
              onBack={() => setReviewSession(null)}
            />
          ) : (
            <div className="playerGrid">
            <section className="playerPanel">
              <h2>Register files</h2>
              <div className="fileRows">
                <FileHandlePicker
                  label="Main MP4 video"
                  handle={mainVideoHandle}
                  pickerTypes={[MAIN_VIDEO_ACCEPT]}
                  onError={setStatus}
                  onPick={setMainVideoHandle}
                />
                <FileHandlePicker
                  label="Native MP4 audio"
                  handle={nativeAudioHandle}
                  pickerTypes={[MAIN_VIDEO_ACCEPT]}
                  optional
                  onError={setStatus}
                  onPick={setNativeAudioHandle}
                />
                <FileHandlePicker
                  label="Subtitle file"
                  handle={subtitleHandle}
                  pickerTypes={[SUBTITLE_ACCEPT]}
                  onError={setStatus}
                  onPick={setSubtitleHandle}
                />
                <FileHandlePicker
                  label="Native subtitle file"
                  handle={nativeSubtitleHandle}
                  pickerTypes={[SUBTITLE_ACCEPT]}
                  optional
                  onError={setStatus}
                  onPick={setNativeSubtitleHandle}
                />
                <button
                  className="playerButton primary"
                  type="button"
                  disabled={!mainVideoHandle || !subtitleHandle}
                  onClick={() => void handleStartNewSession()}
                >
                  Add to history
                </button>
                {status ? <div className="statusText">{status}</div> : null}
              </div>
            </section>

            <div className="historyColumn">
              <section className="playerPanel">
                <h2>Built-in player history</h2>
                <div className="historyList">
                  {sessions.length === 0 ? (
                    <div className="statusText">No local player history.</div>
                  ) : sessions.map((session) => (
                    <article className="historyCard" key={session.id}>
                      <div className="historyCardBody">
                        <strong>{session.title}</strong>
                        <span>{session.subtitleFileName}</span>
                        <span>{progressSummaries[session.id] || 'Progress loading...'}</span>
                        <span>{formatHistoryDate(session.updatedAt)}</span>
                      </div>
                      <div className="historyActions">
                        <button
                          className="playerButton"
                          type="button"
                          onClick={() => { window.location.hash = `session=${session.id}`; }}
                        >
                          Open
                        </button>
                        <button
                          className="playerButton"
                          type="button"
                          onClick={() => void handleDeleteLocalProgress(session)}
                        >
                          Delete progress
                        </button>
                        <button
                          className="playerButton"
                          type="button"
                          onClick={() => void handleExportUnknownWordsCsv(session)}
                        >
                          CSV出力
                        </button>
                        <button
                          className="playerButton"
                          type="button"
                          onClick={() => void handleOpenSubtitleReview(session)}
                        >
                          字幕復習
                        </button>
                        <button
                          className="playerButton"
                          type="button"
                          onClick={() => void handleOpenTypeReview(session)}
                        >
                          タイプ復習
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="playerPanel">
                <h2>External site history</h2>
                <div className="historyList">
                  {externalHistoryItems.length === 0 ? (
                    <div className="statusText">No external site history.</div>
                  ) : externalHistoryItems.map((item) => (
                    <article className="historyCard" key={item.url}>
                      <div className="historyCardBody">
                        <strong>{item.title}</strong>
                        <span>{item.url}</span>
                        <span>{summarizeExternalHistoryItem(item)}</span>
                        <span>{formatHistoryDate(item.updatedAt)}</span>
                      </div>
                      <div className="historyActions">
                        <button
                          className="playerButton"
                          type="button"
                          onClick={() => handleOpenExternalPage(item)}
                        >
                          Open page
                        </button>
                        <button
                          className="playerButton"
                          type="button"
                          onClick={() => void handleDeleteExternalProgress(item)}
                        >
                          Delete progress
                        </button>
                        <button
                          className="playerButton"
                          type="button"
                          onClick={() => void handleDeleteExternalSubtitle(item)}
                          disabled={!item.subtitle}
                        >
                          Delete subtitle
                        </button>
                        <button
                          className="playerButton"
                          type="button"
                          onClick={() => handleExportExternalUnknownWordsCsv(item)}
                          disabled={!item.subtitle}
                        >
                          CSV出力
                        </button>
                        <button
                          className="playerButton"
                          type="button"
                          onClick={() => handleOpenExternalSubtitleReview(item)}
                          disabled={!item.subtitle}
                        >
                          字幕復習
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
            </div>
          )
        ) : (
          <section className="videoStage">
            <>
              <video
                ref={mainVideoRef}
                className="mainVideo"
                src={mainVideoUrl}
                controls
              />
              {nativeAudioUrl ? (
                <video
                  ref={nativeAudioRef}
                  src={nativeAudioUrl}
                  style={{ display: 'none' }}
                  playsInline
                />
              ) : null}
              <OverlayApp
                initialSubtitleCues={activeSession.session.subtitleCues}
                initialSubtitleFileName={activeSession.session.subtitleFileName}
                initialTypingFrames={activeSession.session.typingFrames}
                initialTypingProgress={activeSession.typingProgress}
                displaySubtitleCues={activeSession.session.nativeSubtitleCues}
                displaySubtitleFileName={activeSession.session.nativeSubtitleFileName}
                onFrameMistake={handleFrameMistake}
                onFrameCompleted={handleFrameCompleted}
                pageUrl={activeSession.storageKey}
                shadowRoot={document.head}
                targetId={targetId}
                typeReviewMode={activeSession.typeReviewMode}
              />
            </>
          </section>
        )}
      </div>
    </main>
  );
}

interface FileHandlePickerProps {
  label: string;
  handle: FileSystemFileHandle | null;
  pickerTypes: OpenFilePickerAcceptType[];
  optional?: boolean;
  onError: (message: string) => void;
  onPick: (handle: FileSystemFileHandle | null) => void;
}

interface SubtitleReviewViewProps {
  title: string;
  reviewFrames: ReviewFrame[];
  onBack: () => void;
}

function SubtitleReviewView({ title, reviewFrames, onBack }: SubtitleReviewViewProps) {
  return (
    <section className="playerPanel subtitleReviewPanel">
      <div className="subtitleReviewHeader">
        <div>
          <h2>字幕復習</h2>
          <p>{title}</p>
        </div>
        <button className="playerButton" type="button" onClick={onBack}>
          Back to history
        </button>
      </div>
      <div className="subtitleReviewList">
        {reviewFrames.map((reviewFrame, index) => (
          <SubtitleReviewCue
            key={reviewFrame.frame.id}
            index={index}
            reviewFrame={reviewFrame}
          />
        ))}
      </div>
    </section>
  );
}

function SubtitleReviewCue({ index, reviewFrame }: { index: number; reviewFrame: ReviewFrame }) {
  const frame: CaptionFrame = {
    ...reviewFrame.frame,
    tags: reviewFrame.tags,
  };
  const finishedCharIds = new Set(reviewFrame.finishedCharIds);
  const gameChars: GameChar[] = frame.caption.map((char) => ({
    char,
    input: char.char,
    status: char.isTypeable && finishedCharIds.has(char.id) ? 'finished' : 'wait',
  }));
  const rows = splitReviewGameCharsIntoRows(gameChars);

  return (
    <article className="subtitleReviewCue">
      <div className="subtitleReviewMeta">
        <strong>#{index + 1}</strong>
        <span>{formatCueTime(reviewFrame.cue.start)} - {formatCueTime(reviewFrame.cue.end)}</span>
      </div>
      <div className="subtitleReviewTyping">
        {rows.map((chars, rowIndex) => (
          <Line
            key={chars[0]?.char.id || `review-line-${rowIndex}`}
            chars={chars}
            tags={frame.tags}
            onTaggedCharClick={() => undefined}
          />
        ))}
      </div>
      <div className="subtitleReviewText">{reviewFrame.cue.text}</div>
    </article>
  );
}

function FileHandlePicker({
  label,
  handle,
  pickerTypes,
  optional,
  onError,
  onPick,
}: FileHandlePickerProps) {
  return (
    <label className="fileRow">
      <span>{label}{optional ? ' (optional)' : ''}</span>
      <div className="fileValue">{handle?.name || 'No file selected'}</div>
      <div className="playerActions">
        <button
          className="playerButton"
          type="button"
          onClick={async () => {
            try {
              const nextHandle = await pickFileHandle(pickerTypes);
              if (nextHandle) {
                onPick(nextHandle);
              }
            } catch (error) {
              if (error instanceof DOMException && error.name === 'AbortError') {
                return;
              }
              onError('Failed to choose file.');
            }
          }}
        >
          Choose
        </button>
        {optional ? (
          <button className="playerButton" type="button" onClick={() => onPick(null)}>
            Clear
          </button>
        ) : null}
      </div>
    </label>
  );
}

async function pickFileHandle(types: OpenFilePickerAcceptType[]) {
  if (!window.showOpenFilePicker) {
    throw new Error('File System Access API is not available.');
  }

  const handles = await window.showOpenFilePicker({
    multiple: false,
    excludeAcceptAllOption: false,
    types,
  });

  return handles[0] || null;
}

async function readTypingSubtitleData(
  subtitleFile: File,
  subtitleText: string,
  sourceSubtitleHandle: FileSystemFileHandle | null,
  setStatus: (message: string) => void,
): Promise<{
  subtitleFileName: string;
  subtitleCues: SubtitleCue[];
  typingFrames?: TimedCaptionFrame[];
}> {
  if (!isChineseTypingJsonFile(subtitleFile.name)) {
    return {
      subtitleFileName: subtitleFile.name,
      subtitleCues: parseSubtitleFile(subtitleFile.name, subtitleText),
    };
  }

  setStatus('Reading Chinese typing JSON...');
  const chineseTypingJson = parseChineseTypingJson(subtitleFile.name, subtitleText);

  if (!sourceSubtitleHandle) {
    throw new Error('Original subtitle file is required.');
  }

  setStatus('Reading original Chinese subtitle...');
  const sourceSubtitleFile = await sourceSubtitleHandle.getFile();
  const sourceSubtitleText = await sourceSubtitleFile.text();
  const sourceCues = parseSubtitleFile(sourceSubtitleFile.name, sourceSubtitleText);

  return {
    subtitleFileName: sourceSubtitleFile.name,
    subtitleCues: sourceCues,
    typingFrames: chineseTypingJson.typingFrames,
  };
}

function getRouteSessionId() {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('session');
}

function getResumePlaybackPosition(
  session: StoredLocalPlayerSession,
  typingProgress: StoredTypingProgressData,
) {
  let latestCueByUpdate: SubtitleCue | null = null;
  let latestUpdatedAt = Number.NEGATIVE_INFINITY;
  const frames = session.typingFrames || session.subtitleCues.map((cue) => ({
    ...subtitleCueToCaptionFrame(cue),
    start: cue.start,
    end: cue.end,
  }));

  for (const frame of frames) {
    const progress = typingProgress[frame.id];

    if (typeof progress?.updatedAt === 'number' && progress.updatedAt >= latestUpdatedAt) {
      latestUpdatedAt = progress.updatedAt;
      latestCueByUpdate = {
        start: frame.start,
        end: frame.end,
        text: '',
      };
    }
  }

  return latestCueByUpdate?.start;
}

function summarizeSessionProgress(
  session: StoredLocalPlayerSession,
  typingProgress: StoredTypingProgressData,
) {
  return summarizeProgress(session.subtitleCues, typingProgress, session.typingFrames);
}

function summarizeExternalHistoryItem(item: ExternalHistoryItem) {
  if (!item.subtitle) {
    return 'Subtitle setting removed';
  }

  return summarizeProgress(item.subtitle.cues, item.typingProgress, item.subtitle.typingFrames);
}

function summarizeProgress(
  subtitleCues: SubtitleCue[],
  typingProgress: StoredTypingProgressData,
  typingFrames?: TimedCaptionFrame[],
) {
  const frames = typingFrames || subtitleCues.map((cue) => ({
    ...subtitleCueToCaptionFrame(cue),
    start: cue.start,
    end: cue.end,
  }));
  const completed = frames.filter((frame) => {
    const typeableCount = frame.caption.filter((char) => char.isTypeable).length;
    const progress = typingProgress[frame.id];

    return typeableCount > 0 && (progress?.finishedCharIds.length || 0) >= typeableCount;
  }).length;

  return `${completed.toLocaleString()} / ${frames.length.toLocaleString()} subtitles completed`;
}

function formatHistoryDate(timestamp: number) {
  if (!timestamp) {
    return 'No activity timestamp';
  }

  return new Date(timestamp).toLocaleString();
}

function formatCueTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return '0:00.000';
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - minutes * 60;

  return `${minutes}:${remainingSeconds.toFixed(3).padStart(6, '0')}`;
}

function sanitizeFileName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'video-typing';
}

function downloadUnknownWordsCsv(title: string, rows: ReturnType<typeof createUnknownWordCsvRows>) {
  const csv = createUnknownWordCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `${sanitizeFileName(title)}-unknown-words.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function splitReviewGameCharsIntoRows(gameChars: GameChar[]) {
  const columnsPerLine = 50;
  const rows: GameChar[][] = [[]];

  for (const char of gameChars) {
    let currentRow = rows[rows.length - 1];

    if (char.char.char !== '\n' && currentRow.length >= columnsPerLine) {
      currentRow = [];
      rows.push(currentRow);
    }

    currentRow.push(char);

    if (char.char.char === '\n') {
      rows.push([]);
    }
  }

  return rows;
}

function waitForMediaTime(media: HTMLMediaElement, endTime: number) {
  return new Promise<void>((resolve) => {
    const cleanup = () => {
      media.removeEventListener('timeupdate', handleTimeUpdate);
      media.removeEventListener('ended', handleEnded);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const handleTimeUpdate = () => {
      if (media.currentTime >= endTime) {
        finish();
      }
    };
    const handleEnded = () => finish();

    media.addEventListener('timeupdate', handleTimeUpdate);
    media.addEventListener('ended', handleEnded, { once: true });
    handleTimeUpdate();
  });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<PlayerApp />);
