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
        cueVideoById(data) { this.cue = data; this.time = data.startSeconds; this.state = 5; queueMicrotask(() => this.options.events.onStateChange({ data: 5 })); }
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
const subtitle = (page: Page) => panel(page, 'Subtitle').locator('[data-subtitle-text]');
const keyboard = (page: Page) => panel(page, 'Typing').locator('[tabindex="0"]');

async function expectNormalPanels(page: Page) {
  for (const name of ['Typing', 'Hint', 'Config', 'Subtitle']) await expect(panel(page, name)).toBeVisible();
  expect(await page.evaluate(() => typeof chrome === 'undefined' || !chrome.runtime?.id)).toBe(true);
  expect(await page.evaluate(() => typeof chrome === 'undefined' || typeof chrome.storage === 'undefined')).toBe(true);
  await expect(page.locator('iframe[title="YouTube video player"]')).toBeVisible();
  await expect(panel(page, 'Controls')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(再生する|聞き直す|一時停止)$/ })).toHaveCount(0);
}

async function chooseVideo(page: Page, video = FIRST) {
  await page.getByRole('button', { name: new RegExp(video.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await expect(page.getByRole('heading', { name: /クリップ選択 —/ })).toHaveCount(0);
}

async function openVideo(page: Page, preserveGuide = false) {
  await expectNormalPanels(page);
  if (preserveGuide) return;
  const close = page.locator('.normalTutorial');
  if (await close.isVisible()) await page.keyboard.press('Escape');
  await panel(page, 'Subtitle').getByRole('button', { name: '英語（答え）', exact: true }).click();
}

async function moveToCue(page: Page, cue: SubtitleCue, preserveGuide = false) {
  const close = page.locator('.normalTutorial');
  if (!preserveGuide && await close.isVisible()) await page.keyboard.press('Escape');
  if (await panel(page, 'Subtitle').getByRole('button', { name: '英語（答え）', exact: true }).getAttribute('aria-pressed') !== 'true') await panel(page, 'Subtitle').getByRole('button', { name: '英語（答え）', exact: true }).click();
  await page.evaluate(time => (window as any).testPlayer.seekTo(time), cue.start + Math.min(0.1, (cue.end - cue.start) / 2));
  await expect(subtitle(page)).toHaveText(cue.text);
}

async function typeCue(page: Page, cue: SubtitleCue) {
  await expect(keyboard(page)).toBeFocused();
  const letters = cue.text.replace(/[^A-Za-z]/g, '');
  const finished = await keyboard(page).locator('.finished').count();
  await page.keyboard.type(letters.slice(finished), { delay: 12 });
  await expect(keyboard(page).locator('.finished')).toHaveCount(letters.length);
}

async function completeClip(page: Page, video: RecommendedVideo) {
  const cues = captions(video);
  for (const [index, cue] of cues.entries()) {
    await moveToCue(page, cue);
    if (index === 0) await keyboard(page).focus();
    await typeCue(page, cue);
  }
  await page.evaluate(time => (window as any).testPlayer.seekTo(time), video.clips[0].end);
  await expect(page.getByRole('heading', { name: 'クリップ完走', exact: true })).toBeVisible();
  const expected = cues.reduce((sum, cue) => sum + cue.text.replace(/[^A-Za-z]/g, '').length, 0);
  await expect(page.locator('.normalResult')).toContainText(`${expected} 文字入力しました。`);
  expect(await page.evaluate(() => (window as any).testPlayer.isPaused())).toBe(true);
}

test('continuous keyboard input survives cue changes without refocusing the typing surface', async ({ page }) => {
  await mockYouTube(page); await page.goto('/');
  await page.getByLabel('操作チュートリアル', { exact: true }).uncheck();
  await chooseVideo(page);
  await expect(keyboard(page)).toBeFocused();
  await openVideo(page);
  const cues = captions(FIRST);
  await moveToCue(page, cues[0]);
  await page.evaluate(() => (window as any).testPlayer.pauseVideo());
  // Focus once, then use the actual keyboard. Locator.pressSequentially would
  // silently focus each replacement element and conceal this regression.
  await keyboard(page).focus();
  await page.keyboard.type(cues[0].text.replace(/[^A-Za-z]/g, ''));
  await expect(keyboard(page).locator('.finished')).toHaveCount(cues[0].text.replace(/[^A-Za-z]/g, '').length);
  // Let the native playback clock cross into the next caption.
  await page.evaluate(time => { (window as any).testPlayer.seekTo(time); (window as any).testPlayer.playVideo(); }, cues[0].end - 0.05);
  await expect(subtitle(page)).toHaveText(cues[1].text);
  await expect(keyboard(page)).toBeFocused();
  await page.keyboard.type(cues[1].text.replace(/[^A-Za-z]/g, ''));
  await expect(keyboard(page).locator('.finished')).toHaveCount(cues[1].text.replace(/[^A-Za-z]/g, '').length);
});

test('cue replacement respects deliberate focus in settings and the native player', async ({ page }) => {
  await mockYouTube(page); await page.goto('/');
  await page.getByLabel('操作チュートリアル', { exact: true }).uncheck();
  await chooseVideo(page); await openVideo(page);
  const cues = captions(FIRST);
  await moveToCue(page, cues[0]);
  await page.evaluate(() => (window as any).testPlayer.pauseVideo());
  await keyboard(page).focus();
  await panel(page, 'Config').getByRole('button', { name: 'Configを開く' }).click();
  const cueNumber = page.getByRole('textbox', { name: 'Cue number', exact: true });
  await cueNumber.fill('2');
  await page.evaluate(time => (window as any).testPlayer.seekTo(time), cues[1].start + 0.1);
  await expect(subtitle(page)).toHaveText(cues[1].text);
  await expect(cueNumber).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type('3');
  await expect(cueNumber).toHaveValue('3');
  await expect(keyboard(page).locator('.finished')).toHaveCount(0);
  const nativePlayer = page.locator('iframe[title="YouTube video player"]');
  await nativePlayer.focus();
  await page.evaluate(time => (window as any).testPlayer.seekTo(time), cues[2].start + 0.1);
  await expect(subtitle(page)).toHaveText(cues[2].text);
  await expect(nativePlayer).toBeFocused();
});

test('tutorial confirmation returns focus for the next typed character', async ({ page }) => {
  await mockYouTube(page); await page.goto('/'); await chooseVideo(page); await openVideo(page, true);
  await page.evaluate(time => (window as any).testPlayer.seekTo(time), captions(FIRST)[0].start + 0.1);
  await expect(keyboard(page).locator('.available')).toBeVisible();
  await keyboard(page).focus();
  await page.keyboard.type('xThis');
  await expect(page.locator('.normalTutorial')).toContainText('3 / 5');
  await page.keyboard.press('m');
  await expect(page.locator('.normalTutorial')).toContainText('4 / 5');
  await page.getByRole('button', { name: '確認しました', exact: true }).click();
  await expect(page.locator('.normalTutorial')).toContainText('5 / 5');
  await expect(keyboard(page)).toBeFocused();
  await page.keyboard.type('b');
  await expect(page.locator('.normalTutorial')).toHaveCount(0);
  await expect(keyboard(page).locator('.finished')).toHaveCount(5);
});

test('choosing a final-word meaning returns focus before advancing to the next cue', async ({ page }) => {
  await mockYouTube(page); await page.goto('/');
  await page.getByLabel('操作チュートリアル', { exact: true }).uncheck();
  await page.getByText('好きなYouTube動画で遊ぶ', { exact: true }).click();
  await page.getByLabel('YouTube URL', { exact: true }).fill(FIRST.sourceUrl);
  await page.getByLabel('字幕ファイル', { exact: true }).setInputFiles({ name: 'focus.srt', mimeType: 'text/plain',
    buffer: Buffer.from('1\n00:01:47,000 --> 00:01:49,000\nBlade\n\n2\n00:01:49,000 --> 00:01:51,000\nDark\n') });
  await page.getByRole('button', { name: '区間を選ぶ', exact: true }).click();
  await page.getByRole('button', { name: '開く', exact: true }).click();
  await openVideo(page);
  await page.evaluate(() => { (window as any).testPlayer.pauseVideo(); (window as any).testPlayer.seekTo(107.1); });
  await expect(subtitle(page)).toHaveText('Blade');
  await keyboard(page).focus(); await page.keyboard.type('xBlade');
  await expect(keyboard(page)).toContainText('誤答理由を選んでください');
  await page.keyboard.press('u');
  await panel(page, 'Hint').locator('.selectable').first().click();
  await expect(keyboard(page)).toBeFocused();
  await page.evaluate(() => (window as any).testPlayer.seekTo(109.1));
  await expect(subtitle(page)).toHaveText('Dark');
  await expect(keyboard(page)).toBeFocused();
  await page.keyboard.type('Dark');
  await expect(keyboard(page).locator('.finished')).toHaveCount(4);
});

test('the five-stage tutorial follows a real mistake, reason and dictionary before three complete attempts', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await mockYouTube(page); await page.goto('/'); await chooseVideo(page); await openVideo(page, true);
  await expect(page.locator('.normalTutorial')).toContainText('1 / 5');
  await expect(page.locator('.normalTutorial')).toContainText('記号や空白');
  await page.keyboard.press('Escape');
  await expect(page.locator('.normalTutorial')).toHaveCount(0);
  await panel(page, 'Subtitle').getByRole('button', { name: '英語（答え）', exact: true }).click();
  await page.getByRole('button', { name: '操作案内', exact: true }).click();
  await expect(page.locator('.normalTutorial')).toContainText('1 / 5');
  await moveToCue(page, captions(FIRST)[0], true);
  await keyboard(page).focus(); await keyboard(page).pressSequentially('x');
  await expect(page.locator('.normalTutorial')).toContainText('2 / 5');
  await keyboard(page).pressSequentially('This', { delay: 30 });
  await expect(page.locator('.normalTutorial')).toContainText('3 / 5');
  await expect(keyboard(page)).toContainText('誤答理由を選んでください');
  await keyboard(page).press('m');
  await expect(page.locator('.normalTutorial')).toContainText('4 / 5');
  await expect(panel(page, 'Hint').locator('.item').first()).toBeVisible();
  await expect(page.locator('[data-tutorial-spotlight="dictionary"]')).toBeVisible();
  await page.getByRole('button', { name: '確認しました', exact: true }).click();
  await expect(page.locator('.normalTutorial')).toContainText('5 / 5');
  await expect(page.locator('.normalTutorial')).toContainText('学習履歴');
  await expect(page.locator('.normalTutorial')).toContainText('CSV');
  await expect(page.locator('.normalTutorial')).toContainText('Anki');
  await expect(page.locator('.normalTutorial').getByRole('button', { name: '操作案内を閉じる' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('video-typing-tutorial-v3'))).toBe('done');
  await expect(page.getByRole('heading', { name: 'クリップ完走', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'クリップ選択に戻る', exact: true }).click();
  await expect(page.getByLabel('操作チュートリアル', { exact: true })).not.toBeChecked();
  await page.reload();
  await expect(page.getByLabel('操作チュートリアル', { exact: true })).not.toBeChecked();
  await chooseVideo(page); await openVideo(page);
  await completeClip(page, FIRST);
  for (let retry = 0; retry < 2; retry++) {
    await page.getByRole('button', { name: 'もう一度プレイ', exact: true }).click();
    await expectNormalPanels(page);
    await expect(keyboard(page).locator('.finished')).toHaveCount(0);
    await completeClip(page, FIRST);
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
  await page.getByText('好きなYouTube動画で遊ぶ', { exact: true }).click();
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
  await page.evaluate(() => (window as any).testPlayer.pauseVideo());
  const paused = await page.evaluate(() => (window as any).testPlayer.getCurrentTime());
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => (window as any).testPlayer.getCurrentTime())).toBe(paused);
  const another = captions(FIRST)[2];
  await moveToCue(page, another);
  expect(await page.evaluate(() => (window as any).testPlayer.isPaused())).toBe(true);
  await page.evaluate(() => (window as any).testPlayer.playVideo());
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
  await page.evaluate(() => (window as any).testPlayer.pauseVideo());
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

test('demo keeps playback native, defaults to Japanese, switches answers and closes only the subtitle panel', async ({ page }) => {
  await mockYouTube(page); await page.goto('/');
  const notice = page.getByRole('region', { name: 'Chrome拡張機能版について', exact: true });
  await expect(notice).toContainText('デモページ');
  await expect(page.locator('.playerShell > section').last()).toHaveAttribute('aria-label', 'Chrome拡張機能版について');
  for (const feature of ['Netflix', 'Prime Video', 'Bilibili', '中国語', 'オフライン', '日本語音声']) await expect(notice).toContainText(feature);
  await page.getByText('辞書設定', { exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /辞書|EJDict/ })).toContainText('46,916', { timeout: 30000 });
  await page.getByLabel('操作チュートリアル', { exact: true }).uncheck();
  await chooseVideo(page); await expectNormalPanels(page);
  await expect.poll(() => page.evaluate(() => (window as any).testPlayer.getPlayerState())).toBe(1);
  await page.evaluate(time => (window as any).testPlayer.seekTo(time), captions(FIRST)[0].start + 0.1);
  await expect(panel(page, 'Subtitle').getByRole('button', { name: '日本語', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(subtitle(page)).toContainText(/[\u3040-\u30ff\u4e00-\u9fff]/);
  await panel(page, 'Subtitle').getByRole('button', { name: '英語（答え）', exact: true }).click();
  await expect(subtitle(page)).toHaveText(captions(FIRST)[0].text);
  await page.evaluate(() => (window as any).testPlayer.pauseVideo());
  await keyboard(page).focus(); await keyboard(page).pressSequentially('T');
  await panel(page, 'Subtitle').getByRole('button', { name: 'Subtitleを閉じる', exact: true }).click();
  await expect(panel(page, 'Subtitle')).toHaveCount(0);
  await expect(keyboard(page).locator('.finished')).toHaveCount(1);
  await panel(page, 'Config').getByRole('button', { name: 'Configを開く' }).click();
  await panel(page, 'Config').getByRole('button', { name: '字幕ウィンドウを表示', exact: true }).click();
  await expect(subtitle(page)).toHaveText(captions(FIRST)[0].text);
  await panel(page, 'Config').getByRole('button', { name: 'Configを折りたたむ' }).click();
  await keyboard(page).locator('.finished').click();
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
  // Headless Chromium does not synthesize the browser-chrome Esc action.
  // Exercise the same native Fullscreen API transition directly.
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.locator('main.normalPractice')).toHaveClass(/display-mini/);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) test(`initial mini layout is visible without overlaps at ${viewport.width}x${viewport.height} with centred captions above typing`, async ({ page }) => {
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
  const typingBox = (await panel(page, 'Typing').boundingBox())!;
  const captionBox = (await panel(page, 'Subtitle').boundingBox())!;
  expect(Math.abs(typingBox.x + typingBox.width / 2 - viewport.width / 2)).toBeLessThan(1);
  expect(Math.abs(captionBox.x + captionBox.width / 2 - viewport.width / 2)).toBeLessThan(1);
  expect(captionBox.y + captionBox.height).toBeLessThan(typingBox.y);
  if (viewport.width > 1000) expect(Math.abs(captionBox.width - typingBox.width / 2)).toBeLessThan(1);

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

test('the tutorial keeps unknown-word meaning selection usable before its dictionary and final steps', async ({ page }) => {
  await mockYouTube(page); await page.goto('/'); await chooseVideo(page); await openVideo(page, true);
  await page.evaluate(time => (window as any).testPlayer.seekTo(time), captions(FIRST)[0].start + 0.1);
  await expect(keyboard(page).locator('.available')).toBeVisible();
  await keyboard(page).focus(); await keyboard(page).pressSequentially('x');
  await expect(page.locator('.normalTutorial')).toContainText('2 / 5');
  await keyboard(page).pressSequentially('This', { delay: 30 });
  await expect(page.locator('.normalTutorial')).toContainText('3 / 5');
  await keyboard(page).press('u');
  await expect(page.locator('.normalTutorial')).toContainText('辞書で当てはまる意味を選んで記録');
  await panel(page, 'Hint').locator('.selectable').first().click();
  await expect(page.locator('.normalTutorial')).toContainText('4 / 5');
  await expect(keyboard(page).getByText('ignorance', { exact: true })).toBeVisible();
  await keyboard(page).focus(); await keyboard(page).pressSequentially('b');
  await expect(page.locator('.normalTutorial')).toContainText('5 / 5');
  await keyboard(page).pressSequentially('l');
  await expect(page.locator('.normalTutorial')).toHaveCount(0);
});
