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
  for (const name of ['Typing', 'Hint', 'Config', 'Subtitle']) await expect(panel(page, name)).toBeVisible();
  expect(await page.evaluate(() => typeof chrome === 'undefined' || !chrome.runtime?.id)).toBe(true);
  expect(await page.evaluate(() => typeof chrome === 'undefined' || typeof chrome.storage === 'undefined')).toBe(true);
  await expect(page.locator('iframe[title="YouTube video player"]')).toBeVisible();
}

async function chooseVideo(page: Page, video = FIRST) {
  await page.getByRole('button', { name: new RegExp(video.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await expect(page.getByRole('list', { name: '選択区間の字幕' }).locator('li')).not.toHaveCount(0);
  await expect(page.getByLabel('開始秒', { exact: true })).toHaveValue(String(video.clips[0].start));
  await expect(page.getByLabel('終了秒', { exact: true })).toHaveValue(String(video.clips[0].end));
  await expect(page.locator('.clipAttribution')).toContainText(video.subtitle.license);
  await expect(page.getByRole('link', { name: '字幕の出典' })).toHaveAttribute('href', video.subtitle.sourceUrl);
}

async function openVideo(page: Page) {
  await page.getByRole('button', { name: '開く', exact: true }).click();
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
      await panel(page, 'Typing').getByRole('button', { name: '聞き直す', exact: true }).click();
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
  await chooseVideo(page);
  const range = FIRST.clips[0];
  await page.getByLabel('開始秒', { exact: true }).fill(String(range.start + 1));
  await page.getByLabel('終了秒', { exact: true }).fill(String(range.end - 1));
  await expect(page.getByRole('list', { name: '選択区間の字幕' })).toContainText(captions(FIRST)[0].text);
  await openVideo(page);
  await expect.poll(() => page.evaluate(() => (window as any).testPlayer.cue.startSeconds)).toBe(range.start + 1);
  await expect.poll(() => page.evaluate(() => (window as any).testPlayer.cue.endSeconds)).toBe(range.end - 1);
  await expect(subtitle(page)).toHaveText(captions(FIRST)[0].text);
  const priorSeeks = await page.evaluate(() => (window as any).testPlayer.seeks.length);
  await expect.poll(() => page.evaluate(() => (window as any).testPlayer.seeks.length), { timeout: 8_000 }).toBeGreaterThan(priorSeeks);
  await expect(subtitle(page)).toHaveText(captions(FIRST)[0].text);
  await panel(page, 'Typing').getByRole('button', { name: '一時停止', exact: true }).click();
  const paused = await page.evaluate(() => (window as any).testPlayer.getCurrentTime());
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => (window as any).testPlayer.getCurrentTime())).toBe(paused);
  const another = captions(FIRST)[2];
  await moveToCue(page, another);
  expect(await page.evaluate(() => (window as any).testPlayer.isPaused())).toBe(true);
  await panel(page, 'Typing').getByRole('button', { name: '聞き直す', exact: true }).click();
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
  await chooseVideo(page);
  await page.route(API_URL, route => route.abort());
  await page.getByRole('button', { name: '開く', exact: true }).click();
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
  await panel(page, 'Typing').getByRole('button', { name: '一時停止', exact: true }).click();
  await keyboard(page).locator('.available').click();
  await expect(panel(page, 'Hint').locator('.selectable')).toContainText('Original test demonstrative.');
  await panel(page, 'Hint').locator('.selectable').click();
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
