/**
 * TEMPORARY check, not to be merged: does Space toggle play / pause in Shorts, on the page and in the PiP popup,
 * with YouTube's `web_fix_shorts_space_key_play_pause` forced on and off. `K` (play / pause too) is the control:
 * it shows that keys reach YouTube's Shorts handler at all. Results go to the log as `[RESULT …]` lines.
 */
import type { Page } from '@playwright/test';
import {
  test,
  waitForShortsPlayerVisibleInMain,
  waitForShortsPlayerVisibleInPip,
} from '../fixtures';

const FLAG = 'web_fix_shorts_space_key_play_pause';

type Target = 'main' | 'pip';
type VideoState = { paused: boolean; t: number } | null;

async function videoState(page: Page, target: Target): Promise<VideoState> {
  return page.evaluate((target) => {
    const doc = target === 'pip' ? window.documentPictureInPicture?.window?.document : document;
    const video = doc?.querySelector<HTMLVideoElement>('ytd-shorts #shorts-player video');
    return video ? { paused: video.paused, t: Number(video.currentTime.toFixed(2)) } : null;
  }, target);
}

/** Start playback through the player API (not a key or a click) and wait until the video plays. */
async function ensurePlaying(page: Page, target: Target): Promise<VideoState> {
  for (let i = 0; i < 20; i++) {
    const state = await videoState(page, target);
    if (state && !state.paused && state.t > 0.3) return state;
    await page.evaluate(() =>
      document.querySelector<HTMLElement & { playVideo?(): void }>('#shorts-player')?.playVideo?.()
    );
    await page.waitForTimeout(500);
  }
  return videoState(page, target);
}

/** Press `key` twice in `keyPage`; the paused state after each press. */
async function pressTwice(
  keyPage: Page,
  page: Page,
  target: Target,
  key: string
): Promise<{ before: VideoState; after1: VideoState; after2: VideoState }> {
  const before = await ensurePlaying(page, target);
  await keyPage.keyboard.press(key);
  await page.waitForTimeout(1200);
  const after1 = await videoState(page, target);
  await keyPage.keyboard.press(key);
  await page.waitForTimeout(1200);
  const after2 = await videoState(page, target);
  return { before, after1, after2 };
}

function summary(r: { before: VideoState; after1: VideoState; after2: VideoState }): string {
  const p = (s: VideoState) => (s ? (s.paused ? 'paused' : 'playing') : 'no video');
  return `${p(r.before)} → ${p(r.after1)} → ${p(r.after2)}`;
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

for (const forced of [true, false]) {
  test.describe(`Space in Shorts, ${FLAG}=${forced}`, () => {
    test.use({ experimentFlags: [forced ? FLAG : `${FLAG}=false`] });

    test(`flag ${forced ? 'on' : 'off'}: Space and K on the page and in PiP`, async ({
      shortsPageReady: page,
      triggerEnterPictureInPicture,
    }, testInfo) => {
      const flagSeen = await page.evaluate(
        (flag) =>
          (
            window as unknown as {
              ytcfg?: { get(key: string): Record<string, unknown> | undefined };
            }
          ).ytcfg?.get('EXPERIMENT_FLAGS')?.[flag],
        FLAG
      );

      await waitForShortsPlayerVisibleInMain(page);
      const mainSpace = await pressTwice(page, page, 'main', 'Space');
      const mainK = await pressTwice(page, page, 'main', 'k');
      await page.screenshot({ path: testInfo.outputPath('main.png') });

      await ensurePlaying(page, 'main');
      await triggerEnterPictureInPicture(page);
      await waitForShortsPlayerVisibleInPip(page);
      const pipPage = page
        .context()
        .pages()
        .find((p) => p !== page);
      let pipSpace = 'no PiP page';
      let pipK = 'no PiP page';
      if (pipPage) {
        await pipPage.bringToFront().catch(() => undefined);
        pipSpace = summary(await pressTwice(pipPage, page, 'pip', 'Space'));
        pipK = summary(await pressTwice(pipPage, page, 'pip', 'k'));
        await pipPage.screenshot({ path: testInfo.outputPath('pip.png') }).catch(() => undefined);
      }

      const lines = [
        `[RESULT ${FLAG}=${forced}] flag in ytcfg: ${String(flagSeen)}`,
        `[RESULT ${FLAG}=${forced}] page  Space: ${summary(mainSpace)}`,
        `[RESULT ${FLAG}=${forced}] page  K:     ${summary(mainK)}`,
        `[RESULT ${FLAG}=${forced}] PiP   Space: ${pipSpace}`,
        `[RESULT ${FLAG}=${forced}] PiP   K:     ${pipK}`,
        `[RESULT ${FLAG}=${forced}] raw ${JSON.stringify({ mainSpace, mainK })}`,
      ];
      console.log(lines.join('\n'));
      await testInfo.attach('result', { body: lines.join('\n'), contentType: 'text/plain' });
    });
  });
}
