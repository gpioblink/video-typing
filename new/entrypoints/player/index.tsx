import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { OverlayApp } from '../../src/components/OverlayApp';
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
import { parseSubtitleFile, subtitleCueToCaptionFrame } from '../../src/lib/subtitles';
import type {
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

  const startStoredSession = async (session: StoredLocalPlayerSession) => {
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
    const [typingProgress, playbackPosition] = await Promise.all([
      loadStoredTypingProgress(storageKey),
      loadStoredPlaybackPosition(storageKey),
    ]);

    replaceObjectUrls(mainVideoFile, nativeAudioFile);
    setActiveSession({
      session,
      mainVideoFile,
      nativeAudioFile,
      storageKey,
      typingProgress,
      initialTime: getResumePlaybackPosition(session, typingProgress) ?? playbackPosition?.currentTime,
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
      const previousNativePlaybackRate = nativeVideo.playbackRate;
      mainVideo.muted = true;
      mainVideo.currentTime = Math.max(0, cue.start);
      nativeVideo.pause();
      nativeVideo.currentTime = Math.max(0, cue.start);
      nativeVideo.playbackRate = mainVideo.playbackRate;

      try {
        await Promise.all([
          mainVideo.play().catch(() => undefined),
          nativeVideo.play(),
        ]);
        await waitForMediaTime(nativeVideo, cue.end);
      } finally {
        nativeVideo.pause();
        nativeVideo.playbackRate = previousNativePlaybackRate;
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
      void replayNativeCue(cue);
    }
  }, [replayNativeCue]);

  const handleFrameCompleted = useCallback(async (cue: SubtitleCue) => {
    if (activeSession) {
      await touchLocalPlayerSession(activeSession.session.id);
      refreshSessions();
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
                ? activeSession.session.subtitleFileName
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
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>
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
