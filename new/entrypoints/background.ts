import { defineBackground } from 'wxt/utils/define-background';

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
});
