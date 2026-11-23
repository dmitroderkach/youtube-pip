/**
 * TEMPORARY check, not to be merged: Shorts in the PiP popup with `web_shorts_cow_carousel` forced
 * on / off (E2E_FORCE_EXPERIMENT_FLAGS of the CI step): Space and K toggle play / pause in PiP, and screenshots of
 * the popup with its controls (hovered, playing and paused) into tmp-shots/ for the owner.
 */
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  test,
  waitForShortsPlayerVisibleInMain,
  waitForShortsPlayerVisibleInPip,
} from '../fixtures';

const FLAG = 'web_shorts_cow_carousel';
const SHOTS_DIR = 'tmp-shots';

type VideoState = { paused: boolean; t: number } | null;

async function pipVideoState(page: Page): Promise<VideoState> {
  return page.evaluate(() => {
    const doc = window.documentPictureInPicture?.window?.document;
    const video = doc?.querySelector<HTMLVideoElement>('ytd-shorts #shorts-player video');
    return video ? { paused: video.paused, t: Number(video.currentTime.toFixed(2)) } : null;
  });
}

async function ensurePlaying(page: Page, inPip: boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const state = inPip
      ? await pipVideoState(page)
      : await page.evaluate(() => {
          const v = document.querySelector<HTMLVideoElement>('ytd-shorts #shorts-player video');
          return v ? { paused: v.paused, t: v.currentTime } : null;
        });
    if (state && !state.paused && state.t > 0.3) return;
    await page.evaluate(() =>
      document.querySelector<HTMLElement & { playVideo?(): void }>('#shorts-player')?.playVideo?.()
    );
    await page.waitForTimeout(500);
  }
}

async function toggleTwice(pipPage: Page, page: Page, key: string): Promise<string> {
  await ensurePlaying(page, true);
  const s = (v: VideoState) => (v ? (v.paused ? 'paused' : 'playing') : 'no video');
  const before = await pipVideoState(page);
  await pipPage.keyboard.press(key);
  await page.waitForTimeout(1200);
  const after1 = await pipVideoState(page);
  await pipPage.keyboard.press(key);
  await page.waitForTimeout(1200);
  const after2 = await pipVideoState(page);
  return `${s(before)} → ${s(after1)} → ${s(after2)}`;
}

test.use({
  authState: true,
  blockAds: true,
  launchOptions: {
    args: [
      '--disable-blink-features=AutomationControlled',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

test('Shorts PiP: Space / K and screenshots of the popup controls', async ({
  shortsPageReady: page,
  triggerEnterPictureInPicture,
}, testInfo) => {
  const forced = process.env.E2E_FORCE_EXPERIMENT_FLAGS ?? '';
  const flagSeen = await page.evaluate(
    (flag) =>
      (
        window as unknown as { ytcfg?: { get(key: string): Record<string, unknown> | undefined } }
      ).ytcfg?.get('EXPERIMENT_FLAGS')?.[flag],
    FLAG
  );
  const tag = `${testInfo.project.name}__${FLAG}=${String(flagSeen)}`;

  await waitForShortsPlayerVisibleInMain(page);
  await ensurePlaying(page, false);
  await triggerEnterPictureInPicture(page);
  await waitForShortsPlayerVisibleInPip(page);
  const pipPage = page
    .context()
    .pages()
    .find((p) => p !== page);
  if (!pipPage) throw new Error('no PiP page');

  const space = await toggleTwice(pipPage, page, 'Space');
  const k = await toggleTwice(pipPage, page, 'k');

  mkdirSync(SHOTS_DIR, { recursive: true });
  await ensurePlaying(page, true);
  await page.waitForTimeout(1500);
  const size =
    pipPage.viewportSize() ??
    (await pipPage.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  await pipPage.mouse.move(size.width / 2, size.height / 2);
  await pipPage.mouse.move(size.width / 2 + 5, size.height / 2 + 5);
  await page.waitForTimeout(700);
  await pipPage.screenshot({ path: `${SHOTS_DIR}/${tag}__1-playing-hover.png` });

  await pipPage.keyboard.press('k');
  await page.waitForTimeout(800);
  await pipPage.mouse.move(size.width / 2, size.height / 3);
  await page.waitForTimeout(700);
  await pipPage.screenshot({ path: `${SHOTS_DIR}/${tag}__2-paused-hover.png` });

  const carousel = await page.evaluate(
    () =>
      window.documentPictureInPicture?.window?.document.querySelectorAll('ytd-shorts-carousel')
        .length ?? -1
  );
  const lines = [
    `[RESULT ${tag}] forced env: ${forced || 'none'}; PiP size ${size.width}x${size.height}`,
    `[RESULT ${tag}] PiP Space: ${space}`,
    `[RESULT ${tag}] PiP K:     ${k}`,
    `[RESULT ${tag}] carousel in PiP: ${carousel}`,
  ];
  console.log(lines.join('\n'));
});
