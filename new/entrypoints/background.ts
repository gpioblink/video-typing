import { defineBackground } from 'wxt/utils/define-background';
import { searchChineseDictionary, searchDictionary } from '../src/lib/dictionary';

export default defineBackground(() => {
  chrome.action.onClicked.addListener(async (tab: any) => {
    if (!tab.id || !tab.url || tab.url.startsWith('chrome://')) {
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-scripts/overlay.js'],
    });
  });

  chrome.runtime.onMessage.addListener((message: any, _sender: any, sendResponse: any) => {
    if (message?.type === 'videoTypingDictionarySearch') {
      void searchDictionary(String(message.query || ''))
        .then((entries) => sendResponse({ entries }))
        .catch(() => sendResponse({ entries: [] }));

      return true;
    }

    if (message?.type === 'videoTypingChineseDictionarySearch') {
      void searchChineseDictionary(String(message.query || ''), String(message.contextText || ''))
        .then((entries) => sendResponse({ entries }))
        .catch(() => sendResponse({ entries: [] }));

      return true;
    }

    return false;
  });
});
