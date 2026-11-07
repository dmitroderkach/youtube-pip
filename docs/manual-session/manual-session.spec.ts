/**
 * Manual verification session (not part of the e2e suite): opens a visible browser with the built userscript and
 * waits until the window is closed. How to run: docs/MANUAL_SESSION.md.
 *
 * Playwright's Chromium has no PiP button in its media controls, so a floating "Open PiP" button triggers the
 * userscript's enterpictureinpicture handler through the e2e handler stub (window.__E2E_PIP__).
 */
import { test } from '../../e2e/fixtures';

/** Page to open; override with MANUAL_URL. */
const START_URL =
  process.env.MANUAL_URL ??
  'https://www.youtube.com/watch?v=c9R9VsK54ZQ&list=RDc9R9VsK54ZQ&start_radio=1';

/** Use the frozen test account session (e2e/.auth/storageState.json) unless MANUAL_AUTH=false. */
const USE_AUTH = process.env.MANUAL_AUTH !== 'false';

/** Userscript / stub / page errors are echoed to the terminal. */
const LOG_LINE_RE = /YouTube PiP|E2E|PiP/;
const LOG_LINE_MAX_LENGTH = 300;

test.describe('Manual session', () => {
  test.use({ authState: USE_AUTH });
  test.setTimeout(0);

  test('manual', async ({ page }) => {
    page.on('console', (m) => {
      const text = m.text();
      if (LOG_LINE_RE.test(text) || m.type() === 'error') {
        const clean = text.replace(/%c|color:[^;]+;|font-weight:[^;]+;/g, '');
        console.log(`[page ${m.type()}] ${clean.slice(0, LOG_LINE_MAX_LENGTH)}`);
      }
    });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

    await page.context().addInitScript(() => {
      localStorage.setItem('YOUTUBE_PIP_DEBUG', 'true');
      const addButton = () => {
        if (document.getElementById('e2e-open-pip') || !document.body) return;
        const button = document.createElement('button');
        button.id = 'e2e-open-pip';
        button.textContent = 'Open PiP';
        button.style.cssText =
          'position:fixed;top:70px;right:16px;z-index:2147483647;padding:10px 16px;' +
          'font:600 14px sans-serif;background:#e11d48;color:#fff;border:0;border-radius:8px;cursor:pointer';
        button.addEventListener('click', () => {
          const api = window.__E2E_PIP__;
          console.log(
            `[E2E] Open PiP clicked; handler registered=${api?.has('enterpictureinpicture')}`
          );
          api
            ?.trigger('enterpictureinpicture')
            .catch((err: unknown) => console.log(`[E2E] trigger failed: ${String(err)}`));
        });
        document.body.appendChild(button);
      };
      new MutationObserver(addButton).observe(document, { childList: true, subtree: true });
      document.addEventListener('DOMContentLoaded', addButton);
    });

    await page.goto(START_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForEvent('close', { timeout: 0 });
  });
});
