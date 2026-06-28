import { defineBackground } from 'wxt/utils/define-background';
import { searchChineseDictionary, searchDictionary } from '../src/lib/dictionary';
import { HINT_DEBUG_BUILD_ID } from '../src/lib/hintDebug';
import { isNetflixHostname } from '../src/lib/netflixSeek';

export default defineBackground(() => {
  console.log('[video-typing][hint][runtime-start]', {
    surface: 'background',
    buildId: HINT_DEBUG_BUILD_ID,
    extensionId: chrome.runtime.id,
    manifestVersion: chrome.runtime.getManifest().version,
  });

  chrome.action.onClicked.addListener(async (tab: any) => {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) {
      return;
    }

    await startOverlay(tab.id, tab.url, 'typing');
  });

  chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
    if (message?.type === 'videoTypingStartOverlay') {
      const tabId = Number(message.tabId);
      const url = String(message.url || '');
      const mode = message.mode === 'type-review' ? 'type-review' : 'typing';

      void startOverlay(tabId, url, mode)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }));

      return true;
    }

    if (message?.type === 'videoTypingDictionarySearch') {
      const requestId = String(message.requestId || '');
      const query = String(message.query || '');
      const contextText = String(message.contextText || '');
      console.log('[video-typing][hint][background-receive]', { requestId, query, contextText });
      void searchDictionary(query, 'english', contextText, requestId)
        .then((entries) => {
          console.log('[video-typing][hint][background-result]', {
            requestId,
            headwords: entries.map((entry) => entry.headword),
          });
          sendResponse({ entries });
        })
        .catch((error) => {
          console.log('[video-typing][hint][background-error]', { requestId, error });
          sendResponse({ entries: [] });
        });

      return true;
    }

    if (message?.type === 'videoTypingChineseDictionarySearch') {
      const requestId = String(message.requestId || '');
      void searchChineseDictionary(String(message.query || ''), String(message.contextText || ''))
        .then((entries) => sendResponse({ entries }))
        .catch((error) => {
          console.log('[video-typing][hint][background-error]', { requestId, error, kind: 'chinese' });
          sendResponse({ entries: [] });
        });

      return true;
    }

    return false;
  });
});

async function startOverlay(tabId: number, url: string, mode: 'typing' | 'type-review') {
  if (!tabId || !url || url.startsWith('chrome://')) {
    throw new Error('This tab cannot run video-typing.');
  }

  if (isNetflixUrl(url)) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-scripts/netflix-seek.js'],
      world: 'MAIN',
    });
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    func: (launchOptions: { mode: 'typing' | 'type-review' }) => {
      (window as any).__videoTypingPrototypeLaunchOptions__ = launchOptions;
    },
    args: [{ mode }],
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-scripts/overlay.js'],
  });
}

function isNetflixUrl(url: string) {
  try {
    return isNetflixHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}
