import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RECOMMENDED_VIDEOS, type RecommendedVideo } from '../src/data/recommendedVideos';
import type { SubtitleCue } from '../src/types';

const API_URL = 'https://www.youtube.com/iframe_api';
const FIRST = RECOMMENDED_VIDEOS[0];
const SECOND = RECOMMENDED_VIDEOS[1];

// This suite exercises the real application UI and licensed caption files with
// a controlled API double. Actual YouTube streaming is a separate opt-in test.
async function mockYouTube(page: Page) {
  await page.route(API_URL, route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.testPlayers = window.testPlayers || [];
      window.YT = { Player: class {
        constructor(node, options) {
          this.options = options; this.time = 0; this.rate = 1; this.state = 2;
          this.seeks = []; this.destroyed = false;
          this.iframe = document.createElement('iframe');
          node.replaceWith(this.iframe);
          window.testPlayer = this; window.testPlayers.push(this);
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        cueVideoById(data) { this.cue = data; this.time = data.startSeconds; }
        playVideo() {
          clearInterval(this.timer); this.state = 1;
          this.options.events.onStateChange({ data: 1 });
          this.timer = setInterval(() => { this.time += 0.1 * this.rate; }, 100);
        }
        pauseVideo() { clearInterval(this.timer); this.state = 2; this.options.events.onStateChange({ data: 2 }); }
        seekTo(time) { this.seeks.push(time); this.time = time; }
        getCurrentTime() { return this.time; }
        getDuration() { return 1200; }
        getPlayerState() { return this.state; }
        isPaused() { return this.state !== 1; }
        getPlaybackRate() { return this.rate; }
        setPlaybackRate(rate) { this.rate = rate; }
        getIframe() { return this.iframe; }
        destroy() { this.destroyed = true; clearInterval(this.timer); this.iframe.remove(); }
      }};
      window.onYouTubeIframeAPIReady();
    `,
  }));
}

function captions(video: RecommendedVideo): SubtitleCue[] {
  const text = readFileSync(resolve('public', video.subtitle.url), 'utf8');
  const seconds = (value: string) => {
    const [hours, minutes, rest] = value.replace(',', '.').split(':').map(Number);
    return hours * 3600 + minutes * 60 + rest;
  };
  const range = video.clips[0];
  return text.trim().split(/\r?\n\s*\r?\n/).flatMap(block => {
    const lines = block.split(/\r?\n/);
    const index = lines.findIndex(line => line.includes('-->'));
    if (index < 0) return [];
    const [start, end] = lines[index].split('-->').map(value => seconds(value.trim()) + video.subtitle.offsetSeconds);
    if (start >= range.end || end <= range.start) return [];
    return [{ start: Math.max(start, range.start), end: Math.min(end, range.end), text: lines.slice(index + 1).join('\n') }];
  });
}

const panel = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const subtitle = (page: Page) => panel(page, 'Subtitle').locator('div').last();
const keyboard = (page: Page) => panel(page, 'Typing').locator('[tabindex="0"]');

async function expectNormalPanels(page: Page) {
  for (const name of ['Typing', 'Hint', 'Config', 'Subtitle', 'Controls']) await expect(panel(page, name)).toBeVisible();
  expect(await page.evaluate(() => typeof chrome === 'undefined' || !chrome.runtime?.id)).toBe(true);
  expect(await page.evaluate(() => typeof chrome === 'undefined' || typeof chrome.storage === 'undefined')).toBe(true);
  await expect(page.locator('iframe[title="YouTube video player"]')).toBeVisible();
}

async function chooseVideo(page: Page, video = FIRST) {
  await page.getByRole('button', { name: new RegExp(video.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await expect(page.getByRole('heading', { name: /クリップ選択 —/ })).toHaveCount(0);
}

async function openVideo(page: Page) {
  await expectNormalPanels(page);
}

async function moveToCue(page: Page, cue: SubtitleCue) {
  await page.evaluate(time => (window as any).testPlayer.seekTo(time), cue.start + Math.min(0.1, (cue.end - cue.start) / 2));
  await expect(subtitle(page)).toHaveText(cue.text);
}

async function typeCue(page: Page, cue: SubtitleCue) {
  await keyboard(page).focus();
  const letters = cue.text.replace(/[^A-Za-z]/g, '');
  await keyboard(page).pressSequentially(letters, { delay: 12 });
  await expect(keyboard(page).locator('.finished')).toHaveCount(letters.length);
}

async function completeClip(page: Page, video: RecommendedVideo, tutorial: boolean) {
  const cues = captions(video);
  for (const [index, cue] of cues.entries()) {
    await moveToCue(page, cue);
    await typeCue(page, cue);
    if (tutorial && index === 0) {
      await expect(page.locator('.normalTutorial')).toContainText('2 / 3');
      await panel(page, 'Controls').getByRole('button', { name: '聞き直す', exact: true }).click();
      await expect(page.locator('.normalTutorial')).toContainText('3 / 3');
    }
  }
  await page.evaluate(time => (window as any).testPlayer.seekTo(time), video.clips[0].end);
  await expect(page.getByRole('heading', { name: 'クリップ完走', exact: true })).toBeVisible();
  const expected = cues.reduce((sum, cue) => sum + cue.text.replace(/[^A-Za-z]/g, '').length, 0);
  await expect(page.locator('.normalResult')).toContainText(`${expected} 文字入力しました。`);
  expect(await page.evaluate(() => (window as any).testPlayer.isPaused())).toBe(true);
}

test('licensed selection opens the normal overlay, completes tutorial and retries three times without an extension', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await mockYouTube(page);
  await page.goto('/');
  await chooseVideo(page);
  await openVideo(page);
  await expect(page.locator('.normalTutorial')).toContainText('1 / 3');
  await page.getByRole('button', { name: 'スキップ', exact: true }).click();
  await expect(page.locator('.normalTutorial')).toHaveCount(0);
  await page.getByRole('button', { name: '操作案内', exact: true }).click();
  await expect(page.locator('.normalTutorial')).toContainText('1 / 3');
  const config = panel(page, 'Config');
  await expect(config.getByRole('button', { name: 'Configを開く' })).toHaveAttribute('aria-expanded', 'false');
  await config.getByRole('button', { name: 'Configを開く' }).click();
  await expect(config.getByRole('textbox', { name: 'Cue number' })).toBeVisible();
  const expandedHeight = (await config.boundingBox())!.height;
  await config.getByRole('button', { name: 'Configを折りたたむ' }).click();
  expect((await config.boundingBox())!.height).toBeLessThan(70);
  await config.getByRole('button', { name: 'Configを開く' }).click();
  expect((await config.boundingBox())!.height).toBeGreaterThanOrEqual(expandedHeight - 2);
  await config.getByRole('button', { name: 'Configを折りたたむ' }).click();
  await completeClip(page, FIRST, true);
  await expect(page.locator('.normalResult')).toContainText('チュートリアル完了');
  for (let retry = 0; retry < 2; retry++) {
    await page.getByRole('button', { name: 'もう一度プレイ', exact: true }).click();
    await expectNormalPanels(page);
    await expect(keyboard(page).locator('.finished')).toHaveCount(0);
    await completeClip(page, FIRST, false);
  }
  await page.getByRole('button', { name: 'クリップ選択へ', exact: true }).click();
  expect(await page.evaluate(() => (window as any).testPlayer.destroyed)).toBe(true);
  await expect(page.getByRole('region', { name: 'Typing', exact: true })).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await chooseVideo(page, SECOND);
  await openVideo(page);
  await expect(page.locator('.normalTutorial')).toHaveCount(0);
  await moveToCue(page, captions(SECOND)[0]);
  await expect(keyboard(page).locator('.finished')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).testPlayer.options.videoId)).toBe(SECOND.videoId);
  expect(errors).toEqual([]);
});

test('normal overlay keeps unfinished cues looping, preserves native pause and supports range editing and replay', async ({ page }) => {
  await mockYouTube(page);
  await page.goto('/');
  await page.getByText('自分のYouTube動画・字幕を使う', { exact: true }).click();
  await page.getByLabel('YouTube URL', { exact: true }).fill(FIRST.sourceUrl);
  await page.getByLabel('字幕ファイル', { exact: true }).setInputFiles(resolve('public', FIRST.subtitle.url));
  await page.getByRole('button', { name: '区間を選ぶ', exact: true }).click();
  const range = FIRST.clips[0];
  await page.getByLabel('開始秒', { exact: true }).fill(String(range.start + 1));
  await page.getByLabel('終了秒', { exact: true }).fill(String(range.end - 1));
  await expect(page.getByRole('list', { name: '選択区間の字幕' })).toContainText(captions(FIRST)[0].text);
  await page.getByRole('button', { name: '開く', exact: true }).click();
  await openVideo(page);
  await expect.poll(() => page.evaluate(() => (window as any).testPlayer.cue.startSeconds)).toBe(range.start + 1);
  await expect.poll(() => page.evaluate(() => (window as any).testPlayer.cue.endSeconds)).toBe(range.end - 1);
  await expect(subtitle(page)).toHaveText(captions(FIRST)[0].text);
  const priorSeeks = await page.evaluate(() => (window as any).testPlayer.seeks.length);
  await expect.poll(() => page.evaluate(() => (window as any).testPlayer.seeks.length), { timeout: 8_000 }).toBeGreaterThan(priorSeeks);
  await expect(subtitle(page)).toHaveText(captions(FIRST)[0].text);
  await panel(page, 'Controls').getByRole('button', { name: '一時停止', exact: true }).click();
  const paused = await page.evaluate(() => (window as any).testPlayer.getCurrentTime());
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => (window as any).testPlayer.getCurrentTime())).toBe(paused);
  const another = captions(FIRST)[2];
  await moveToCue(page, another);
  expect(await page.evaluate(() => (window as any).testPlayer.isPaused())).toBe(true);
  await panel(page, 'Controls').getByRole('button', { name: '聞き直す', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).testPlayer.isPaused())).toBe(false);
  expect(await page.evaluate(() => (window as any).testPlayer.getCurrentTime())).toBeLessThan(another.start + 0.5);
  expect(await page.evaluate(() => (window as any).testPlayer.options.playerVars.controls)).toBe(1);
  await page.getByRole('button', { name: 'クリップ選択に戻る', exact: true }).click();
  expect(await page.evaluate(() => (window as any).testPlayer.destroyed)).toBe(true);
});

test('caption and official API loading failures offer retry without retaining old playback', async ({ page }) => {
  const subtitleUrl = new URL(FIRST.subtitle.url, 'http://127.0.0.1:4173/').href;
  await page.route(subtitleUrl, route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(FIRST.title) }).click();
  await expect(page.getByRole('alert')).toContainText(/Failed to fetch|字幕を読み込めません/);
  await page.unroute(subtitleUrl);
  await page.route(API_URL, route => route.abort());
  await chooseVideo(page);
  await expect(page.getByRole('alert')).toContainText('YouTube API could not be loaded');
  await page.unroute(API_URL);
  await mockYouTube(page);
  await page.getByRole('button', { name: '読み込みを再試行', exact: true }).click();
  await expectNormalPanels(page);
  await moveToCue(page, captions(FIRST)[0]);
  await page.evaluate(() => (window as any).testPlayer.options.events.onError({ data: 150 }));
  await expect(page.getByRole('alert')).toContainText('does not allow');
  await page.getByRole('alert').getByRole('button', { name: 'クリップ選択に戻る', exact: true }).click();
  expect(await page.evaluate(() => (window as any).testPlayer.destroyed)).toBe(true);
  await chooseVideo(page, SECOND);
  await openVideo(page);
  await moveToCue(page, captions(SECOND)[0]);
});

test('the ordinary web overlay uses imported IndexedDB hints, preserves tags across seeks and resets the current cue', async ({ page }) => {
  await mockYouTube(page);
  await page.goto('/');
  await page.getByText('辞書設定', { exact: true }).click();
  await page.getByLabel('辞書TSV').setInputFiles({ name: 'original-test.tsv', mimeType: 'text/tab-separated-values', buffer: Buffer.from('This\tOriginal test demonstrative.\nblade\tOriginal test cutting tool.\n') });
  await expect(page.getByRole('alert')).toContainText('辞書 2 件を読み込みました。');
  await chooseVideo(page);
  await openVideo(page);
  await moveToCue(page, captions(FIRST)[0]);
  await panel(page, 'Controls').getByRole('button', { name: '一時停止', exact: true }).click();
  await keyboard(page).locator('.available').click();
  await expect(panel(page, 'Hint').locator('.selectable').filter({ hasText: 'Original test demonstrative.' })).toContainText('Original test demonstrative.');
  await panel(page, 'Hint').locator('.selectable').filter({ hasText: 'Original test demonstrative.' }).click();
  await expect(keyboard(page).getByText('ignorance', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).testPlayer.isPaused())).toBe(true);
  await moveToCue(page, captions(FIRST)[2]);
  await moveToCue(page, captions(FIRST)[0]);
  await expect(keyboard(page).getByText('ignorance', { exact: true })).toBeVisible();
  await panel(page, 'Config').getByRole('button', { name: 'Configを開く' }).click();
  await panel(page, 'Config').getByRole('button', { name: 'Reset current cue', exact: true }).click();
  await expect(keyboard(page).getByText('ignorance', { exact: true })).toHaveCount(0);
  await expect(panel(page, 'Hint').locator('.item')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).testPlayer.isPaused())).toBe(true);
});

test('demo explains the extension, loads EJDict by default and keeps playback actions in Controls', async ({ page }) => {
  await mockYouTube(page);
  await page.goto('/');
  const notice = page.getByRole('region', { name: 'Chrome拡張機能版について', exact: true });
  await expect(notice).toContainText('デモページ');
  for (const feature of ['Netflix', 'Prime Video', 'Bilibili', '中国語', 'オフライン', '日本語音声']) await expect(notice).toContainText(feature);
  await page.getByText('辞書設定', { exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /辞書|EJDict/ })).toContainText('46,916', { timeout: 30_000 });
  await page.getByLabel('操作チュートリアル', { exact: true }).uncheck();
  await chooseVideo(page);
  await openVideo(page);
  const controls = panel(page, 'Controls');
  await expect(panel(page, 'Typing').getByRole('button')).toHaveCount(0);
  await expect(controls.getByRole('button', { name: '一時停止', exact: true })).toBeVisible();
  await controls.getByRole('checkbox', { name: '字幕を表示', exact: true }).uncheck();
  await expect(subtitle(page)).toHaveText('字幕は非表示です');
  await controls.getByRole('checkbox', { name: '字幕を表示', exact: true }).check();
  await expect(subtitle(page)).toHaveText(captions(FIRST)[0].text);
  await controls.getByRole('button', { name: '一時停止', exact: true }).click();
  await keyboard(page).locator('.available').click();
  await expect(panel(page, 'Hint').locator('.selectable').first()).toContainText(/[\u3040-\u30ff\u4e00-\u9fff]/);
});

test('fullscreen can be selected before instant play and toggled back to the mini layout', async ({ page }) => {
  await mockYouTube(page);
  await page.goto('/');
  await page.getByLabel('操作チュートリアル', { exact: true }).uncheck();
  await page.getByRole('radio', { name: '全画面', exact: true }).check();
  await chooseVideo(page);
  await openVideo(page);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await expect(page.locator('main.normalPractice')).toHaveClass(/display-fullscreen/);
  await panel(page, 'Controls').getByRole('button', { name: 'ミニ画面にする', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.locator('main.normalPractice')).toHaveClass(/display-mini/);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) test(`initial mini layout is visible without overlaps at ${viewport.width}x${viewport.height} and resets after dragging`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await mockYouTube(page);
  await page.goto('/');
  // Old versions saved several off-screen defaults. The current layout has its
  // own namespace and must remain usable in an existing browser profile.
  await page.evaluate(() => localStorage.setItem('video-typing:web:v1:videoTypingPrototypePanelPositions', JSON.stringify({ '127.0.0.1': { typing: { x: 5000, y: 5000 }, config: { x: 5000, y: 5000 } } })));
  await page.getByLabel('操作チュートリアル', { exact: true }).uncheck();
  await chooseVideo(page);
  await openVideo(page);
  const boxes = await page.locator('[data-panel-kind]').evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { kind: element.getAttribute('data-panel-kind'), x, y, width, height };
  }));
  for (const box of boxes) {
    expect(box.x, box.kind!).toBeGreaterThanOrEqual(0);
    expect(box.y, box.kind!).toBeGreaterThanOrEqual(72);
    expect(box.x + box.width, box.kind!).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height, box.kind!).toBeLessThanOrEqual(viewport.height + 1);
  }
  for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) {
    const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    expect(intersection, `${a.kind} and ${b.kind}`).toBe(0);
  }
  const original = (await panel(page, 'Typing').boundingBox())!;
  await page.mouse.move(original.x + 60, original.y + 18);
  await page.mouse.down(); await page.mouse.move(original.x + 80, original.y + 40); await page.mouse.up();
  if (await panel(page, 'Controls').getByRole('button', { name: 'Controlsを開く' }).isVisible()) await panel(page, 'Controls').getByRole('button', { name: 'Controlsを開く' }).click();
  await panel(page, 'Controls').getByRole('button', { name: '配置をリセット', exact: true }).click();
  await expect.poll(async () => Math.round((await panel(page, 'Typing').boundingBox())!.x)).toBe(Math.round(original.x));
  await expect.poll(async () => Math.round((await panel(page, 'Typing').boundingBox())!.y)).toBe(Math.round(original.y));
});

test('resizing an active practice reflows every panel without restoring stale geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockYouTube(page); await page.goto('/');
  await page.getByLabel('操作チュートリアル', { exact: true }).uncheck();
  await chooseVideo(page); await openVideo(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.locator('[data-panel-kind]').evaluateAll(elements => {
      const boxes = elements.map(element => element.getBoundingClientRect());
      return boxes.every(box => box.left >= 0 && box.top >= 72 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1)
        && boxes.every((a, i) => boxes.slice(i + 1).every(b => Math.min(a.right, b.right) <= Math.max(a.left, b.left) + 1 || Math.min(a.bottom, b.bottom) <= Math.max(a.top, b.top) + 1));
    })).toBe(true);
  }
});
