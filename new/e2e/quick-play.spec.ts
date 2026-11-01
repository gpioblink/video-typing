import { test, expect, chromium, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

async function startClip(page: Page, title = 'First steps') {
  await page.getByRole('button', { name: new RegExp(title) }).click();
  const video = page.locator('video');
  await expect(video).toHaveJSProperty('readyState', 4);
  if (await video.evaluate((v: HTMLVideoElement) => v.paused)) await page.getByRole('button', { name: '再生する', exact: true }).click();
  await expect(page.locator('.quickTyping')).toBeVisible();
}
async function typeCue(page: Page) {
  const target = await page.locator('.quickTarget').innerText();
  const typing = page.locator('.quickTyping > [tabindex="0"]');
  await typing.focus();
  await typing.pressSequentially(target.replace(/[^A-Za-z]/g, ''), { delay: 30 });
}
async function completeClip(page: Page, tutorial: boolean) {
  for (let cue = 0; cue < 4; cue++) {
    await expect(page.locator('.quickTyping')).toHaveAttribute('data-cue-index', String(cue), { timeout: 15_000 });
    await typeCue(page);
    if (tutorial && cue === 0) {
      await expect(page.locator('.quickTutorial li').nth(0)).toHaveClass('done');
      await page.getByRole('button', { name: '聞き直す', exact: true }).click();
      await expect(page.locator('.quickTutorial li').nth(1)).toHaveClass('done');
    }
  }
  await expect(page.getByRole('heading', { name: '40秒、完走！' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.quickResult')).toContainText('46 / 46 文字');
}

test('fresh profile completes tutorial and three consecutive real-time attempts, then switches clips', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await startClip(page);
  await completeClip(page, true);
  await expect(page.locator('.quickResult')).toContainText('チュートリアル完了');
  for (let retry = 0; retry < 2; retry++) {
    await page.getByRole('button', { name: 'もう一度プレイ', exact: true }).click();
    await expect(page.locator('.quickTyping')).toHaveAttribute('data-cue-index', '0');
    if (await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)) await page.getByRole('button', { name: '再生する', exact: true }).click();
    await completeClip(page, false);
  }
  await page.getByRole('button', { name: '自由練習へ', exact: true }).click();
  await startClip(page, 'A quiet morning');
  await expect(page.locator('.quickTutorial')).toHaveCount(0);
  await expect(page.locator('.quickTarget')).toHaveText('The sun is warm.');
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  const paused = await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(400);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(paused, 1);
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 21; });
  await expect(page.locator('.quickTarget')).toHaveText('Take a deep breath.');
  await page.getByRole('button', { name: '再生する', exact: true }).click();
  await page.getByRole('button', { name: '聞き直す', exact: true }).click();
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(21);
  await page.getByRole('button', { name: 'クリップを選ぶ', exact: true }).click();
  await expect(page.locator('video')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('media error offers recovery and switching without stale state', async ({ page }) => {
  await page.route('**/demo/first-steps.webm', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: /First steps/ }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '読み込みを再試行' })).toBeVisible();
  await page.unroute('**/demo/first-steps.webm');
  await page.getByRole('button', { name: '読み込みを再試行' }).click();
  await expect(page.locator('.quickTarget')).toHaveText('Hello world.');
});

test('MV3 popup launches bundled shared quick play with no new host permissions', async () => {
  const profile = await mkdtemp(resolve(tmpdir(), 'video-typing-extension-'));
  const extensionPath = resolve('.output/chrome-mv3');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', executablePath: process.env.CHROMIUM_PATH, headless: true,
    args: ['--no-sandbox', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const tabOpened = context.waitForEvent('page');
    await page.getByRole('button', { name: 'おすすめをすぐプレイ · 40秒' }).click();
    const demo = await tabOpened;
    await demo.waitForLoadState();
    await startClip(demo);
    await completeClip(demo, true);
    await expect(demo.locator('.quickResult')).toContainText('チュートリアル完了');
    for (let retry = 0; retry < 2; retry++) {
      await demo.getByRole('button', { name: 'もう一度プレイ', exact: true }).click();
      await expect(demo.locator('.quickTyping')).toHaveAttribute('data-cue-index', '0');
      if (await demo.locator('video').evaluate((v: HTMLVideoElement) => v.paused)) await demo.getByRole('button', { name: '再生する', exact: true }).click();
      await completeClip(demo, false);
    }
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage']);
    expect(manifest.host_permissions).toBeUndefined();
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('YouTube adapter drives shared typing, pause/replay and embed failure UI', async ({ page }) => {
  await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.YT = { Player: class {
      constructor(node, options) {
        this.options=options; this.time=0; this.iframe=document.createElement('iframe'); node.replaceWith(this.iframe);
        window.testPlayer=this;
        setTimeout(()=>options.events.onReady({target:this}),0);
      }
      cueVideoById(data){ this.time=data.startSeconds; }
      playVideo(){ clearInterval(this.timer); this.options.events.onStateChange({data:1}); this.timer=setInterval(()=>{this.time+=0.2;},100); }
      pauseVideo(){ clearInterval(this.timer); this.options.events.onStateChange({data:2}); }
      seekTo(time){this.time=time;}
      getCurrentTime(){return this.time;}
      getIframe(){return this.iframe;}
      destroy(){clearInterval(this.timer);this.iframe.remove();}
    }}; window.onYouTubeIframeAPIReady();` }));
  await page.goto('/');
  await page.getByRole('button', { name: 'サンプルを開く', exact: true }).click();
  await expect(page.locator('.quickTarget')).toHaveText('Watch and listen.');
  await typeCue(page);
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await expect(page.getByRole('button', { name: '再生する', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).testPlayer.time = 21; });
  await expect(page.locator('.quickTarget')).toHaveText('Practice at your own pace.');
  await page.getByRole('button', { name: '聞き直す', exact: true }).click();
  expect(await page.evaluate(() => (window as any).testPlayer.time)).toBeLessThan(21);
  await page.evaluate(() => { (window as any).testPlayer.options.events.onError({data:150}); });
  await expect(page.getByRole('alert')).toContainText('does not allow');
  await page.getByRole('button', { name: '別のクリップへ', exact: true }).click();
  await startClip(page);
  await expect(page.locator('.quickTarget')).toHaveText('Hello world.');
});

test('existing hint selection survives cue switches and preserves a chosen pause', async ({ page }) => {
  await page.goto('/');
  await startClip(page);
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await page.locator('.quickTyping .available').click();
  await expect(page.locator('.quickHints .selectable')).toBeVisible();
  await page.locator('.quickHints .selectable').click();
  await expect(page.locator('video')).toHaveJSProperty('paused', true);
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 21; });
  await expect(page.locator('.quickTarget')).toHaveText('Small steps count.');
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 1; });
  await expect(page.locator('.quickTarget')).toHaveText('Hello world.');
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 40; });
  await expect(page.locator('.quickResult')).toContainText('振り返り');
  await expect(page.locator('.quickResult')).toContainText('Hello — 知らなかった');
});
