# E2E tests: implementation

End-to-end tests verify the YouTube PiP userscript on the real YouTube page using Playwright. They cover opening PiP, the context menu, playlist navigation, focus behaviour, and like/dislike in PiP (with auth).

---

## Structure

```
e2e/
├── constants.ts      # Timeouts and intervals
├── fixtures/         # Playwright fixtures (modular)
│   ├── index.ts      # test.extend, page fixtures, re-exports
│   ├── auth.ts       # Storage state path, ensureStorageStateFromSecret, auth options
│   ├── handler-stub.ts # initHandlerStub, getUserscriptBody (browser stub)
│   ├── pip-playlist.ts   # Mini player, expand, panel, items (playlist-navigation, like-dislike)
│   ├── pip-like-dislike.ts # Like/dislike buttons and clicks (like-dislike.spec)
│   └── pip-context-menu.ts # Open menu, wait item visible, click item (context-menu-copy)
├── selectors.ts      # CSS selectors for YouTube/PiP (no import from src/)
└── tests/
    ├── pip-stub.spec.ts              # Basic flow: open PiP → close
    ├── mini-player.spec.ts           # PiP from mini player (key "i")
    ├── context-menu-copy.spec.ts     # Copy from context menu (URL, embed, debug) for regular videos
    ├── playlist-navigation.spec.ts   # Switching video from playlist in PiP
    ├── like-dislike.spec.ts          # Like / remove like / dislike / remove dislike in PiP (auth, network)
    ├── shorts-pip.spec.ts            # Shorts: open PiP and return Shorts player back to main page
    ├── shorts-context-menu-copy.spec.ts # Shorts: context menu copy items in PiP (Shorts URLs)
    └── shorts-navigation.spec.ts     # Shorts: navigate to next reel in PiP (ArrowDown)
```

---

## Fixtures (`fixtures/`)

Fixtures are split into modules. Entry point is `fixtures/index.ts`: it defines `test.extend(...)`, page fixtures (e.g. `videoPageReady`, `playlistVideoPageReady`, `shortsPageReady`), and PiP helpers (`triggerEnterPictureInPicture`, `assertPiPWindowHasPlayer`, `waitForPiPAdToEnd`). It also re-exports shared helpers from `pip-playlist`, `pip-like-dislike`, `pip-context-menu`, and `pip-shorts` so tests can `import { test, waitForMiniPlayerVisibleInPip, waitForShortsPlayerVisibleInPip, scrollToNextShortInPip, ... } from '../fixtures'`. Other modules: **auth.ts** (storage state, secret), **handler-stub.ts** (browser stub), **pip-playlist.ts** (mini player, expand, panel, items), **pip-like-dislike.ts** (like/dislike actions), **pip-context-menu.ts** (open menu, wait/click item), **pip-shorts.ts** (Shorts player visibility + navigation).

### Userscript injection and handler stub

- **Context** is created with `addInitScript`: before any page loads, a function runs that:
  1. Replaces `navigator.mediaSession.setActionHandler` and collects registered handlers.
  2. Exposes a global API `window.__E2E_PIP__`: `trigger(action)` invokes the handler, `has(action)` checks if it exists.
  3. Runs the userscript body via `eval(userscriptBody)`.

The userscript body is read from `dist/userscript.js` (without the UserScript header). Run `npm run build` before e2e.

### Ready pages

| Fixture                  | Description                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `videoPageReady`         | Opens a fixed video URL (`VIDEO_URL`), accepts consent (skipped on CI), waits until the userscript has registered `enterpictureinpicture`.         |
| `playlistVideoPageReady` | Same for a playlist URL (`PLAYLIST_VIDEO_URL`) — used for playlist navigation tests in PiP.                                                        |
| `shortsPageReady`        | Opens the Shorts feed URL (`SHORTS_URL`), accepts consent, waits until the userscript has registered `enterpictureinpicture` and `ytd-shorts` exists. |

### PiP helpers

| Fixture                              | Description                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `triggerEnterPictureInPicture(page)` | Calls `__E2E_PIP__.trigger('enterpictureinpicture')` in the page context to open the PiP popup (invokes the handler registered by the userscript).                                                                                                                                                                                               |
| `assertPiPWindowHasPlayer(page)`     | Waits until `documentPictureInPicture.window` contains `ytd-app` and `#movie_player`.                                                                                                                                                                                                                                                            |
| `waitForPiPAdToEnd(page)`            | Waits for ads in PiP to finish: checks that the overlay `.ytp-ad-player-overlay-layout` is gone. If the "Skip ad" button (`.ytp-skip-ad-button`) is present and PiP is a separate page in `context.pages()`, periodically tries to click it (real/trusted click only). Handles multiple ads in a row (stability check after overlay disappears). |
| `waitForShortsPlayerVisibleInMain`   | Waits until a Shorts player is visible in the main document: `ytd-shorts` with `#shorts-player` and an inner `<video>` element that is displayed and has non-zero height.                                                                                                                                |
| `waitForShortsPlayerVisibleInPip`    | Same, but inside the PiP window (`documentPictureInPicture.window.document`).                                                                                                                                                                                                                                                                    |
| `scrollToNextShortInPip(page)`       | Sends a real `ArrowDown` key press to the PiP `Page` (via `context.pages()`) to navigate to the next Shorts reel, matching how keyboard navigation works for Shorts in the popup.                                                                                                                         |

### Consent

- `acceptYouTubeConsent(page)` — clicks the cookie consent button on YouTube. Skipped on CI (consent may not be shown in some regions).

### Auth flow (`authState: true`)

Some tests need a logged-in YouTube session (e.g. like/dislike). The fixture supports this via the **`authState`** option and the **`E2E_STORAGE_STATE_BASE64`** env var.

**Flow:**

1. **Option:** `test.use({ authState: true })` — the test requests a context that loads Playwright storage state (cookies + localStorage) from `e2e/.auth/storageState.json`.
2. **Create from secret when missing:** The fixture calls `ensureStorageStateFromSecret()`: only if the file **does not exist** and the env var `E2E_STORAGE_STATE_BASE64` is set (e.g. in CI from a GitHub secret), it decodes the base64 string and writes `e2e/.auth/storageState.json`. If the file already exists, it is left as is.
3. **Context:** If the file exists after that, the browser context is created with `storageState: E2E_STORAGE_STATE_PATH`. Otherwise the context is created without storage state (no auth).
4. **On close:** By default the fixture does not write storage state back. If **`storeAuthState: true`** (see below), the fixture writes the context state to `e2e/.auth/storageState.json` before closing.

**Local:** Create `e2e/.auth/storageState.json` yourself (Playwright storage state format) or use **`storeAuthState: true`** once (one-off run with `authState: true` + `storeAuthState: true` while logged in) to save state. If the stored state is broken, delete the file and run again with `storeAuthState: true` while logged in to re-login and save a fresh state. Tests that use `authState: true` (e.g. like-dislike) do not set `storeAuthState` by default.

**CI:** The workflow passes the secret `E2E_STORAGE_STATE_BASE64` (base64-encoded `storageState.json`) into the e2e step. The file does not exist in a fresh job, so the fixture creates it from the secret. No write-back on test end.

### Why we use a frozen storage state (no refresh in CI)

We intentionally **do not** refresh or update the storage state from CI (no `storeAuthState` in CI, no re-login in the datacenter). The state is created once from a “normal” environment (e.g. local machine / home or office IP) and then reused as-is (frozen).

**Reason:** Google often treats datacenter IPs (CI runners, cloud providers) as suspicious: they may block, rate-limit, or require extra verification. In practice:

- The **first** use of a freshly created/updated state from a CI IP can work.
- After that, the session may get tightly bound to that IP or environment; using the same (updated) state again from CI can then fail — Google may reject or challenge the session.
- If we never update the state from the datacenter, the session stays tied to the IP where it was originally created (e.g. a residential or office IP). CI only **loads** that pre-saved state and does not perform login or state write-back, so Google does not associate the session with datacenter IPs.

So we use a **frozen** storage state: capture it once from a trusted environment, store it in the secret, and reuse it in CI until the auth cookies expire (on the order of a year). When the state eventually expires, re-capture it again from a normal IP (local run with `storeAuthState: true`) and update the secret; do not refresh it from CI.

### storeAuthState (local only)

**`test.use({ storeAuthState: true })`** — when the context closes, the fixture writes the current storage state to `e2e/.auth/storageState.json`. Use this **locally** to:

- **First-time login:** Run any test with `authState: true` and `storeAuthState: true` while logged in to YouTube in that run; the file is created/updated for future runs that use `authState: true`.
- **Reset broken state:** If the stored state is invalid or expired, delete `e2e/.auth/storageState.json`, then run a test with `storeAuthState: true` (and optionally `authState: true`) while logging in during the run; the new state is saved.

---

## Selectors (`selectors.ts`)

All selectors live in `E2E_SELECTORS` and do not import from `src/`, so e2e does not depend on the main app build. They include:

- YouTube elements: `#movie_player`, `ytd-app`, `ytd-miniplayer`, playlist panel, context menu (`.ytp-popup.ytp-contextmenu`), menu items, ad overlay, Skip ad button;
- For playlist: row (`ytd-playlist-panel-video-renderer`) and the link inside it;
- For like/dislike: `LIKE_BUTTON` (`ytd-slim-metadata-toggle-button-renderer`), `BUTTON_SHAPE` (`.yt-spec-button-shape-next`); first toggle = like, second = dislike;
- For Shorts: `YTD_SHORTS` (`ytd-shorts` root), `SHORTS_PLAYER` (`#shorts-player`), and `SHORTS_CONTAINER` (`#shorts-container` used for navigation).

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

### 3. `context-menu-copy.spec.ts` — copy from context menu

- **Scenario:** Open PiP, wait for ads to end, then for each item (Copy video URL, Copy URL at time, Copy embed iframe, Copy debug info): wait for the item to be visible, click it, assert clipboard content via `expect.poll(() => navigator.clipboard.readText())`.
- **Details:** Longer timeout for menu items (ads); before asserting "URL at time", a short delay so `currentTime` updates; for debug info, assert clipboard contains valid JSON.
- **Menu access:** Context menu is opened in PiP via `dispatchEvent(contextmenu)` on the player; items are selected by index using `.ytp-panel-menu > .ytp-menuitem`.

### 4. `playlist-navigation.spec.ts` — playlist navigation in PiP

- **Scenario:** `playlistVideoPageReady` (video in a playlist) → trigger PiP → assert PiP → wait for ad end → in PiP: wait for mini player, expand playlist (click expand button), wait for playlist panel and second list item to be visible → click second item → wait for ad end if shown → assert the clicked item has the `selected` attribute.
- **Implementation:** All PiP actions run via `page.evaluate` with access to `documentPictureInPicture.window.document`; selectors target mini player, expand button, playlist panel, rows (`PLAYLIST_VIDEO_ROW`) and links (`PLAYLIST_VIDEO_ITEM`). Success is defined as the corresponding `ytd-playlist-panel-video-renderer` having the `selected` attribute (checked with `item.closest(rowSel).hasAttribute('selected')`), without relying on `video.src`, so the test does not fail on CI when video loading is blocked (e.g. "Sign in to confirm you're not a bot").

### 5. `like-dislike.spec.ts` — like / dislike in PiP (uses auth)

- **Scenario:** `playlistVideoPageReady` with **`authState: true`** → trigger PiP → assert PiP → in PiP: wait for mini player, expand playlist, wait for playlist panel and first item, wait for like/dislike buttons → then **like → remove like → dislike → remove dislike**, asserting each step via the corresponding YouTube API response.
- **Auth:** This test uses `test.use({ authState: true })`, so the browser context is created with storage state from `e2e/.auth/storageState.json`. In CI the file is created from the `E2E_STORAGE_STATE_BASE64` secret when missing. The test does not use `storeAuthState`.
- **Implementation:** All actions run inside the PiP document. Helpers: `waitForLikeButtonsVisibleInPip`, `clickLikeDislikeInPip(page, action)` with `action` in `'LIKE' | 'REMOVE_LIKE' | 'DISLIKE' | 'REMOVE_DISLIKE'`. Before each click, the fixture waits for the correct `aria-pressed` state on the toggle (e.g. like button not pressed before LIKE, pressed before REMOVE_LIKE); after the click it waits for the new state. Clicks are done in PiP via `page.evaluate` (first toggle = like, second = dislike). Network assertions use **`page.waitForResponse(...)`** (not `waitForRequest`) so we wait for the request to complete; URLs: `.../like/like`, `.../like/removelike`, `.../like/dislike`. Each step runs as `Promise.all([waitForResponse(...), clickLikeDislikeInPip(page, action)])`.

### 6. `shorts-pip.spec.ts` — Shorts player moves into PiP and back

- **Scenario:** `shortsPageReady` (Shorts feed page) → ensure Shorts player is visible on the main page → trigger PiP via Media Session → assert base PiP window has `ytd-app` and `#movie_player` → assert Shorts player (`ytd-shorts` + `#shorts-player` + `<video>`) is present in PiP → close PiP → assert Shorts player is back on the main page.
- **Goal:** Verify that Shorts player is correctly moved between the main document and the PiP window without losing the current reel.

### 7. `shorts-context-menu-copy.spec.ts` — context menu copy in Shorts PiP

- **Scenario:** `shortsPageReady` → trigger PiP → wait for Shorts player in PiP → for each menu item (Copy Shorts URL, Copy URL at time, Copy embed iframe, Copy debug info): open context menu in PiP on `#shorts-player`, click item, assert clipboard content via `expect.poll(...)`.
- **Details:** URL assertions are Shorts-specific:
  - "Copy video URL" → `https://www.youtube.com/shorts/VIDEO_ID?feature=share`;
  - "Copy URL at time" → `https://www.youtube.com/shorts/VIDEO_ID?t=N&feature=share`.
  - Embed and debug checks reuse the same expectations as for regular videos.
- **Menu access:** Context menu is opened in PiP via `dispatchEvent(contextmenu)` on `#shorts-player`; items are selected by index using `.ytp-panel-menu > .ytp-menuitem`, same indices as in the regular `context-menu-copy` test.

### 8. `shorts-navigation.spec.ts` — Shorts navigation inside PiP (ArrowDown)

- **Scenario:** `shortsPageReady` → trigger PiP → wait for Shorts player in PiP → read current `video.currentSrc || video.src` from `#shorts-player` inside PiP → send a real `ArrowDown` key press to the PiP `Page` via `scrollToNextShortInPip` → poll `video.currentSrc/src` again and assert it differs from the initial value.
- **Goal:** Verify that keyboard navigation (ArrowDown) inside the PiP window correctly advances to the next Shorts reel and the underlying video source changes.

---

## Running

- **Before e2e:** `npm run build` (requires `dist/userscript.js`).
- **Browser:** Playwright with Chromium (in CI: `npx playwright install --with-deps chromium`).
- **Command:** `npm run test:e2e` (or `npx playwright test` from project root with e2e config).

Tests run against real YouTube; on CI you may see flakiness due to ads, consent, or bot detection. The playlist-navigation test uses the `selected` assertion instead of video load to reduce dependence on the player fully loading. Tests that use `authState: true` (like-dislike) require a valid storage state; in CI it is provided only via the `E2E_STORAGE_STATE_BASE64` secret.
