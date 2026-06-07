import '../src/styles/overlay.css';
import ReactDOM from 'react-dom/client';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { OverlayApp } from '../src/components/OverlayApp';
import { showToast } from '../src/lib/toast';

const OVERLAY_KEY = '__videoTypingPrototypeOverlay__';
const VIDEO_ATTR = 'data-video-typing-target-id';

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

    if (!video) {
      showToast('No video tag found on this page.');
      return;
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
