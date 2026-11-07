# 🏗️ Architecture Decisions & Design Patterns

This document outlines the core engineering principles and technical decisions that make **YouTube PiP** more stable and resilient than a typical userscript.

---

## 1. Inversion of Control: Custom Dependency Injection (DI)

Instead of global variables or complex object passing, we use a custom **DI Container** with decorators (`@injectable`, `@inject`).

- **Decision**: Decouple component logic from their dependencies.
- **Why?**: YouTube's UI (Kevlar) is extremely dynamic. DI allows us to swap providers (like `YtdAppProvider`) or handlers without touching the core `PiPManager` logic. It also simplifies **Playwright E2E testing** by allowing us to stub specific dependencies.
- **Safety**: The container includes a circular dependency detector to prevent runtime deadlocks during initialization.

---

## 2. Concurrency Control: The `AsyncLock` Mechanism

Opening a Document PiP window is an asynchronous operation that requires **Transient User Activation**.

- **Decision**: Implement a serialized execution queue via `AsyncLock`.
- **Why?**: If a user double-clicks or triggers multiple PiP actions, `withLock` ensures that each request is handled sequentially. This prevents "phantom windows" and ensures that the player's DOM state is consistent before the next operation begins.

---

## 3. Lifecycle Reconstruction: The "Shorts Reinit" Hack

Returning the `ytd-shorts` element from PiP to the main window often triggers a **Render Loop** bug in YouTube's Polymer framework, consuming 100% CPU and breaking metadata updates.

- **Decision**: Briefly remove the element from the DOM and restore it when the tab becomes active. Restore is scheduled via `requestIdleCallback` (with a timeout) when available, otherwise via `requestAnimationFrame`.
- **Why?**: This "hard reset" of the component's lifecycle forces Kevlar to re-attach its internal observers and stop stale rendering cycles. Running restore in the idle phase (when possible) avoids blocking the main thread. It's a radical but necessary solution for long-term stability.

---

## 4. DOM Interception: "Menu Swapping" Strategy

Unlike other scripts that try to rebuild the YouTube context menu, we intercept and **physically move** the native DOM element.

- **Decision**: Use a `MutationObserver` to detect when the native menu opens in the main window, move it to the PiP body, and return it with a synthetic event upon closing.
- **Why?**: Rebuilding YouTube's complex context menu logic (with all its dynamic links and IDs) is error-prone. Moving the actual DOM element preserves 100% of native functionality (Copy URL, Debug Info, etc.).

---

## 5. Cross-Window Synchronization: The Event Bridge

Document PiP windows have their own `document` but need to affect the state of the main tab.

- **Decision**: Implement a bridge (`PiPEventBridgeHandler`) that forwards `yt-navigate` and `yt-action` events from the PiP document to the main window's `ytd-app`. It runs for **both** Shorts and the mini player.
- **Why?**: This allows the main YouTube app to handle things like Like/Dislike actions and SPA navigation as if they were happening on the main page, maintaining total state synchronization.
- **Native events over private commands (Nov 2026)**: The mini player used to handle like/dislike itself (`LikeButtonHandler` + `YtActionSender` calling `ytdApp.resolveCommand({ likeEndpoint })`). YouTube removed `resolveCommand` from `ytd-app`, which silently broke likes in PiP. Instead of switching to another private method (`handleCommandWithCommandHandler`), we deleted that code and let the native like button's own `yt-action` (`yt-service-request`) travel through the bridge. Rule of thumb: if a component inside PiP already does the action on click, bridge its event; do not rebuild Kevlar commands. Details and the list of removed code: `docs/YOUTUBE_INTERNAL_API.md` → _Kevlar Command System (deprecated)_.

---

## 6. Developer Experience: Sourcemap Offset Plugin

Tampermonkey wraps userscripts in a wrapper function, which normally breaks sourcemap alignment in DevTools.

- **Decision**: A custom Vite plugin (`tampermonkeySourceMapOffsetPlugin`) that manually shifts the Base64-encoded sourcemap mappings.
- **Why?**: This allows us to debug the original TypeScript source files directly in the browser console despite the wrapper, significantly reducing the time spent on "blind" debugging.

---

## 7. Dynamic UI: The `MenuObserver` & Window Resizing

A common issue with PiP is that expanded content (like playlists) gets cut off.

- **Decision**: Observe the `aria-expanded` attribute on the menu button to trigger `pipWindow.resizeTo()`.
- **Why?**: This provides a fluid, app-like experience where the PiP window automatically expands to show the playlist and shrinks when the user focuses back on the video.

---

## 8. DOM Move & Restore: The Placeholder Pattern

When we move elements (mini player, Shorts, context menu) into the PiP window, we must be able to put them back in the **exact same place** in the main document.

- **Decision**: Before moving an element, insert a **comment node** (placeholder) in its place; when restoring, insert the element back before the placeholder and remove the placeholder.
- **Why?**: YouTube's layout and other scripts may rely on DOM order or sibling relationships. A comment is invisible and doesn't affect layout, but preserves the position. This avoids "where did the player go?" bugs and keeps the main page structure intact after PiP close.

---

## 9. Copy in PiP: Intercept Clicks, Copy via Temporary Textarea

YouTube's context menu "Copy" actions use a **hidden textarea** in the main window. When the menu is moved to the PiP window, that textarea is no longer in the same document, so native copy would fail or copy wrong content.

- **Decision**: Intercept clicks on copy menu items (by index) in the PiP document; build the payload ourselves (URL, URL at time, embed, debug info) and copy to clipboard using a **temporary textarea** in the PiP document and `document.execCommand('copy')` (or `navigator.clipboard.writeText` where available).
- **Why?**: Reusing YouTube's internal copy logic would require reverse-engineering and would break when they change it. We own the payload format (see `buildCopyPayload`, `COPY_MENU_POSITIONS_FROM_END`) and guarantee correct behaviour in PiP regardless of where the menu is rendered.
- **Feedback like on the page**: after our copy YouTube's own item handler still runs, so it closes the menu and shows its "copied" bezel in the player (link / embed / check icon). Its own copy (`execCommand('copy')` in the main document) fails while the user interacts with PiP — on failure YouTube keeps the menu open, shows the text in a sub-panel and switches the items to "Get …" — so `DOMUtils.reportNextCopyCommandAsSucceeded(document)` makes that one call return true without copying (the clipboard keeps our text; the override is removed on first use or at the next task). If YouTube's handler did not run, we close the menu ourselves (`dismissMenu`).

---

## 10. PiP Lifecycle: `onBeforeReturn` and Phantom Window Detection

Closing the PiP window can happen in two ways: the user clicks our close path (which we handle) or they close the window via the OS (e.g. window controls). The DOM and handlers must be torn down in a defined order.

- **Decision**: `PiPManager` stores a cleanup callback **`onBeforeReturn`** returned by the handlers' `initialize()`. When closing (either path), we call `onBeforeReturn()` **before** moving the player/Shorts back to the main page. We also register `pipWindow.addEventListener('pagehide', this.close)` and run a delayed check: if `pipWindow.closed` is true shortly after open, we treat it as a "phantom" window and run the same cleanup.
- **Why?**: Handlers (e.g. context menu) need to move the menu back to main and disconnect observers **before** we restore the player DOM. Serializing this via a single callback keeps the flow predictable. Phantom detection handles the case where the user closes the PiP window from the outside so we don't leave the main page in a broken state (e.g. player still "stolen").

---

## 11. E2E: Handler Stub and Script Injection (No Browser PiP Button)

E2E tests run against **real YouTube** with the real userscript, but we must open Document PiP programmatically without relying on the browser's "Enter Picture-in-Picture" button or user gestures.

- **Decision**: In Playwright, use **`addInitScript`** to run a **handler stub** before any page load: override `navigator.mediaSession.setActionHandler` to capture the handlers the userscript registers, then expose a global `window.__E2E_PIP__` with `trigger(action)` and `has(action)`. After the stub, `eval(userscriptBody)` so the script runs and registers its handlers. Tests then call `__E2E_PIP__.trigger('enterpictureinpicture')` to open PiP.
- **Why?**: Document PiP requires **transient user activation**; Playwright's `page.click()` or similar can provide that in the right order. By stubbing at the MediaSession level, we invoke the exact same code path the script uses when the user clicks the native PiP control, without depending on browser UI or timing. The userscript is loaded from `dist/userscript.js` (build required before e2e); the stub runs in the same context as the script, so no cross-origin or frame issues.

---

## 12. E2E: Frozen Auth State (No Refresh from CI)

Tests that need a logged-in YouTube session (e.g. like/dislike) use Playwright **storage state** (cookies + localStorage). That state must be created somewhere and then used in CI.

- **Decision**: Store the state file in `e2e/.auth/storageState.json`. In CI, if the file is **missing** and the env var **`E2E_STORAGE_STATE_BASE64`** is set (e.g. from a GitHub secret), decode it and write the file once. **Never** refresh or update the storage state from CI (no `storeAuthState` in CI, no re-login in the datacenter). Locally, `storeAuthState: true` can write the state back for one-off capture.
- **Why?**: Google often treats datacenter IPs as suspicious; logging in or refreshing the session from CI can get the session bound to that IP and then fail or be challenged. By "freezing" the state—capturing it once from a normal environment (e.g. home or office) and reusing it in CI without ever updating it there—we avoid associating the session with CI IPs. When the state eventually expires, re-capture from a normal IP and update the secret; do not refresh from CI.

---

## 13. E2E: Isolated Selectors and No `src/` Import

E2E tests need to locate elements on the YouTube page and inside the PiP document (player, playlist, context menu, like button, etc.).

- **Decision**: All E2E selectors live in **`e2e/selectors.ts`** (`E2E_SELECTORS`). The e2e layer **does not import** from `src/` (no `src/selectors.ts`, no app types in e2e).
- **Why?**: Keeps e2e decoupled from the app build and from refactors of the app's selectors. If the app changes a selector for implementation reasons, e2e can keep using the same DOM shape for stability, or update only in one place. It also makes it explicit what the tests depend on (real YouTube DOM), not the app's internal naming.

---

## 14. CI Infrastructure: Self-Hosted Runners for E2E Tests

E2E tests log into YouTube using a dedicated test Google account (session captured as frozen auth state, see §12).

- **Decision**: Run all CI jobs on self-hosted Fargate runners with a fixed Elastic IP, rather than standard GitHub-hosted runners.
- **Why?**: Google actively blocks authentication and API access from GitHub Actions IP ranges — those datacenter IPs are on Google's unwanted list. When E2E tests run on github-hosted runners the test account gets challenged or outright banned, causing the entire suite to fail. A self-hosted runner behind our own static Elastic IP is treated by Google like traffic from a known, stable origin, so sessions remain valid and tests pass reliably.
- **Consequence**: The NAT EC2 instance (which carries the Elastic IP) must be running for any CI job to reach Google. The `runner_nat_lifecycle` Lambda manages its start/stop lifecycle automatically (see `docs/SELF_HOSTED_RUNNERS.md`).
- **Size and price**: the runner task is 8 vCPU / 16 GB on **Fargate Spot** with an on-demand fallback, and Playwright runs 8 workers. Fargate bills vCPU- and GB-seconds linearly, so a bigger task only pays off as far as the run gets shorter; fixed setup time (task start, `npm ci`, unit tests) and the longest tests limit that to ~2.4×. Spot pricing makes the faster run ~2× cheaper than the former 2 vCPU on-demand task. Higher concurrency also means a faster burst of YouTube loads from one IP; if Google's "unusual traffic" CAPTCHA shows up, lower `CI_WORKERS` in `playwright.config.ts`.

---

## 15. Framework-level Conflict Resolution: The Monkey Patch Guard

When moving complex elements like `ytd-shorts` between the main window and the PiP document, we encounter a fundamental architectural conflict with YouTube's Kevlar engine.

- **Decision**: Implement a temporary **"Safety Shield"** by monkey-patching the Shorts element's `loadVideo` method with a no-op during DOM transitions.
- **Why?**: YouTube uses internal observers (e.g. `IntersectionObserver`) and lifecycle callbacks that trigger a playback reset when a component is moved in the DOM. To Kevlar, a cross-document move looks like a fresh initialization, causing it to call `loadVideo(index: 0)` repeatedly (up to 100 times/sec). This "log storm" leads to metadata desync (flickering likes/comments) and resets the user's position in the reel.

**The "Idle Detection" logic**: Instead of a fixed timer, we use a **200ms sliding window**. We ignore all reset attempts and only restore the original `loadVideo` method once the framework has "calmed down" (i.e. no new calls detected within the window). This is more resilient than relying solely on `requestIdleCallback`, as it accounts for Kevlar's scheduled microtasks that often trigger after the browser enters an idle state.

---

## 16. Media Session: Guarding the `enterpictureinpicture` Handler

PiP opens only from Chrome's media controls (or auto-PiP), which call the page's Media Session `enterpictureinpicture` action handler. A page can have just one handler per action.

- **Decision**: After registering our handler, `MediaSessionHandler` replaces `navigator.mediaSession.setActionHandler` with a wrapper that ignores further calls for `enterpictureinpicture` and passes every other action through unchanged.
- **Why?**: YouTube's own PiP experiments (`web_shorts_pip`, `web_watch_pip`, seen in Nov 2026) call `setActionHandler('enterpictureinpicture', …)` on every SPA navigation, either installing YouTube's handler (on Shorts) or clearing it with `null`. Either way our handler was gone after the first navigation, and the PiP button did nothing. Re-registering after navigation would race with YouTube's own call; owning the setter is deterministic.
- **Consequence**: YouTube's native Shorts PiP is disabled while the userscript runs; that is intended, since the userscript provides its own. Blocked attempts are logged at debug level as `Blocked override of enterpictureinpicture handler`. The e2e handler stub still sees our handler, because our wrapper sits in front of the stub's.

---

## 17. CoW Components: Moving the Player with YouTube's `appendTo`

YouTube renders newer UI as "Component on Web Component" (CoW) wrappers around its signals-based framework. A CoW element disposes its component and clears its content (`innerText = ""`) in `disconnectedCallback`, unless the move was marked as a reparent by YouTube's internal helper (a module-private flag + `moveBefore`). `ytd-miniplayer` is a CoW component, and with `kevlar_player_cow_player_component_*` the player itself (`ytw-player-with-controls`, holding `#movie_player` / `#shorts-player`) is one too.

- **Decision**: Before moving the mini player or `ytd-shorts` into PiP (and back), park `ytd-player` in a temporary holder with `ytdPlayer.appendTo(holder)`, move the rest as before, then `appendTo` it back into its slot (`PiPManager.parkYtdPlayer` / `unparkYtdPlayer`). When returning to the mini player, move the player into the fresh `ytd-miniplayer-player-container` YouTube rendered and drop our old container (only once the player has left it).
- **Why?**: `ytd-player.appendTo()` is YouTube's own move; with CoW players it uses the reparent-safe path, so the player instance (video, position, listeners) survives. A plain `appendChild` disposed it: PiP showed a fresh empty player, the mini player was left without a player after closing PiP, and `#movie_player` disappeared from the page. Without the experiment `appendTo` falls back to `appendChild`, so behaviour is unchanged.
- **Consequence**: The mini player host still re-renders after each cross-document move (it is CoW); we rely on that fresh render and only move `ytd-player` into it.
- **Same for Shorts** with `web_migrate_reel_video_renderer_to_cow`: the player's slot sits inside `ytd-reel-video-renderer-cow`, which re-renders after `ytd-shorts` moves, so the slot we parked from is detached. `parkYtdPlayer` remembers the CoW host around the slot (`liveSlot`: its parent + `<host tag> [id="…"]`) and `unparkYtdPlayer` waits for the fresh slot there when the old one is no longer connected. Never remove a mini player container that still holds `#movie_player`. This path is covered by the e2e flag matrix (`chromium-cow-player`, `chromium-all-flags`); see `docs/YOUTUBE_EXPERIMENT_FLAGS.md`.

**Related: context menu position.** Without `web_watch_pip` / `web_shorts_pip`, YouTube opens the player context menu in the main document and clamps it to the main window; after we move it into PiP it can overflow the PiP window. `ContextMenuHandler.fitMenuIntoPip` shifts it left/up to fit, matching how YouTube positions the menu when it opens inside PiP. With those flags the menu already opens in the PiP document (and YouTube's close/Escape listeners live there, which is why dismissal also dispatches a synthetic `contextmenu` on the PiP body and handles Escape itself).

## 18. Mini Player Activation: Waiting for YouTube's Scheduler

With `kevlar_watch_while_v2` the watch page observes its player container with an `IntersectionObserver` (threshold 0.25). Each callback queues a **low-priority** job on YouTube's scheduler (`addLowPriorityJob(fn, 100)` = `yt.scheduler.instance.addJob(fn, 1, 100)`) that decides from the entry it was queued with: player visible (`ratio > 0.25`) and mini player active → `deactivate()`. The first callback arrives right after the page loads, with the player visible. On a busy page (pre-roll ad, navigation) YouTube holds low-priority jobs back for seconds; if the mini player is activated in that window (PiP from the watch page, or `i`), the stale job then deactivates it ~100 ms after it appears: the player goes back into the hidden watch page and PiP opens without a player or not at all. YouTube does not recover by itself, and `yt-activate-miniplayer` is ignored afterwards (no activation reason is set).

- **Decision**: Before activating the mini player for PiP (`PiPManager.movePlayerToPIP`, full watch page only), wait for `YouTubeScheduler.waitForLowPriorityJobs()`: it queues our own job with the same priority and delay and resolves when it runs. Jobs of one priority run in FIFO order, so any pending watch-while job runs first, while the mini player is still inactive (a no-op). The wait is capped at `TIMEOUTS.YOUTUBE_LOW_PRIORITY_JOBS` (2 s, below Chrome's ~5 s user activation window that `requestWindow()` needs) and skipped when the scheduler is not exposed.
- **Why?**: Only the public `yt.scheduler.instance.addJob` is used, no scheduler internals and no patching of `IntersectionObserver`. The usual cost is ~100 ms. Recovering after the fact is not possible (see above).
- **Consequence**: Found through CI flakes in `chromium-all-flags` (the only matrix project with `kevlar_watch_while_v2`); the e2e mini player timeline showed `deactivate()` called from a scheduler job of the watch module. Reproduced locally by holding low-priority jobs back (`setPriorityThreshold(2)`) after the first watch-while callback. E2E page-ready fixtures use the same barrier before the test acts (`docs/E2E_TESTS.md`).
