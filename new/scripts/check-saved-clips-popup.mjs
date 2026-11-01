// Run after `pnpm build`. Uses real extension storage and the built Popup UI.
// Current-tab metadata/runtime calls are mocked; no Netflix account is accessed.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const extension = path.resolve(import.meta.dirname, '../.output/chrome-mv3');
if (!existsSync(path.join(extension, 'manifest.json'))) throw new Error('Run pnpm build first.');
const profile = await mkdtemp(path.join(tmpdir(), 'video-typing-saved-clips-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const url = new URL(location.href).searchParams.get('current') || 'https://www.netflix.com/watch/12345678?tracking=fixture';
    window.__testCalls = [];
    chrome.tabs.query = async () => [{ id: 123, url, title: 'Metadata selection fixture' }];
    chrome.scripting.executeScript = async () => [{ result: {
      title: 'Metadata selection fixture', url, thumbnailUrl: '', currentTime: 12, duration: 120, paused: false, hasVideo: true,
    } }];
    chrome.runtime.sendMessage = async message => {
      window.__testCalls.push({ type: 'message', value: message }); return { ok: true };
    };
    chrome.tabs.create = async options => {
      window.__testCalls.push({ type: 'open', value: options }); return { id: 124, ...options };
    };
    window.close = () => {};
  });
  const popup = `chrome-extension://${extensionId}/popup.html`;
  await page.goto(popup);
  await page.getByLabel('保存するクリップ名').fill('Metadata selection fixture');
  await page.getByRole('button', { name: 'この区間を保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '保存済みクリップ（1/20）' })).toBeVisible();
  const stored = await worker.evaluate(() => chrome.storage.local.get('videoTypingSavedClipsV1'));
  assert.equal(stored.videoTypingSavedClipsV1[0].url, 'https://www.netflix.com/watch/12345678');
  assert.equal(stored.videoTypingSavedClipsV1[0].start, 12);
  assert.equal(stored.videoTypingSavedClipsV1[0].end, 57);
  await page.reload();
  await expect(page.getByRole('heading', { name: '保存済みクリップ（1/20）' })).toBeVisible();
  await page.getByRole('button', { name: 'このタブで練習する', exact: true }).click();
  const launched = await page.evaluate(() => window.__testCalls);
  assert.equal(launched[0].value.type, 'videoTypingStartOverlay');
  assert.equal(launched[0].value.mode, 'typing');
  assert.deepEqual(launched[0].value.range, { start: 12, end: 57 });
  await page.goto(`${popup}?current=${encodeURIComponent('https://www.netflix.com/watch/87654321')}`);
  await expect(page.getByText('別の動画を開いた場合は、そのタブで拡張機能をもう一度クリックし、保存済みクリップから選んでください。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '動画ページを開く', exact: true }).click();
  const opened = await page.evaluate(() => window.__testCalls);
  assert.deepEqual(opened, [{ type: 'open', value: { url: 'https://www.netflix.com/watch/12345678' } }]);
  await page.getByRole('button', { name: 'Metadata selection fixtureを削除', exact: true }).click();
  await expect(page.getByRole('heading', { name: '保存済みクリップ（0/20）' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '保存済みクリップ（0/20）' })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    actualExtensionStorage: true, currentTabAndRuntimeCalls: 'mocked', saveAndReload: 'pass',
    matchedSourceRangeMessage: 'pass', differentSourceCanonicalOpen: 'pass', deleteAndReload: 'pass', pageErrors: errors.length,
  }));
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
