import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RECOMMENDED_VIDEOS } from '../src/data/recommendedVideos';

// Opt-in live service test. No transcript service or replacement player.
for (const video of RECOMMENDED_VIDEOS) test(`real official YouTube ${video.id} normal learning UI`, async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('操作チュートリアル', { exact: true }).uncheck();
  await page.getByRole('button', { name: new RegExp(video.title) }).click();
  const typing = page.getByRole('region', { name: 'Typing', exact: true });
  const subtitle = page.getByRole('region', { name: 'Subtitle', exact: true }).locator('[data-subtitle-text]');
  await expect(typing).toBeVisible({ timeout: 20_000 });
  const frame = page.frames().find(item => item.url().includes('youtube.com/embed/'))!;
  expect(frame).toBeDefined();
  await expect(page.getByRole('region', { name: 'Controls', exact: true })).toHaveCount(0);
  const state = () => frame.evaluate(() => (document.getElementById('movie_player') as any).getPlayerState());
  await expect.poll(state, { timeout: 20_000 }).toBe(1);
  await frame.evaluate(() => (document.getElementById('movie_player') as any).pauseVideo());
  await expect.poll(state).toBe(2);
  const paused = await frame.evaluate(() => document.querySelector('video')!.currentTime);
  await page.waitForTimeout(500);
  expect(Math.abs(await frame.evaluate(() => document.querySelector('video')!.currentTime) - paused)).toBeLessThan(0.2);
  await frame.evaluate(() => (document.getElementById('movie_player') as any).playVideo());
  await page.getByRole('region', { name: 'Subtitle', exact: true }).getByRole('button', { name: '英語（答え）', exact: true }).click();
  const keyboard = typing.locator('[tabindex="0"]'); await keyboard.focus();
  await expect.poll(state).toBe(1);
  const text = readFileSync(resolve('public', video.subtitle.url), 'utf8');
  const seconds = (time: string) => { const [h, m, s] = time.trim().replace(',', '.').split(':').map(Number); return h * 3600 + m * 60 + s; };
  const range = video.clips[0]; let cueIndex = 0;
  for (const block of text.trim().split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/); const i = lines.findIndex(line => line.includes('-->')); if (i < 0) continue;
    const [start, end] = lines[i].split('-->').map(seconds);
    if (start >= range.end || end <= range.start) continue;
    const cueText = lines.slice(i + 1).join('\n');
    await frame.evaluate(time => (document.getElementById('movie_player') as any).seekTo(time, true), Math.max(start, range.start) + 0.1);
    await expect(subtitle).toHaveText(cueText, { timeout: 10_000 });
    await expect(keyboard).toBeFocused();
    const letters = cueText.replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/[^A-Za-z]/g, '');
    await page.keyboard.type(letters, { delay: 15 });
    await expect(keyboard.locator('.finished')).toHaveCount(letters.length);
    if (cueIndex++ === 0) {
      await frame.evaluate(time => (document.getElementById('movie_player') as any).seekTo(time, true), Math.max(start, range.start));
      await expect.poll(state).toBe(1);
    }
  }
  await frame.evaluate(time => (document.getElementById('movie_player') as any).seekTo(time, true), range.end - 0.15);
  await expect(page.getByRole('heading', { name: 'クリップ完走', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await frame.evaluate(() => document.querySelector('video')!.paused)).toBe(true);
});
