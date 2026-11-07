/**
 * E2E: the main page's tab title as painted, frame by frame — to catch a title that flickers to "YouTube" while
 * PiP opens (YouTube sets it when the mini player activates; TitleSyncHandler.holdPageTitle keeps the video title).
 */
import type { Page } from '@playwright/test';

type TitleRecorderWindow = Window & { __e2eTitles?: string[] };

/** Start recording every distinct document.title seen at an animation frame. */
export async function startPageTitleRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as TitleRecorderWindow;
    w.__e2eTitles = [document.title];
    const tick = (): void => {
      const titles = w.__e2eTitles;
      if (!titles) return;
      if (titles[titles.length - 1] !== document.title) titles.push(document.title);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stop recording; returns the distinct titles in order (first = title when recording started). */
export async function stopPageTitleRecorder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as TitleRecorderWindow;
    const titles = w.__e2eTitles ?? [];
    delete w.__e2eTitles;
    return titles;
  });
}
