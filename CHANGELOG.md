# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.3] - 2026-01-29

### Fixed

- **MiniPlayerController**: Fixed YouTube native action event format
  - Added `optionalAction: false` property to both `yt-activate-miniplayer` and `yt-activate-miniplayer-from-watch-action` events
  - Changed `args: null` for `yt-activate-miniplayer-from-watch-action` (was empty array)
  - Standardized `returnValue: [undefined]` for both actions (was `returnValue: []` for one)
  - Ensures events match YouTube's expected format and prevents potential errors

## [1.3.2] - 2026-01-29

### Fixed

- **PiP cleanup**: Centralized cleanup when PiP window closes
  - **main.ts**: PiP cleanup callback now calls `menuObserver.stop()`, `resizeTracker.stop()`, and `navigationHandler.cleanup()` so all handlers are stopped in one place
  - **PiPManager**: Removed `navigationHandler.cleanup()` from `returnPlayerToMain()` (cleanup runs in main callback)
  - **ResizeTracker**: Removed `pagehide` listener that called `stop()` (cleanup runs in main callback)
  - Ensures observers and handlers are always cleaned up when PiP closes, avoiding leaks and duplicate cleanup

## [1.3.1] - 2026-01-29

### Changed

- **MiniPlayerController**: Replaced keyboard simulation with YouTube native API
  - Uses `yt-action` with `yt-activate-miniplayer-from-watch-action` to activate mini player
  - Uses `yt-navigate` with `watchEndpoint` to return to full player
  - Renamed `toggleMiniPlayerViaKeyboard()` to `toggleMiniPlayer()`
  - Added `PlayerManager` as required dependency

- **PlayerManager**: Added `getVideoId()` method and made `getVideoData()` private
  - New `getVideoId()` method retrieves player from DOM and extracts video ID with error logging
  - Centralizes video ID extraction logic for code reuse

- **YtActionSender**: Added `PlayerManager` dependency and refactored to use `getVideoId()`
  - Replaced manual player query and data extraction with `PlayerManager.getVideoId()`
  - Removed `YouTubePlayer` import (no longer needed)
  - Simplified error handling (logging now handled in `PlayerManager`)

- **LikeButtonHandler**: Added `PlayerManager` dependency

- **PiPManager**: Updated to use new `toggleMiniPlayer()` API
  - Simplified mini player restoration logic

### Removed

- **constants.ts**: Removed `KEYBOARD` constants (no longer needed after switching to native API)

## [1.3.0] - 2026-01-28

### Added

- **Custom error classes**: Added error class hierarchy for better error handling
  - `AppError`: Abstract base class with `cause` property and stack trace capture
  - `AppInitializationError`: For initialization errors (MediaSessionHandler)
  - `PiPError`: For PiP-related errors (PiPManager)
  - All error classes support wrapping original errors via `cause` property

### Changed

- **MediaSessionHandler**: Now throws `AppInitializationError` with original error as cause
- **PiPManager**: Now throws `PiPError` instead of generic `Error`

## [1.2.1] - 2026-01-28

### Fixed

- **VersionDetector**: Fixed feature flags structure in metadata
  - Feature flags are now returned directly instead of wrapped in an object
  - Improves metadata structure and makes feature flags more accessible

## [1.2.0] - 2026-01-28

### Added

- **Logger**: YouTube feature flags in global metadata
  - Added `experimentFlags` extraction from `window.ytcfg.data_.EXPERIMENT_FLAGS`
  - Feature flags are now included in global metadata when available
  - Helps identify which YouTube experiments/features are active for debugging

## [1.1.2] - 2026-01-28

### Fixed

- **PiP window**: Fixed scrollbar behavior
  - Changed body overflow from `hidden` to `auto` to allow scrolling when needed

## [1.1.1] - 2026-01-28

### Fixed

- **PiP window**: Fixed scrollbar issues
  - Added `overflow: hidden` to body element to prevent unwanted scrollbars

## [1.1.0] - 2026-01-28

### Added

- **Logger**: Global metadata support for all log messages
  - Added `setGlobalMetadata()` static method to Logger class
  - Global metadata is automatically included in all log messages after user-provided metadata
  - Global metadata includes:
    - `youtubeVersion`: YouTube client version (detected from `window.ytcfg`)
    - `scriptVersion`: Script version (injected at build time from `package.json`)
    - `browserVersion`: Browser name and version (parsed from `navigator.userAgent`, e.g., `Chrome/144.0.0.0`)
  - Browser version parsing supports Chrome, Edge, Firefox, and Safari detection
  - Falls back to full user agent string if browser cannot be identified

- **VersionDetector**: New utility module for version detection
  - `getScriptVersion()`: Gets script version from Vite define injection
  - `getYouTubeVersion()`: Extracts YouTube client version from `window.ytcfg`
  - `getBrowserVersion()`: Parses browser name and version from user agent string
  - `getGlobalMetadata()`: Returns all version information as metadata object

- **Type definitions**: Added type definitions for version detection
  - Added `Window.ytcfg` type definition in `global.d.ts` for YouTube configuration
  - Added `SCRIPT_VERSION` constant declaration in `vite-env.d.ts`

- **Vite configuration**: Added script version injection
  - Added `define` configuration to inject `SCRIPT_VERSION` from `package.json` version at build time

## [1.0.6] - 2026-01-28

### Fixed

- **PiPManager**: Skip title synchronization when PiP is opened from mini player mode
  - When PiP opens from mini player, the title is already set correctly by YouTube
  - Previously, title was being overwritten unnecessarily, causing potential inconsistencies
  - Now checks `wasMiniPlayerActiveBeforePiP` flag before syncing title on open and on MediaSession updates

## [1.0.5] - 2026-01-28

### Fixed

- **MiniPlayerController**: Fixed `TypeError: Cannot read properties of undefined (reading 'push')`
  - Error occurred when calling YouTube's native `yt-activate-miniplayer` action via `ytdApp.fire()`
  - YouTube's internal event handler expected `returnValue` property in the event detail object
  - Added `returnValue: [undefined]` to match YouTube's expected event format
  - Prevents crash when activating mini player using native YouTube API

## [1.0.4] - 2026-01-28

### Fixed

- **PiPManager**: Fixed UX issue when returning from PiP while in mini player mode
  - Previously, the main player would briefly appear before restoring the mini player, causing visual confusion
  - Added conditional check to directly restore mini player without showing main player first
  - Now smoothly returns to mini player state without any intermediate transition

### Changed

- **MiniPlayerController**: Integrated YouTube native actions for mini player control
  - Added `activateMiniPlayer()` method using YouTube's native `yt-activate-miniplayer` action
  - Refactored `toggle()` to `toggleMiniPlayerViaKeyboard()` for clearer distinction between native actions and keyboard simulation
  - Removed unused `show()` and `hide()` methods

- **Logger**: Replaced `dayjs` with native `Intl.DateTimeFormat` API
  - Removed external dependency for timestamp formatting
  - Bundle size reduced by ~26 KB
  - Zero runtime dependencies for date formatting

- **PlayerManager**: Simplified `restorePlayingState()` method
  - No longer needs to be async

### Added

- **YouTubeAppElement**: Added `fire()` method to interface for YouTube native action dispatching

## [1.0.3] - 2026-01-27

### Fixed

- **MenuObserver**: Re-observe menu button when it is removed from DOM
  - YouTube removes the playlist expand button (not just hides it) when navigating to a video without a playlist
  - When navigating back to a video with a playlist, the button reappears but was no longer observed
  - Added removal detection via `MutationObserver` on `document.body`; when button is disconnected, we disconnect observers, re-wait for the button, and re-observe

## [1.0.2] - 2026-01-27

### Changed

- **NavigationHandler**: Removed `history.pushState` when navigating from PiP
  - YouTube does not update the URL in the mini player, so we no longer update it on the main page
  - Only `popstate` event is dispatched to trigger SPA navigation

## [1.0.1] - 2026-01-27

### Fixed

- **MenuObserver**: Fixed playlist expand button detection when navigating within video playlists
  - The expand button may not appear immediately when opening a regular video in PiP
  - Button can appear later during navigation within a video playlist while PiP is already open
  - Replaced `querySelector` with `waitForElementSelector` to wait indefinitely for the button to appear
  - Automatically aborts if PiP window closes before button appears
  - Initialization runs in background (non-blocking)

## [1.0.0] - 2026-01-26

### Added

- **Initial release** of YouTube PiP userscript
- **Document Picture-in-Picture** support using Chrome's Document PiP API
- **Media Session integration** for triggering PiP from native media controls
- **SPA navigation** - video links in PiP navigate without page reloads
- **Seek support** - click or drag progress bar in PiP window
- **Like/Dislike buttons** - fully functional in PiP window
- **Context menu** - seamlessly moves between main window and PiP
- **Playlist panel** - automatic window height adjustment when expanded
- **Title synchronization** - window titles stay in sync via Media Session API
- **Playback state preservation** - position and playing state preserved on PiP close
- **Modular TypeScript architecture** with OOP design
- **Scoped logger** with conditional debug mode via `localStorage`
- **Build system** using Vite with inline source maps
- **ESLint and Prettier** for code quality
- **GitHub Actions** for CI/CD and automated releases
- **Comprehensive documentation** (README, LICENSE, CHANGELOG)

[1.3.3]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.3.2...refs/tags/v1.3.3
[1.3.2]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.3.1...refs/tags/v1.3.2
[1.3.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.3.0...refs/tags/v1.3.1
[1.3.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.2.1...refs/tags/v1.3.0
[1.2.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.2.0...refs/tags/v1.2.1
[1.2.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.1.2...refs/tags/v1.2.0
[1.1.2]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.1.1...refs/tags/v1.1.2
[1.1.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.1.0...refs/tags/v1.1.1
[1.1.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.0.6...refs/tags/v1.1.0
[1.0.6]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.0.5...refs/tags/v1.0.6
[1.0.5]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.0.4...refs/tags/v1.0.5
[1.0.4]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.0.3...refs/tags/v1.0.4
[1.0.3]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.0.2...refs/tags/v1.0.3
[1.0.2]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.0.1...refs/tags/v1.0.2
[1.0.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.0.0...refs/tags/v1.0.1
[1.0.0]: https://github.com/dmitroderkach/youtube-pip/tree/v1.0.0
