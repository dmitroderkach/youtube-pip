/**
 * E2E: every title the main page's <title> actually got — Chrome passes each one to the tab right away, so even a
 * title replaced a few milliseconds later shows up as a flicker. Catches the title flickering to "YouTube" while
 * PiP opens (YouTube writes it when the mini player activates; TitleSyncHandler holds the video title).
 */
import type { Page } from '@playwright/test';

type TitleRecorderWindow = Window & {
  __e2eTitles?: string[];
  __e2eTitleObserver?: MutationObserver;
};

/** Start recording every value applied to the page title (text set on <title> or a new <title>). */
export async function startPageTitleRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as TitleRecorderWindow;
    const titles: string[] = [document.title];
    w.__e2eTitles = titles;
    const push = (text: string | null): void => {
      if (text !== null && titles[titles.length - 1] !== text) titles.push(text);
    };
    const inTitle = (node: Node): boolean =>
      node.nodeName === 'TITLE' || node.parentNode?.nodeName === 'TITLE';
    w.__e2eTitleObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData' && inTitle(record.target)) {
          push(record.target.textContent);
        }
        for (const node of Array.from(record.addedNodes)) {
          if (inTitle(node)) push(node.textContent);
        }
      }
    });
    w.__e2eTitleObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

/** Stop recording; returns the distinct titles in order (first = title when recording started). */
export async function stopPageTitleRecorder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = window as TitleRecorderWindow;
    w.__e2eTitleObserver?.disconnect();
    const titles = w.__e2eTitles ?? [];
    delete w.__e2eTitles;
    delete w.__e2eTitleObserver;
    return titles;
  });
}
