import '../src/styles/overlay.css';
import ReactDOM from 'react-dom/client';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { OverlayApp } from '../src/components/OverlayApp';
import {
  createPlaybackPositionStorageKey,
  loadStoredPlaybackPosition,
  loadStoredSubtitle,
  loadStoredTypingProgress,
  saveExternalHistoryMeta,
  saveStoredPlaybackPosition,
  saveStoredSubtitle,
} from '../src/lib/storage';
import { isChineseTypingJsonFile, parseChineseTypingJson } from '../src/lib/chineseTyping';
import {
  buildStoredSubtitleTypeReviewFrames,
  createTypeReviewTypingProgress,
} from '../src/lib/localPlayerReview';
import {
  fetchNetflixSubtitle,
  getNetflixTrackList,
  isNetflixHostname,
  replayNetflixNativeAudio,
  setNetflixAudioTrack,
  type NetflixTrackListResponse,
  type NetflixTrackOption,
} from '../src/lib/netflixSeek';
import { parseSubtitleFile, subtitleCueToCaptionFrame } from '../src/lib/subtitles';
import { showToast } from '../src/lib/toast';
import { seekVideo } from '../src/lib/video';
import type { StoredSubtitleData } from '../src/types';

const OVERLAY_KEY = '__videoTypingPrototypeOverlay__';
const VIDEO_ATTR = 'data-video-typing-target-id';
const VIDEO_PLAYBACK_STORAGE_KEY_ATTR = 'data-video-typing-playback-storage-key';
const SUBTITLE_ACCEPT = '.srt,.vtt,.ttml,.xml,.txt,.json';
const SOURCE_SUBTITLE_ACCEPT = '.srt,.vtt,.ttml,.xml,.txt';

interface LoadedSubtitleFile {
  cues: StoredSubtitleData['cues'];
  fileName: string;
  typingFrames?: StoredSubtitleData['typingFrames'];
  displaySubtitleFileName?: StoredSubtitleData['displaySubtitleFileName'];
  displaySubtitleCues?: StoredSubtitleData['displaySubtitleCues'];
  netflix?: StoredSubtitleData['netflix'];
}

declare global {
  interface Window {
    __videoTypingPrototypeOverlay__?: {
      remove: () => void;
    };
    __videoTypingPrototypeLaunchOptions__?: {
      mode?: 'typing' | 'type-review';
    };
  }
}

export default defineContentScript({
  registration: 'runtime',
  cssInjectionMode: 'ui',
  async main(ctx: any) {
    const launchOptions = window.__videoTypingPrototypeLaunchOptions__ || {};
    delete window.__videoTypingPrototypeLaunchOptions__;

    const video = document.querySelector('video');
    const pageUrl = window.location.href;
    const isNetflixPage = isNetflixHostname(window.location.hostname);
    const requestedTypeReviewMode = launchOptions.mode === 'type-review';

    if (!video) {
      showToast('No video tag found on this page.');
      return;
    }

    const playbackStorageKey = createPlaybackPositionStorageKey(
      pageUrl,
      requestedTypeReviewMode ? 'type-review' : 'typing',
    );
    const storedPlaybackPosition = await loadStoredPlaybackPosition(playbackStorageKey);
    const storedSubtitle = await loadStoredSubtitle(pageUrl);
    const storedTypingProgress = await loadStoredTypingProgress(pageUrl);
    let subtitleFile = storedSubtitle || await requestSubtitleFile({ allowNetflixAuto: isNetflixPage });
    let typingProgress = storedTypingProgress;
    let typeReviewMode = false;

    if (!subtitleFile) {
      showToast('Subtitle file is required. Overlay was not started.');
      return;
    }

    let storedSubtitleForUpdates = storedSubtitle || subtitleFile;

    if (requestedTypeReviewMode) {
      if (!storedSubtitle) {
        showToast('Stored subtitle data is required for review game.');
        return;
      }

      const typeReviewFrames = buildStoredSubtitleTypeReviewFrames(storedSubtitle, storedTypingProgress);

      if (typeReviewFrames.length === 0) {
        showToast('No ignorance or unaudible cues to review.');
        return;
      }

      subtitleFile = {
        ...storedSubtitle,
        cues: typeReviewFrames.map((reviewFrame) => reviewFrame.cue),
        typingFrames: typeReviewFrames.map((reviewFrame) => ({
          ...reviewFrame.frame,
          tags: reviewFrame.tags,
        })),
        displaySubtitleCues: undefined,
        displaySubtitleFileName: undefined,
      };
      typingProgress = createTypeReviewTypingProgress(typeReviewFrames);
      typeReviewMode = true;
    }

    await saveExternalHistoryMeta(pageUrl, {
      title: document.title || pageUrl,
      updatedAt: Date.now(),
    });

    if (!storedSubtitle) {
      await saveStoredSubtitle(pageUrl, subtitleFile);
    }

    const previousTargetId = video.getAttribute(VIDEO_ATTR);
    if (previousTargetId) {
      const previousPlaybackStorageKey = video.getAttribute(VIDEO_PLAYBACK_STORAGE_KEY_ATTR) || pageUrl;
      await saveStoredPlaybackPosition(previousPlaybackStorageKey, video.currentTime);
    }

    window[OVERLAY_KEY]?.remove();

    const targetId = `video-typing-${Date.now()}`;
    video.setAttribute(VIDEO_ATTR, targetId);
    video.setAttribute(VIDEO_PLAYBACK_STORAGE_KEY_ATTR, playbackStorageKey);
    if (subtitleFile.netflix?.englishAudioTrackId) {
      void setNetflixAudioTrack(subtitleFile.netflix.englishAudioTrackId).catch(() => undefined);
    }
    await restorePlaybackPosition(
      video,
      targetId,
      typeReviewMode
        ? storedPlaybackPosition?.currentTime ?? subtitleFile.cues[0]?.start
        : getResumePlaybackPosition(subtitleFile, storedTypingProgress) ?? storedPlaybackPosition?.currentTime,
    );

    const ui = await createShadowRootUi(ctx, {
      name: 'video-typing-overlay',
      position: 'inline',
      anchor: 'body',
      onMount: (container) => {
        const app = document.createElement('div');
        app.className = 'video-typing-ui-root';
        container.append(app);

        const root = ReactDOM.createRoot(app);
        root.render(
          <OverlayApp
            initialSubtitleCues={subtitleFile.cues}
            initialSubtitleFileName={subtitleFile.fileName}
            initialTypingFrames={subtitleFile.typingFrames}
            initialTypingProgress={typingProgress}
            displaySubtitleCues={subtitleFile.displaySubtitleCues}
            displaySubtitleFileName={subtitleFile.displaySubtitleFileName}
            onNativeCueReplay={(cue) => replayNetflixNativeCue(subtitleFile, cue)}
            onDisplaySubtitleChange={async (fileName, cues) => {
              storedSubtitleForUpdates = {
                ...storedSubtitleForUpdates,
                displaySubtitleFileName: fileName,
                displaySubtitleCues: cues,
              };
              subtitleFile = {
                ...subtitleFile,
                displaySubtitleFileName: fileName,
                displaySubtitleCues: cues,
              };
              await saveStoredSubtitle(pageUrl, storedSubtitleForUpdates);
            }}
            pageUrl={pageUrl}
            playbackStorageKey={playbackStorageKey}
            shadowRoot={container.getRootNode() as ShadowRoot}
            targetId={targetId}
            typeReviewMode={typeReviewMode}
          />,
        );
        return root;
      },
      onRemove: (root) => {
        root?.unmount();
      },
    });

    const persistExternalHistoryMeta = () => {
      void saveExternalHistoryMeta(pageUrl, {
        title: document.title || pageUrl,
        updatedAt: Date.now(),
      });
    };

    window[OVERLAY_KEY] = {
      remove: () => {
        window.removeEventListener('pagehide', persistExternalHistoryMeta);
        ui.remove();
      },
    };

    ui.mount();

    window.addEventListener('pagehide', persistExternalHistoryMeta, { once: true });
  },
});

async function requestSubtitleFile(options?: { allowNetflixAuto?: boolean }): Promise<LoadedSubtitleFile | null> {
  const selection = await selectSubtitleSource(options);

  if (!selection) {
    return null;
  }

  if (selection === 'netflix-auto') {
    return requestNetflixAutoSubtitleFile();
  }

  const file = selection;

  try {
    const text = await file.text();

    if (isChineseTypingJsonFile(file.name)) {
      return await requestChineseTypingJsonFiles(file.name, text);
    }

    const cues = parseSubtitleFile(file.name, text);

    if (cues.length === 0) {
      return null;
    }

    return {
      cues,
      fileName: file.name,
    };
  } catch {
    return null;
  }
}

async function requestNetflixAutoSubtitleFile(): Promise<LoadedSubtitleFile | null> {
  let progressPanel = createSubtitleImportProgressPanel();

  try {
    progressPanel.setMessage('Loading Netflix subtitle and audio tracks...');
    const tracks = await getNetflixTrackList();
    progressPanel.remove();
    const selectedTracks = await selectNetflixTracks(tracks);

    if (!selectedTracks) {
      return null;
    }

    progressPanel = createSubtitleImportProgressPanel();
    progressPanel.setMessage('Downloading English subtitle...');
    const englishSubtitle = await fetchNetflixSubtitle(selectedTracks.englishSubtitleTrackId);
    const englishCues = parseSubtitleFile(englishSubtitle.fileName, englishSubtitle.text);

    if (englishCues.length === 0) {
      return null;
    }

    let nativeSubtitleFileName: string | undefined;
    let nativeSubtitleCues: StoredSubtitleData['displaySubtitleCues'];

    if (selectedTracks.nativeSubtitleTrackId) {
      progressPanel.setMessage('Downloading native subtitle...');
      const nativeSubtitle = await fetchNetflixSubtitle(selectedTracks.nativeSubtitleTrackId);
      const parsedNativeCues = parseSubtitleFile(nativeSubtitle.fileName, nativeSubtitle.text);

      if (parsedNativeCues.length > 0) {
        nativeSubtitleFileName = nativeSubtitle.fileName;
        nativeSubtitleCues = parsedNativeCues;
      }
    }

    progressPanel.setMessage('Netflix tracks loaded.');
    return {
      cues: englishCues,
      fileName: englishSubtitle.fileName,
      displaySubtitleFileName: nativeSubtitleFileName,
      displaySubtitleCues: nativeSubtitleCues,
      netflix: selectedTracks,
    };
  } catch (error) {
    console.warn('[video-typing] Netflix auto subtitle setup failed.', error);
    showToast('Netflix auto setup failed. Choose a subtitle file instead.');
    return null;
  } finally {
    progressPanel.remove();
  }
}

async function requestChineseTypingJsonFiles(fileName: string, text: string): Promise<LoadedSubtitleFile | null> {
  const progressPanel = createSubtitleImportProgressPanel();

  try {
    progressPanel.setMessage('Reading Chinese typing JSON...');
    const chineseTypingJson = parseChineseTypingJson(fileName, text);

    progressPanel.setMessage('Choose the original Chinese subtitle file.');
    const sourceSubtitleFile = await selectSubtitleFile({
      title: 'Original subtitle required',
      description: 'Choose the original Chinese subtitle file for the Subtitle window.',
      accept: SOURCE_SUBTITLE_ACCEPT,
    });

    if (!sourceSubtitleFile) {
      return null;
    }

    progressPanel.setMessage('Parsing original subtitle...');
    const sourceText = await sourceSubtitleFile.text();
    const sourceCues = parseSubtitleFile(sourceSubtitleFile.name, sourceText);

    if (sourceCues.length === 0) {
      return null;
    }

    progressPanel.setMessage('Chinese typing data loaded.');
    return {
      cues: sourceCues,
      fileName: sourceSubtitleFile.name,
      typingFrames: chineseTypingJson.typingFrames,
    };
  } catch {
    return null;
  } finally {
    progressPanel.remove();
  }
}

async function restorePlaybackPosition(video: HTMLVideoElement, targetId: string, currentTime?: number) {
  if (currentTime == null || !Number.isFinite(currentTime)) {
    return;
  }

  const apply = () => {
    const duration = Number.isFinite(video.duration) ? video.duration : currentTime;
    seekVideo(targetId, Math.min(currentTime, duration));
  };

  if (video.readyState >= 1) {
    apply();
    return;
  }

  await new Promise<void>((resolve) => {
    const onLoadedMetadata = () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      apply();
      resolve();
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
  });
}

function getResumePlaybackPosition(
  subtitle: StoredSubtitleData,
  typingProgress: Awaited<ReturnType<typeof loadStoredTypingProgress>>,
) {
  let latestStartByUpdate: number | null = null;
  let latestUpdatedAt = Number.NEGATIVE_INFINITY;
  let latestStartByOrder: number | null = null;
  const frames = subtitle.typingFrames || subtitle.cues.map((cue) => ({
    ...subtitleCueToCaptionFrame(cue),
    start: cue.start,
    end: cue.end,
  }));

  for (const frame of frames) {
    const progress = typingProgress[frame.id];

    if (!progress) {
      continue;
    }

    if (progress.finishedCharIds.length > 0 || progress.tags.length > 0 || typeof progress.updatedAt === 'number') {
      latestStartByOrder = frame.start;
    }

    if (typeof progress.updatedAt === 'number' && progress.updatedAt >= latestUpdatedAt) {
      latestUpdatedAt = progress.updatedAt;
      latestStartByUpdate = frame.start;
    }
  }

  return latestStartByUpdate ?? latestStartByOrder ?? undefined;
}

function replayNetflixNativeCue(subtitleFile: LoadedSubtitleFile, cue: StoredSubtitleData['cues'][number]) {
  const englishAudioTrackId = subtitleFile.netflix?.englishAudioTrackId;
  const nativeAudioTrackId = subtitleFile.netflix?.nativeAudioTrackId;

  if (!englishAudioTrackId || !nativeAudioTrackId) {
    return Promise.resolve();
  }

  return replayNetflixNativeAudio(
    englishAudioTrackId,
    nativeAudioTrackId,
    cue.start,
    cue.end,
  ).catch(() => undefined);
}

async function selectSubtitleFile(options?: {
  title?: string;
  description?: string;
  accept?: string;
}) {
  const selection = await selectSubtitleSource(options);
  return selection instanceof File ? selection : null;
}

type SubtitleSourceSelection = File | 'netflix-auto' | null;

function selectSubtitleSource(options?: {
  title?: string;
  description?: string;
  accept?: string;
  allowNetflixAuto?: boolean;
}): Promise<SubtitleSourceSelection> {
  return new Promise((resolve) => {
    const panel = document.createElement('div');
    const title = document.createElement('div');
    const description = document.createElement('div');
    const actions = document.createElement('div');
    const chooseButton = document.createElement('button');
    const netflixAutoButton = document.createElement('button');
    const cancelButton = document.createElement('button');
    const input = document.createElement('input');
    let settled = false;
    let waitingForPicker = false;

    const cleanup = () => {
      settled = true;
      window.removeEventListener('focus', handleWindowFocus);
      panel.remove();
    };

    const finish = (file: File | null) => {
      if (settled) {
        return;
      }

      cleanup();
      resolve(file);
    };

    const finishWithNetflixAuto = () => {
      if (settled) {
        return;
      }

      cleanup();
      resolve('netflix-auto');
    };

    const handleWindowFocus = () => {
      window.setTimeout(() => {
        if (waitingForPicker && !input.files?.length) {
          finish(null);
        }
      }, 250);
    };

    input.type = 'file';
    input.accept = options?.accept || SUBTITLE_ACCEPT;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      waitingForPicker = false;
      finish(input.files?.[0] || null);
    });

    title.textContent = options?.title || 'Subtitle file required';
    description.textContent = options?.description || 'Click "Choose file" below to open the subtitle picker and start video-typing.';
    chooseButton.textContent = 'Choose file';
    netflixAutoButton.textContent = 'Auto fetch';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => finish(null));
    netflixAutoButton.addEventListener('click', finishWithNetflixAuto);
    chooseButton.addEventListener('click', () => {
      waitingForPicker = true;
      window.addEventListener('focus', handleWindowFocus, { once: true });
      input.click();
    });

    Object.assign(panel.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '2147483647',
      width: '320px',
      padding: '14px',
      borderRadius: '10px',
      background: 'rgba(30, 36, 45, 0.98)',
      color: '#fff',
      fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
    });
    Object.assign(title.style, {
      fontSize: '14px',
      fontWeight: '700',
      marginBottom: '6px',
    });
    Object.assign(description.style, {
      fontSize: '12px',
      lineHeight: '1.45',
      marginBottom: '12px',
      opacity: '0.85',
    });
    Object.assign(actions.style, {
      display: 'flex',
      gap: '8px',
    });
    Object.assign(chooseButton.style, {
      display: 'inline-flex',
      cursor: 'pointer',
      padding: '7px 10px',
      border: 'none',
      borderRadius: '8px',
      background: '#ffffff',
      color: '#1e242d',
      fontSize: '12px',
      fontWeight: '700',
    });
    Object.assign(netflixAutoButton.style, {
      display: options?.allowNetflixAuto ? 'inline-flex' : 'none',
      cursor: 'pointer',
      padding: '7px 10px',
      border: 'none',
      borderRadius: '8px',
      background: '#46d369',
      color: '#102016',
      fontSize: '12px',
      fontWeight: '700',
    });
    Object.assign(cancelButton.style, {
      cursor: 'pointer',
      padding: '7px 10px',
      border: '1px solid rgba(255,255,255,0.35)',
      borderRadius: '8px',
      background: 'transparent',
      color: '#ffffff',
      fontSize: '12px',
    });

    actions.append(chooseButton, netflixAutoButton, cancelButton);
    panel.append(title, description, actions, input);
    document.body.append(panel);
  });
}

function selectNetflixTracks(tracks: NetflixTrackListResponse) {
  return new Promise<NonNullable<StoredSubtitleData['netflix']> | null>((resolve) => {
    const panel = document.createElement('div');
    const title = document.createElement('div');
    const description = document.createElement('div');
    const form = document.createElement('div');
    const englishSubtitleSelect = createTrackSelect(tracks.subtitles, false);
    const nativeSubtitleSelect = createTrackSelect(tracks.subtitles, true);
    const englishAudioSelect = createTrackSelect(tracks.audios, false);
    const nativeAudioSelect = createTrackSelect(tracks.audios, true);
    const actions = document.createElement('div');
    const startButton = document.createElement('button');
    const cancelButton = document.createElement('button');

    const englishSubtitleDefault = findPreferredTrack(tracks.subtitles, 'english') || tracks.subtitles[0];
    const englishAudioDefault = findPreferredTrack(tracks.audios, 'english') || tracks.audios[0];

    if (englishSubtitleDefault) {
      englishSubtitleSelect.value = englishSubtitleDefault.id;
    }

    if (englishAudioDefault) {
      englishAudioSelect.value = englishAudioDefault.id;
    }

    const cleanup = () => {
      panel.remove();
    };

    const finish = (value: NonNullable<StoredSubtitleData['netflix']> | null) => {
      cleanup();
      resolve(value);
    };

    title.textContent = 'Netflix auto setup';
    description.textContent = 'Choose the Netflix subtitle and audio tracks to use with video-typing.';
    startButton.textContent = 'Start';
    cancelButton.textContent = 'Cancel';
    startButton.disabled = !englishSubtitleSelect.value || !englishAudioSelect.value;
    startButton.addEventListener('click', () => {
      if (!englishSubtitleSelect.value || !englishAudioSelect.value) {
        return;
      }

      finish({
        englishSubtitleTrackId: englishSubtitleSelect.value,
        nativeSubtitleTrackId: nativeSubtitleSelect.value || undefined,
        englishAudioTrackId: englishAudioSelect.value,
        nativeAudioTrackId: nativeAudioSelect.value || undefined,
      });
    });
    cancelButton.addEventListener('click', () => finish(null));

    form.append(
      createSelectRow('English subtitle', englishSubtitleSelect),
      createSelectRow('Native subtitle (optional)', nativeSubtitleSelect),
      createSelectRow('English audio', englishAudioSelect),
      createSelectRow('Native audio (optional)', nativeAudioSelect),
    );
    actions.append(startButton, cancelButton);
    panel.append(title, description, form, actions);

    Object.assign(panel.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '2147483647',
      width: '360px',
      padding: '14px',
      borderRadius: '10px',
      background: 'rgba(30, 36, 45, 0.98)',
      color: '#fff',
      fontFamily: 'system-ui, sans-serif',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
    });
    Object.assign(title.style, {
      fontSize: '14px',
      fontWeight: '700',
      marginBottom: '6px',
    });
    Object.assign(description.style, {
      fontSize: '12px',
      lineHeight: '1.45',
      marginBottom: '12px',
      opacity: '0.85',
    });
    Object.assign(form.style, {
      display: 'grid',
      gap: '10px',
      marginBottom: '12px',
    });
    Object.assign(actions.style, {
      display: 'flex',
      gap: '8px',
    });
    Object.assign(startButton.style, {
      cursor: 'pointer',
      padding: '7px 10px',
      border: 'none',
      borderRadius: '8px',
      background: '#ffffff',
      color: '#1e242d',
      fontSize: '12px',
      fontWeight: '700',
    });
    Object.assign(cancelButton.style, {
      cursor: 'pointer',
      padding: '7px 10px',
      border: '1px solid rgba(255,255,255,0.35)',
      borderRadius: '8px',
      background: 'transparent',
      color: '#ffffff',
      fontSize: '12px',
    });

    document.body.append(panel);
  });
}

function createTrackSelect(tracks: NetflixTrackOption[], optional: boolean) {
  const select = document.createElement('select');

  if (optional) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'None';
    select.append(option);
  }

  for (const track of tracks) {
    const option = document.createElement('option');
    option.value = track.id;
    option.textContent = formatTrackLabel(track);
    select.append(option);
  }

  Object.assign(select.style, {
    width: '100%',
    boxSizing: 'border-box',
    padding: '7px 8px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.25)',
    background: '#162229',
    color: '#ffffff',
    fontSize: '12px',
  });

  return select;
}

function createSelectRow(labelText: string, select: HTMLSelectElement) {
  const label = document.createElement('label');
  const text = document.createElement('span');

  text.textContent = labelText;
  Object.assign(text.style, {
    display: 'block',
    fontSize: '12px',
    fontWeight: '700',
    marginBottom: '4px',
  });
  label.append(text, select);
  return label;
}

function findPreferredTrack(tracks: NetflixTrackOption[], language: string) {
  const normalizedLanguage = language.toLowerCase();
  return tracks.find((track) => (
    normalizeTrackText(track.bcp47).startsWith(normalizedLanguage.slice(0, 2)) ||
    normalizeTrackText(track.language).startsWith(normalizedLanguage.slice(0, 2)) ||
    normalizeTrackText(track.displayName).includes(normalizedLanguage)
  ));
}

function formatTrackLabel(track: NetflixTrackOption) {
  const parts = [
    track.displayName,
    track.bcp47 || track.language,
    track.trackType,
    track.isClosedCaptions ? 'CC' : '',
    track.isForcedNarrative ? 'Forced' : '',
  ].filter(Boolean);
  return parts.join(' / ');
}

function normalizeTrackText(value: string | undefined) {
  return (value || '').trim().toLowerCase();
}

function createSubtitleImportProgressPanel() {
  const panel = document.createElement('div');
  const title = document.createElement('div');
  const message = document.createElement('div');

  title.textContent = 'Processing subtitle';
  message.textContent = 'Starting...';

  Object.assign(panel.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '2147483647',
    width: '320px',
    padding: '14px',
    borderRadius: '10px',
    background: 'rgba(30, 36, 45, 0.98)',
    color: '#fff',
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
  });
  Object.assign(title.style, {
    fontSize: '14px',
    fontWeight: '700',
    marginBottom: '6px',
  });
  Object.assign(message.style, {
    fontSize: '12px',
    lineHeight: '1.45',
    opacity: '0.85',
  });

  panel.append(title, message);
  document.body.append(panel);

  return {
    setMessage(nextMessage: string) {
      message.textContent = nextMessage;
    },
    remove() {
      panel.remove();
    },
  };
}
