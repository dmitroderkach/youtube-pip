# E2E tests: implementation

End-to-end tests verify the YouTube PiP userscript on the real YouTube page using Playwright. They cover opening PiP, the context menu, playlist navigation, and focus behaviour.

---

## Structure

```
e2e/
├── constants.ts      # Timeouts and intervals
├── fixtures.ts       # Playwright fixtures (context, pages, helpers)
├── selectors.ts     # CSS selectors for YouTube/PiP (no import from src/)
└── tests/
    ├── pip-stub.spec.ts           # Basic flow: open PiP → close
    ├── mini-player.spec.ts        # PiP from mini player (key "i")
    ├── pip-focus.spec.ts         # Focus in PiP (player, click outside, ESC)
    ├── context-menu-copy.spec.ts # Copy from context menu (URL, embed, debug)
    └── playlist-navigation.spec.ts # Switching video from playlist in PiP
```

---

## Fixtures (`fixtures.ts`)

Fixtures set up the environment for each test: they inject the userscript, open YouTube pages, and provide PiP helpers.

### Userscript injection and handler stub

- **Context** is created with `addInitScript`: before any page loads, a function runs that:
  1. Replaces `navigator.mediaSession.setActionHandler` and collects registered handlers.
  2. Exposes a global API `window.__E2E_PIP__`: `trigger(action)` invokes the handler, `has(action)` checks if it exists.
  3. Runs the userscript body via `eval(userscriptBody)`.

The userscript body is read from `dist/userscript.js` (without the UserScript header). Run `npm run build` before e2e.

### Ready pages

| Fixture                  | Description                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `videoPageReady`         | Opens a fixed video URL (`VIDEO_URL`), accepts consent (skipped on CI), waits until the userscript has registered `enterpictureinpicture`. |
| `playlistVideoPageReady` | Same for a playlist URL (`PLAYLIST_VIDEO_URL`) — used for playlist navigation tests in PiP.                                                |

### PiP helpers

| Fixture                              | Description                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `triggerEnterPictureInPicture(page)` | Calls `__E2E_PIP__.trigger('enterpictureinpicture')` in the page context to open the PiP popup (invokes the handler registered by the userscript).                                                                                                                                                                                               |
| `assertPiPWindowHasPlayer(page)`     | Waits until `documentPictureInPicture.window` contains `ytd-app` and `#movie_player`.                                                                                                                                                                                                                                                            |
| `waitForPiPAdToEnd(page)`            | Waits for ads in PiP to finish: checks that the overlay `.ytp-ad-player-overlay-layout` is gone. If the "Skip ad" button (`.ytp-skip-ad-button`) is present and PiP is a separate page in `context.pages()`, periodically tries to click it (real/trusted click only). Handles multiple ads in a row (stability check after overlay disappears). |

### Consent

- `acceptYouTubeConsent(page)` — clicks the cookie consent button on YouTube. Skipped on CI (consent may not be shown in some regions).

---

## Selectors (`selectors.ts`)

All selectors live in `E2E_SELECTORS` and do not import from `src/`, so e2e does not depend on the main app build. They include:

- YouTube elements: `#movie_player`, `ytd-app`, `ytd-miniplayer`, playlist panel, context menu (`.ytp-popup.ytp-contextmenu`), menu items, ad overlay, Skip ad button;
- For playlist: row (`ytd-playlist-panel-video-renderer`) and the link inside it.

---

## Constants (`constants.ts`)

- `E2E_WAIT_TIMEOUT_MS` — default timeout for waits (e.g. 10s).
- `E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS` — longer timeout for context menu items to appear (ads can delay them).
- `E2E_PIP_AD_STABILITY_MS` — how long the ad overlay must stay gone to consider all ads finished.
- `E2E_PIP_SKIP_AD_POLL_MS` — poll interval for clicking "Skip ad".

---

## Accessing the PiP window

Document Picture-in-Picture provides a separate window with its own `document`. In tests, access is through the main page:

- `page.evaluate(() => window.documentPictureInPicture?.window)` — get the PiP window.
- `pip.document` — the document inside PiP; all element lookups (selectors) run in `pip.document`, not on the main page.

So clicks, visibility checks, and focus checks are done via `page.evaluate(...)` with code that uses `window.documentPictureInPicture.window.document`. Playwright does not expose a separate `Page` for the PiP window in all browsers, so `page.locator()` only targets the main page.

---

## Test descriptions

### 1. `pip-stub.spec.ts` — basic flow

- **Scenario:** `videoPageReady` → trigger PiP → assert player is in PiP → close PiP → assert player is visible again on the main page.
- **Goal:** Ensure the Document PiP stub and userscript correctly open/close PiP and move content.

### 2. `mini-player.spec.ts` — PiP from mini player

- **Scenario:** On the video page, press "i" → wait for mini player (`.ytdMiniplayerComponentHost`) → trigger PiP → assert PiP → close PiP → wait for PiP to close → assert mini player is visible again.
- **Goal:** Verify the flow "mini player on page → open PiP → close → mini player remains".

### 3. `pip-focus.spec.ts` — focus in PiP

- **Scenario:** After opening PiP, assert focus is on `#movie_player`; click "outside" (below the player) — focus should return to the page; open context menu — focus is not on the menu (menu is not focused); after ESC — focus is back on the player.
- **Implementation:** Helpers run in PiP context: check `document.activeElement` against player/menu, click outside via `elementFromPoint` and `dispatchEvent(MouseEvent)`, open context menu via `contextmenu` on the player.

### 4. `context-menu-copy.spec.ts` — copy from context menu

- **Scenario:** Open PiP, wait for ads to end, then for each item (Copy video URL, Copy URL at time, Copy embed iframe, Copy debug info): wait for the item to be visible, click it, assert clipboard content via `expect.poll(() => navigator.clipboard.readText())`.
- **Details:** Longer timeout for menu items (ads); before asserting "URL at time", a short delay so `currentTime` updates; for debug info, assert clipboard contains valid JSON.
- **Menu access:** Context menu is opened in PiP via `dispatchEvent(contextmenu)` on the player; items are selected by index using `.ytp-panel-menu > .ytp-menuitem`.

### 5. `playlist-navigation.spec.ts` — playlist navigation in PiP

- **Scenario:** `playlistVideoPageReady` (video in a playlist) → trigger PiP → assert PiP → wait for ad end → in PiP: wait for mini player, expand playlist (click expand button), wait for playlist panel and second list item to be visible → click second item → wait for ad end if shown → assert the clicked item has the `selected` attribute.
- **Implementation:** All PiP actions run via `page.evaluate` with access to `documentPictureInPicture.window.document`; selectors target mini player, expand button, playlist panel, rows (`PLAYLIST_VIDEO_ROW`) and links (`PLAYLIST_VIDEO_ITEM`). Success is defined as the corresponding `ytd-playlist-panel-video-renderer` having the `selected` attribute (checked with `item.closest(rowSel).hasAttribute('selected')`), without relying on `video.src`, so the test does not fail on CI when video loading is blocked (e.g. "Sign in to confirm you're not a bot").

---

## Running

- **Before e2e:** `npm run build` (requires `dist/userscript.js`).
- **Browser:** Playwright with Chromium (in CI: `npx playwright install --with-deps chromium`).
- **Command:** `npm run test:e2e` (or `npx playwright test` from project root with e2e config).

Tests run against real YouTube; on CI you may see flakiness due to ads, consent, or bot detection. The playlist-navigation test uses the `selected` assertion instead of video load to reduce dependence on the player fully loading.
