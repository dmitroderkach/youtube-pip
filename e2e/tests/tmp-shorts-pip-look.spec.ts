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

/** The top controls of the visible reel in this page's document: presence, box, visibility, buttons. */
async function controlsReport(target: Page): Promise<string> {
  return target.evaluate(() => {
    const all = Array.from(document.querySelectorAll<HTMLElement>('ytd-shorts-player-controls'));
    const visible = all.filter((el) => el.getBoundingClientRect().height > 0);
    const el = visible[0] ?? all[0];
    if (!el) return `controls: none (of ${all.length})`;
    const r = el.getBoundingClientRect();
    let hiddenBy = '';
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) {
        hiddenBy = `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''} (display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity})`;
        break;
      }
    }
    const buttons = Array.from(el.querySelectorAll('button'))
      .map((b) => b.getAttribute('aria-label') || b.getAttribute('title') || '?')
      .join(' | ');
    const ours = el.querySelectorAll('.ytpip-shorts-button').length;
    return (
      `controls: ${all.length} (visible ${visible.length}), box ${Math.round(r.x)},${Math.round(r.y)} ` +
      `${Math.round(r.width)}x${Math.round(r.height)}, hidden by: ${hiddenBy || 'nothing'}, ` +
      `our PiP button: ${ours}, buttons: ${buttons}`
    );
  });
}

/** Hover the reel's top controls (or the top of the page when there are none). */
async function hoverControls(target: Page): Promise<void> {
  const box = await target.evaluate(() => {
    const el = Array.from(
      document.querySelectorAll<HTMLElement>('ytd-shorts-player-controls')
    ).find((c) => c.getBoundingClientRect().height > 0);
    const r = el?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  const size = target.viewportSize() ?? { width: 800, height: 600 };
  const point = box ?? { x: size.width / 2, y: 60 };
  await target.mouse.move(point.x - 20, point.y + 40);
  await target.mouse.move(point.x, point.y, { steps: 5 });
  await target.waitForTimeout(800);
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
  mkdirSync(SHOTS_DIR, { recursive: true });
  await hoverControls(page);
  const mainControls = await controlsReport(page);
  await page.screenshot({ path: `${SHOTS_DIR}/${tag}__0-page-hover.png` });
  await triggerEnterPictureInPicture(page);
  await waitForShortsPlayerVisibleInPip(page);
  const pipPage = page
    .context()
    .pages()
    .find((p) => p !== page);
  if (!pipPage) throw new Error('no PiP page');

  const space = await toggleTwice(pipPage, page, 'Space');
  const k = await toggleTwice(pipPage, page, 'k');

  await ensurePlaying(page, true);
  await page.waitForTimeout(1500);
  const size = pipPage.viewportSize() ?? { width: 0, height: 0 };
  await hoverControls(pipPage);
  const pipControlsPlaying = await controlsReport(pipPage);
  await pipPage.screenshot({ path: `${SHOTS_DIR}/${tag}__1-pip-playing-hover.png` });

  await pipPage.keyboard.press('k');
  await page.waitForTimeout(300);
  await pipPage.screenshot({ path: `${SHOTS_DIR}/${tag}__2-pip-right-after-pause.png` });
  await hoverControls(pipPage);
  const pipControlsPaused = await controlsReport(pipPage);
  await pipPage.screenshot({ path: `${SHOTS_DIR}/${tag}__3-pip-paused-hover.png` });

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
    `[RESULT ${tag}] page controls (hover): ${mainControls}`,
    `[RESULT ${tag}] PiP controls (playing, hover): ${pipControlsPlaying}`,
    `[RESULT ${tag}] PiP controls (paused, hover): ${pipControlsPaused}`,
  ];
  console.log(lines.join('\n'));
});
