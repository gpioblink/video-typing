import '../src/styles/overlay.css';
import ReactDOM from 'react-dom/client';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { OverlayApp } from '../src/components/OverlayApp';
import {
  loadStoredPlaybackPosition,
  loadStoredSubtitle,
  loadStoredTypingProgress,
  saveExternalHistoryMeta,
  saveStoredPlaybackPosition,
  saveStoredSubtitle,
} from '../src/lib/storage';
import { isChineseTypingJsonFile, parseChineseTypingJson } from '../src/lib/chineseTyping';
import { parseSubtitleFile, subtitleCueToCaptionFrame } from '../src/lib/subtitles';
import { showToast } from '../src/lib/toast';
import type { StoredSubtitleData } from '../src/types';

const OVERLAY_KEY = '__videoTypingPrototypeOverlay__';
const VIDEO_ATTR = 'data-video-typing-target-id';
const SUBTITLE_ACCEPT = '.srt,.vtt,.ttml,.xml,.txt,.json';
const SOURCE_SUBTITLE_ACCEPT = '.srt,.vtt,.ttml,.xml,.txt';

interface LoadedSubtitleFile {
  cues: StoredSubtitleData['cues'];
  fileName: string;
  typingFrames?: StoredSubtitleData['typingFrames'];
}

declare global {
  interface Window {
    __videoTypingPrototypeOverlay__?: {
      remove: () => void;
    };
  }
}

export default defineContentScript({
  registration: 'runtime',
  cssInjectionMode: 'ui',
  async main(ctx: any) {
    const video = document.querySelector('video');
    const pageUrl = window.location.href;

    if (!video) {
      showToast('No video tag found on this page.');
      return;
    }

    const storedPlaybackPosition = await loadStoredPlaybackPosition(pageUrl);
    const storedSubtitle = await loadStoredSubtitle(pageUrl);
    const storedTypingProgress = await loadStoredTypingProgress(pageUrl);
    const subtitleFile = storedSubtitle || await requestSubtitleFile();

    if (!subtitleFile) {
      showToast('Subtitle file is required. Overlay was not started.');
      return;
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
      await saveStoredPlaybackPosition(pageUrl, video.currentTime);
    }

    window[OVERLAY_KEY]?.remove();

    const targetId = `video-typing-${Date.now()}`;
    video.setAttribute(VIDEO_ATTR, targetId);
    await restorePlaybackPosition(
      video,
      getResumePlaybackPosition(subtitleFile, storedTypingProgress) ?? storedPlaybackPosition?.currentTime,
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
            initialTypingProgress={storedTypingProgress}
            pageUrl={pageUrl}
            shadowRoot={container.getRootNode() as ShadowRoot}
            targetId={targetId}
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

async function requestSubtitleFile(): Promise<LoadedSubtitleFile | null> {
  const file = await selectSubtitleFile();

  if (!file) {
    return null;
  }

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

async function restorePlaybackPosition(video: HTMLVideoElement, currentTime?: number) {
  if (currentTime == null || !Number.isFinite(currentTime)) {
    return;
  }

  const apply = () => {
    const duration = Number.isFinite(video.duration) ? video.duration : currentTime;
    video.currentTime = Math.max(0, Math.min(currentTime, duration));
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

function selectSubtitleFile(options?: {
  title?: string;
  description?: string;
  accept?: string;
}): Promise<File | null> {
  return new Promise((resolve) => {
    const panel = document.createElement('div');
    const title = document.createElement('div');
    const description = document.createElement('div');
    const actions = document.createElement('div');
    const chooseButton = document.createElement('button');
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
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => finish(null));
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
    Object.assign(cancelButton.style, {
      cursor: 'pointer',
      padding: '7px 10px',
      border: '1px solid rgba(255,255,255,0.35)',
      borderRadius: '8px',
      background: 'transparent',
      color: '#ffffff',
      fontSize: '12px',
    });

    actions.append(chooseButton, cancelButton);
    panel.append(title, description, actions, input);
    document.body.append(panel);
  });
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
