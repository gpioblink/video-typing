import '../src/styles/overlay.css';
import ReactDOM from 'react-dom/client';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { OverlayApp } from '../src/components/OverlayApp';
import {
  loadStoredSubtitle,
  loadStoredTypingProgress,
  saveStoredSubtitle,
} from '../src/lib/storage';
import { parseSubtitleFile } from '../src/lib/subtitles';
import { showToast } from '../src/lib/toast';
import type { StoredSubtitleData } from '../src/types';

const OVERLAY_KEY = '__videoTypingPrototypeOverlay__';
const VIDEO_ATTR = 'data-video-typing-target-id';
const SUBTITLE_ACCEPT = '.srt,.vtt,.ttml,.xml,.txt';

interface LoadedSubtitleFile {
  cues: StoredSubtitleData['cues'];
  fileName: string;
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

    const storedSubtitle = await loadStoredSubtitle(pageUrl);
    const storedTypingProgress = await loadStoredTypingProgress(pageUrl);
    const subtitleFile = storedSubtitle || await requestSubtitleFile();

    if (!subtitleFile) {
      showToast('Subtitle file is required. Overlay was not started.');
      return;
    }

    if (!storedSubtitle) {
      await saveStoredSubtitle(pageUrl, subtitleFile);
    }

    window[OVERLAY_KEY]?.remove();

    const targetId = `video-typing-${Date.now()}`;
    video.setAttribute(VIDEO_ATTR, targetId);

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

    window[OVERLAY_KEY] = {
      remove: () => {
        ui.remove();
      },
    };

    ui.mount();
  },
});

async function requestSubtitleFile(): Promise<LoadedSubtitleFile | null> {
  const file = await selectSubtitleFile();

  if (!file) {
    return null;
  }

  try {
    const text = await file.text();
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

function selectSubtitleFile(): Promise<File | null> {
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
    input.accept = SUBTITLE_ACCEPT;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      waitingForPicker = false;
      finish(input.files?.[0] || null);
    });

    title.textContent = 'Subtitle file required';
    description.textContent = 'Click "Choose file" below to open the subtitle picker and start video-typing.';
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
