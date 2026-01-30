# YouTube PiP

Smart Picture-in-Picture mode for YouTube with full playback controls, SPA navigation, like/dislike, seek, and context menu support. Runs as a Tampermonkey userscript.

## 📚 Documentation

- **[YouTube Internal API Usage](docs/YOUTUBE_INTERNAL_API.md)** - Comprehensive guide on how we interact with YouTube's Kevlar framework

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
│   ├── main.ts              # Entry point, YouTubePiPApp, PiP handler setup
│   ├── logger.ts            # Scoped logger (Intl.DateTimeFormat, %c styles, global metadata)
│   ├── selectors.ts         # DOM selectors
│   ├── styles.css           # PiP CSS fixes (mini player, progress bar, etc.)
│   ├── styles.ts            # Re-exports styles.css as CSS_FIXES (?raw)
│   ├── vite-env.d.ts        # Vite client types, *.css?raw module declaration
│   │
│   ├── constants/           # Application constants (barrel export via index.ts)
│   │   ├── index.ts         # Re-exports all constants
│   │   ├── app.ts           # DEBUG_FLAG, TIMEOUTS, RETRY_LIMITS, DEFAULT_DIMENSIONS
│   │   ├── youtube.ts       # PLAYER_STATES, YT_EVENTS, YT_ACTION_NAMES, YT_LIKE_ACTIONS, etc.
│   │   └── ui.ts            # COPY_MENU_INDICES, MOUSE_BUTTONS
│   │
│   ├── core/                # PiP lifecycle and YouTube integration
│   │   ├── PiPManager.ts    # Document PiP window, move player main ↔ PiP
│   │   ├── PlayerManager.ts # Player state, video data, playback time
│   │   ├── NavigationHandler.ts  # SPA navigation in PiP (yt-navigate)
│   │   └── YtActionSender.ts     # Like/dislike/remove → main app
│   │
│   ├── errors/              # Custom error classes
│   │   ├── AppError.ts      # Base error class
│   │   ├── AppInitializationError.ts  # App init failures
│   │   ├── PiPError.ts      # Recoverable PiP errors
│   │   └── PiPCriticalError.ts  # Unrecoverable PiP errors (broken page state)
│   │
│   ├── handlers/
│   │   ├── MediaSessionHandler.ts  # enterpictureinpicture, title sync
│   │   ├── SeekHandler.ts          # Progress bar click/drag
│   │   └── LikeButtonHandler.ts    # Like/dislike in PiP
│   │
│   ├── ui/
│   │   ├── MiniPlayerController.ts # Toggle mini player via yt-action
│   │   ├── MenuObserver.ts         # Menu expand/collapse, PiP height
│   │   ├── ResizeTracker.ts        # ResizeObserver → player size updates
│   │   └── ContextMenuHandler.ts   # Context menu main ↔ PiP, copy menu support
│   │
│   ├── utils/
│   │   ├── DOMUtils.ts      # Placeholders, waitForElement, copyAttributes, copyViaTextarea
│   │   ├── StyleUtils.ts    # copyStyles, injectCSSFixes
│   │   └── VersionDetector.ts  # Script/YouTube/browser version detection
│   │
│   └── types/
│       ├── app.ts           # Nullable, MaybePromise, CopyType, PiPCleanupCallback, etc.
│       ├── youtube.ts       # YouTubePlayer, VideoData, NavigationState, YouTubeAppElement
│       └── global.d.ts      # Document PiP, extended MediaSession types
│
├── docs/
│   └── YOUTUBE_INTERNAL_API.md  # Kevlar API documentation
│
├── dist/
│   └── userscript.js        # Built userscript (IIFE, inline source map)
│
├── scripts/
│   └── release-tag.js       # Create and push git tag from package.json version
│
├── vite.config.ts           # Build config, userscript header, SCRIPT_VERSION injection
├── eslint.config.js         # ESLint flat + TypeScript + Prettier
├── tsconfig.json
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
| `npm run lint`          | ESLint                                               |
| `npm run lint:fix`      | ESLint with `--fix`                                  |
| `npm run prettier`      | Prettier check                                       |
| `npm run prettier:fix`  | Prettier write                                       |
| `npm run version:patch` | Bump version in `package.json` only (no commit/tag)  |
| `npm run release:tag`   | Create tag `v{VERSION}` from `package.json`, push    |

Userscript `@version` is taken from `package.json` during build.

**Release workflow (squash merge):** Run `version:patch`, add code + CHANGELOG + `package.json` to PR, squash merge. On `main`, run `release:tag` so the tag points at the merge commit.

## Tech stack

- **TypeScript** (strict)
- **Vite** (build, Rollup, Terser)
- **ESLint** (flat config, typescript-eslint, eslint-config-prettier)
- **Prettier**
- **Intl API** (native date formatting)

## Author

Dmytro Derkach

## License

MIT — see [LICENSE](LICENSE).
