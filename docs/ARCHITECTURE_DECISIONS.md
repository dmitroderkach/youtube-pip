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

- **Decision**: Briefly remove the element from the DOM and restore it via `requestAnimationFrame` when the tab becomes active.
- **Why?**: This "hard reset" of the component's lifecycle forces Kevlar to re-attach its internal observers and stop stale rendering cycles. It's a radical but necessary solution for long-term stability.

---

## 4. DOM Interception: "Menu Swapping" Strategy

Unlike other scripts that try to rebuild the YouTube context menu, we intercept and **physically move** the native DOM element.

- **Decision**: Use a `MutationObserver` to detect when the native menu opens in the main window, move it to the PiP body, and return it with a synthetic event upon closing.
- **Why?**: Rebuilding YouTube's complex context menu logic (with all its dynamic links and IDs) is error-prone. Moving the actual DOM element preserves 100% of native functionality (Copy URL, Debug Info, etc.).

---

## 5. Cross-Window Synchronization: The Event Bridge

Document PiP windows have their own `document` but need to affect the state of the main tab.

- **Decision**: Implement a bridge that forwards `yt-navigate` and `yt-action` events from the PiP document to the main window's `ytd-app`.
- **Why?**: This allows the main YouTube app to handle things like Like/Dislike actions and SPA navigation as if they were happening on the main page, maintaining total state synchronization.

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
- **Why?**: Reusing YouTube's internal copy logic would require reverse-engineering and would break when they change it. We own the payload format (see `buildCopyPayload`, `COPY_MENU_INDICES`) and guarantee correct behaviour in PiP regardless of where the menu is rendered.

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
