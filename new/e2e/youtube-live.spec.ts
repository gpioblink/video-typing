import { test, expect } from '@playwright/test';

// Opt in with pnpm test:youtube; this uses the real external service, never an API stub.
test('real official YouTube stream synchronizes native controls and segment ending', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'サンプルを開く', exact: true }).click();
  await expect(page.locator('.quickTarget')).toHaveText('Watch and listen.', { timeout: 20_000 });
  await page.waitForTimeout(6000);
  const frame = page.frames().find(item => item.url().includes('youtube.com/embed/'));
  expect(frame).toBeDefined();
  const nativePlay = frame!.getByRole('button', { name: 'Play video', exact: true });
  if (await nativePlay.isVisible()) await nativePlay.click();
  const playerState = () => frame!.evaluate(() => (document.getElementById('movie_player') as any).getPlayerState());
  const mediaTime = () => frame!.evaluate(() => document.querySelector('video')!.currentTime);
  await expect.poll(playerState, { timeout: 20_000 }).toBe(1);
  await expect.poll(() => page.locator('.quickTime').innerText(), { timeout: 15_000 }).not.toBe('0 / 40 秒');
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await expect.poll(playerState).toBe(2);
  const paused = await mediaTime();
  await page.waitForTimeout(500);
  expect(Math.abs(await mediaTime() - paused)).toBeLessThan(0.2);
  await frame!.evaluate(() => (document.getElementById('movie_player') as any).seekTo(21, true));
  await expect(page.locator('.quickTarget')).toHaveText('Practice at your own pace.', { timeout: 10_000 });
  await page.getByRole('button', { name: '聞き直す', exact: true }).click();
  await expect.poll(playerState, { timeout: 10_000 }).toBe(1);
  await expect.poll(mediaTime).toBeLessThan(21);
  await frame!.evaluate(() => (document.getElementById('movie_player') as any).seekTo(38, true));
  await expect(page.getByRole('heading', { name: '40秒、完走！' })).toBeVisible({ timeout: 15_000 });
  expect(await frame!.evaluate(() => document.querySelector('video')!.paused)).toBe(true);
});
