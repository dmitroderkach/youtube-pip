# YouTube PiP

Smart Picture-in-Picture mode for YouTube with full playback controls, SPA navigation, like/dislike, seek, and context menu support. Runs as a Tampermonkey userscript.

## 📚 Documentation

- **[YouTube Internal API Usage](docs/YOUTUBE_INTERNAL_API.md)** - Comprehensive guide on how we interact with YouTube's Kevlar framework
- **[Resilience Report (Feb 18, 2026 Outage)](docs/RESILIENCE_REPORT.md)** - How the script maintained full functionality during YouTube's global infrastructure failure

## Disclaimer

This project is **not affiliated with, endorsed by, or officially connected to** Google LLC or YouTube. It is an independent, third-party userscript. Use at your own risk. YouTube’s site structure and APIs may change at any time, which can cause this script to break or behave unexpectedly.

## Features

- **Document Picture-in-Picture** — Opens the YouTube mini player in a separate PiP window (Chrome’s Document PiP API).
- **Media Session** — PiP can be triggered from the native media controls (e.g. “Enter Picture-in-Picture” when available).
- **SPA navigation** — Clicks on video links inside PiP navigate within the tab via `history.pushState` / `popstate` instead of full reloads.
- **Seek** — Click or drag on the progress bar in PiP to seek; player size updates on PiP resize.
- **Like / Dislike** — Like and dislike buttons in PiP send actions to the main YouTube app via `ytd-app.resolveCommand`.
- **Context menu** — Right-click menu is moved between main window and PiP; when closed in PiP, it returns to main and a synthetic `contextmenu` is dispatched.
- **Playlist panel** — Menu button expand/collapse is observed; PiP height adjusts when the playlist panel opens.
- **Title sync** — Window titles (main + PiP) stay in sync with `navigator.mediaSession.metadata.title`.
- **Return to main** — On PiP close (`pagehide`), the mini player is restored to the main page; playback state is preserved.

## Requirements

- **Browser:** Chrome (or Chromium-based) with [Document Picture-in-Picture](https://developer.chrome.com/docs/web-platform/document-picture-in-picture/) support.
- **Userscript manager:** [Tampermonkey](https://www.tampermonkey.net/).

## Installation

1. Clone the repo and install dependencies:

   ```bash
   git clone https://github.com/dmitroderkach/youtube-pip.git
   cd youtube-pip
   npm install
   ```

2. Build the userscript:

   ```bash
   npm run build
   ```

3. In Tampermonkey: **Create new script** → remove the default template → paste the contents of `dist/userscript.js` → save.

4. Open [YouTube](https://www.youtube.com/), play a video, and use the media controls or the script’s logic to open PiP (e.g. Media Session “Enter Picture-in-Picture” when available).

## Debug mode

Logging (except `error`) is gated by a flag in `localStorage`:

- Key: `YOUTUBE_PIP_DEBUG`
- Value: `'true'` to enable debug/info logs.

Example (DevTools console on YouTube):

```js
localStorage.setItem('YOUTUBE_PIP_DEBUG', 'true');
```

Then reload the page. Logs are scoped per module and include timestamps (`YYYY-MM-DD:HH:mm:ss.SSS`).

## Project structure

```
youtube-pip/
├── src/
│   ├── main.ts              # Entry point, DI container setup, MediaSessionHandler init
│   ├── logger.ts            # Scoped logger (Intl.DateTimeFormat, %c styles, global metadata)
│   ├── selectors.ts         # DOM selectors
│   ├── styles.css           # PiP CSS fixes (mini player, progress bar, etc.)
│   ├── styles.ts            # Re-exports styles.css as CSS_FIXES (?raw)
│   ├── vite-env.d.ts        # Vite client types, *.css?raw module declaration
│   │
│   ├── constants/           # Application constants (barrel export via index.ts)
│   │   ├── index.ts
│   │   ├── app.ts           # DEBUG_FLAG, TIMEOUTS, RETRY_LIMITS, DEFAULT_DIMENSIONS
│   │   ├── youtube.ts       # PLAYER_STATES, YT_EVENTS, YT_ACTION_NAMES, etc.
│   │   ├── ui.ts            # COPY_MENU_INDICES, MOUSE_BUTTONS
│   │   └── copyPayload.ts
│   │
│   ├── di/                  # Dependency injection (no external libs)
│   │   ├── container.ts     # Container, bind, get
│   │   ├── container-config.ts  # createContainer(), bindings
│   │   ├── decorators.ts    # @injectable, @inject
│   │   ├── metadata.ts      # Param metadata for injection
│   │   ├── types.ts         # TYPES symbols
│   │   ├── index.ts
│   │   └── __tests__/
│   │
│   ├── core/                # PiP lifecycle and YouTube integration
│   │   ├── PiPManager.ts    # Document PiP window, move player main ↔ PiP
│   │   ├── PiPWindowHandlers.ts  # PiP window init, handlers setup + cleanup
│   │   ├── PlayerManager.ts # Player state, video data, playback time
│   │   ├── NavigationHandler.ts  # SPA navigation in PiP (yt-navigate)
│   │   ├── YtActionSender.ts     # Like/dislike/remove → main app
│   │   ├── YtdAppProvider.ts
│   │   ├── PipWindowProvider.ts
│   │   └── __tests__/
│   │
│   ├── errors/              # Custom error classes
│   │   ├── AppError.ts      # Base error class
│   │   ├── AppInitializationError.ts
│   │   ├── AppRuntimeError.ts
│   │   ├── PiPError.ts      # Recoverable PiP errors
│   │   ├── PiPCriticalError.ts
│   │   └── __tests__/
│   │
│   ├── handlers/
│   │   ├── MediaSessionHandler.ts  # enterpictureinpicture, title sync
│   │   ├── DocumentFocusHandler.ts  # Focus restoration (click/keyup)
│   │   ├── TitleSyncHandler.ts      # PiP/main title sync
│   │   ├── SeekHandler.ts          # Progress bar click/drag
│   │   ├── LikeButtonHandler.ts    # Like/dislike in PiP
│   │   └── __tests__/
│   │
│   ├── ui/
│   │   ├── MiniPlayerController.ts # Toggle mini player via yt-action
│   │   ├── MenuObserver.ts         # Menu expand/collapse, PiP height
│   │   ├── ResizeTracker.ts        # ResizeObserver → player size updates
│   │   ├── ContextMenuHandler.ts   # Context menu main ↔ PiP, copy menu support
│   │   └── __tests__/
│   │
│   ├── utils/
│   │   ├── DOMUtils.ts      # Placeholders, waitForElement, copyAttributes, copyViaTextarea
│   │   ├── StyleUtils.ts    # copyStyles, injectCSSFixes
│   │   ├── VersionDetector.ts
│   │   ├── AsyncLock.ts
│   │   ├── copyPayload.ts
│   │   └── __tests__/
│   │
│   ├── test-utils/          # Vitest helpers, test container, mocks
│   │   ├── index.ts
│   │   ├── test-container.ts
│   │   └── test-helpers.ts
│   │
│   └── types/
│       ├── app.ts           # Nullable, MaybePromise, CopyType, PiPCleanupCallback, etc.
│       ├── youtube.ts       # YouTubePlayer, VideoData, NavigationState, YouTubeAppElement
│       └── global.d.ts      # Document PiP, extended MediaSession types
│
├── e2e/                     # Playwright E2E (Document PiP stub, real YouTube)
│   ├── fixtures.ts          # PiP/handler stubs, authState, videoPageReady, playlistVideoPageReady, assertPiPWindowHasPlayer
│   ├── constants.ts         # E2E_WAIT_TIMEOUT_MS, etc.
│   ├── selectors.ts         # E2E_SELECTORS (mini player, playlist, context menu, like/dislike)
│   ├── global.d.ts          # E2E types, MediaSession stub
│   ├── tsconfig.json
│   └── tests/
│       ├── pip-stub.spec.ts         # Open PiP → assert → close → player back
│       ├── mini-player.spec.ts      # Press "i" → mini player → PiP → close
│       ├── pip-focus.spec.ts        # Focus in PiP and after close
│       ├── playlist-navigation.spec.ts  # PiP → expand playlist → switch video
│       ├── context-menu-copy.spec.ts    # Context menu copy (URL, time, embed) in PiP
│       └── like-dislike.spec.ts     # Like/remove/dislike/remove in PiP (auth, network)
│
├── docs/
│   ├── YOUTUBE_INTERNAL_API.md  # Kevlar API documentation
│   └── RESILIENCE_REPORT.md     # Feb 18, 2026 outage resilience report
│
├── .github/
│   └── workflows/
│       └── build.yml       # Lint, type-check, unit tests, build, Playwright e2e (Chromium), report artifact
│
├── dist/
│   └── userscript.js        # Built userscript (IIFE, inline source map)
│
├── scripts/
│   └── release-tag.js       # Create and push git tag from package.json version
│
├── vite.config.ts           # Build config, userscript header, SCRIPT_VERSION injection
├── playwright.config.ts     # E2E config (baseURL, actionTimeout from e2e/constants)
├── eslint.config.js         # ESLint flat + TypeScript + Prettier
├── tsconfig.json            # src/ only
├── tsconfig.eslint.json     # Extends tsconfig, includes src + e2e + root
├── package.json
├── CHANGELOG.md
├── .prettierrc / .prettierignore
├── .gitignore
└── LICENSE
```

## Scripts

| Command                 | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `npm run build`         | Type-check + production build → `dist/userscript.js` |
| `npm run build:debug`   | Debug build (no minify, header via plugin)           |
| `npm run type-check`    | `tsc --noEmit`                                       |
| `npm run test`          | Vitest unit tests (run + coverage)                   |
| `npm run test:e2e`      | Playwright e2e tests (Chromium, YouTube + PiP stub)  |
| `npm run test:e2e:ui`   | Playwright e2e with UI (debug)                       |
| `npm run lint`          | ESLint                                               |
| `npm run lint:fix`      | ESLint with `--fix`                                  |
| `npm run prettier`      | Prettier check                                       |
| `npm run prettier:fix`  | Prettier write                                       |
| `npm run version:patch` | Bump patch in `package.json` only (no commit/tag)    |
| `npm run version:minor` | Bump minor in `package.json` only                    |
| `npm run version:major` | Bump major in `package.json` only                    |
| `npm run release:tag`   | Create tag `v{VERSION}` from `package.json`, push    |

Userscript `@version` is taken from `package.json` during build.

**Release workflow (squash merge):** Run `version:patch`, add code + CHANGELOG + `package.json` to PR, squash merge. On `main`, run `release:tag` so the tag points at the merge commit.

## E2E tests (Playwright)

E2E tests run against real YouTube with the built userscript; Document PiP is stubbed so the flow can be automated.

- **Run:** `npm run test:e2e` (Chromium). Install browsers once: `npx playwright install chromium`.
- **Debug:** `npm run test:e2e:ui` for the Playwright UI.

**Auth.** Some tests use `test.use({ authState: true })` (e.g. like-dislike). They need a logged-in YouTube session:

- **Local:** Run e2e once in a browser where you’re logged in; the fixture saves state to `e2e/.auth/storageState.json` and reuses it. Or create that file yourself (Playwright storage state format).
- **CI:** The workflow passes the `E2E_STORAGE_STATE_BASE64` secret (base64-encoded `storageState.json`) into the e2e step. When the file is missing, the fixture decodes the secret and writes `e2e/.auth/storageState.json` before creating the context. No cache is used; auth state comes only from the secret.

## Tech stack

- **TypeScript** (strict)
- **Vite** (build, Rollup, Terser)
- **Vitest** (unit tests, coverage)
- **Playwright** (e2e tests, Chromium, Document PiP stub on YouTube)
- **ESLint** (flat config, typescript-eslint, eslint-config-prettier)
- **Prettier**
- **Intl API** (native date formatting)

## Author

Dmytro Derkach

## License

MIT — see [LICENSE](LICENSE).
