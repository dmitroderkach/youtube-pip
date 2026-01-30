# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.1] - 2026-01-30

### Changed

- **Project structure**: Constants split into separate files for better organization
  - `src/constants/` folder with barrel export via `index.ts`
  - `app.ts` — application-level constants (DEBUG_FLAG, TIMEOUTS, RETRY_LIMITS, DEFAULT_DIMENSIONS)
  - `youtube.ts` — YouTube API constants (PLAYER_STATES, YT_EVENTS, YT_ACTION_NAMES, YT_LIKE_ACTIONS, etc.)
  - `ui.ts` — UI-related constants (COPY_MENU_INDICES, MOUSE_BUTTONS)
  - All existing imports `from '../constants'` continue to work via barrel export

- **README**: Updated project structure section to reflect current codebase organization
  - Added `constants/` folder structure
  - Added `errors/` folder with error classes
  - Added `docs/` and `scripts/` folders
  - Updated descriptions for modules with new functionality

## [1.6.0] - 2026-01-30

### Added

- **ContextMenuHandler**: Copy menu support in PiP window
  - Intercepts clicks on copy menu items (Copy video URL, Copy URL at current time, Copy embed code)
  - Uses temporary textarea + `execCommand('copy')` since YouTube's hidden textarea in main window is disconnected
  - `handleCopyClick` defined as arrow function property for proper `this` binding
  - Logging for all early-return paths (warn/debug)

- **PlayerManager**: New methods for copy menu support
  - `getVideoDataFromDocument(doc)`: Returns `VideoData` (video_id, title, list) from player
  - `getCurrentTimeFromDocument(doc)`: Returns current playback time via `player.getCurrentTime()`

- **DOMUtils**: `copyViaTextarea(doc, text)` static method for clipboard operations in specific document context

- **constants.ts**: `COPY_MENU_INDICES` — menu item indices for copy actions (VIDEO_URL: 2, URL_AT_TIME: 3, EMBED: 4)

- **selectors.ts**: `PANEL_MENU_ITEMS` selector for `.ytp-panel-menu .ytp-menuitem`

- **types/app.ts**: `CopyType` enum (`VIDEO_URL`, `URL_AT_TIME`, `EMBED`)

- **types/youtube.ts**: `list` field added to `VideoData` interface for playlist ID

### Changed

- **ContextMenuHandler**: Now requires `PlayerManager` in constructor for video data access
- **main.ts**: Passes `playerManager` to `ContextMenuHandler` constructor

### Copy output format

- **Video URL**: `https://youtu.be/{videoId}` or `https://youtu.be/{videoId}?list={playlistId}`
- **URL at time**: `https://youtu.be/{videoId}?t={seconds}` or `https://youtu.be/{videoId}?list={playlistId}&t={seconds}`
- **Embed**: `<iframe width="400" height="225" src="https://www.youtube.com/embed/{videoId}?list={playlistId}" title="..." ...></iframe>`

## [1.5.2] - 2026-01-29

### Fixed

- **PiPManager**: `pagehide` listener now attaches `.catch()` to `returnPlayerToMain()` so any unhandled rejection (e.g. from future code changes) is logged instead of becoming an unhandled promise rejection.

## [1.5.1] - 2026-01-29

### Added

- **PiPCriticalError**: New error class for unrecoverable PiP failures
  - Thrown when PiP flow has left the YouTube page in a broken state (e.g. mini player moved but required DOM element missing)
  - Extends `AppError`; re-thrown in `PiPManager.open()` so callers can distinguish critical failures
  - Used when `yt-draggable` or `movie_player` is missing after PiP window is opened or during return to main

### Changed

- **PiPManager**: Stricter validation and error handling
  - **Before opening PiP**: Validate `ytd-app` and `miniplayer-container`; throw `PiPError` if missing (avoids opening PiP then failing)
  - **After opening PiP**: No conditionals — create `ytd-app`, append mini player; throw `PiPCriticalError` if `yt-draggable` or `movie_player` not found (page would be broken)
  - **returnPlayerToMain**: Guard now includes `miniPlayerContainer`; wrap `movePlayerToMain()` in try/catch and throw `PiPError` on failure
  - **movePlayerToMain**: Guard includes `miniPlayerContainer`; throw `PiPCriticalError` if `yt-draggable` not found when restoring

- **NavigationHandler**: Use `SELECTORS.MOVIE_PLAYER` instead of `SELECTORS.HTML5_VIDEO_PLAYER` when focusing player in PiP

### Removed

- **selectors.ts**: Removed `HTML5_VIDEO_PLAYER` (replaced by `MOVIE_PLAYER` where used)

## [1.5.0] - 2026-01-29

### Added

- **types/app.ts**: New utility type for cleaner async/sync unions
  - Added `MaybePromise<T>` helper type for values that can be synchronous or asynchronous
  - Simplifies complex union types like `T | Promise<T>` throughout the codebase
  - Improves code readability and reusability

- **types/global.d.ts**: Extended Media Session API types
  - Added `ExtendedMediaSessionAction` type for Chrome-specific actions
  - Extended `MediaSession` interface to properly type `setActionHandler` with `enterpictureinpicture` action
  - Eliminates need for type assertions when working with Chrome-specific Media Session features

### Changed

- **Error logging**: Comprehensive logging for type guards and method checks
  - **Error logs** for critical operations:
    - `YtActionSender`: Video ID not found (prevents silent like/dislike failures)
    - `MiniPlayerController`: Video ID not found during navigation
    - `PlayerManager`: `playVideo` method not found (prevents silent playback restoration failure)
  - **Warning logs** for optional features:
    - `NavigationHandler`: Navigation endpoint has no href, player.focus method not found
    - `PiPManager`: videoPlayer.focus method not found
    - `ResizeTracker`: player.setInternalSize/setSize methods not found
  - All method availability checks now have proper error/warning logging
  - Helps diagnose issues in production by making silent failures visible in console

- **Type system**: Enhanced TypeScript type safety and code quality
  - **Generic types**: `YouTubePlayer` now extends `HTMLElement` for better DOM type compatibility
  - **querySelector**: Replaced all `querySelector() as Type` with generic syntax `querySelector<Type>()`
  - **Helper types**: Added `MaybePromise<T>` utility type for cleaner async/sync union types
  - **Type guards**: Replaced non-null assertions (`!`) with proper type guard function in MediaSessionHandler
  - **Global types**: Extended `MediaSession` interface to support Chrome-specific `enterpictureinpicture` action
  - Affects 8 files: type definitions, handlers, core managers
  - Removed redundant method declarations from `YouTubePlayer` (inherited from `HTMLElement`)
  - Removed unused `Nullable` import from `MiniPlayerController`

- **ResizeTracker**: Simplified resize handling logic
  - Combined resize method checks into single conditional (reduced nested if/else blocks)
  - Single warning message if neither resize method is available
  - Uses optional chaining for clean method calls (`setInternalSize?.()`, `setSize?.()`)
  - Reduced from 8 lines to 6 lines while maintaining functionality

- **YtActionSender**: Renamed method and simplified implementation
  - Removed redundant `actionMap` object that was just mapping values to themselves
  - Removed `LikeActionStatusMap` type (no longer needed)
  - Directly pass `actionType` to command object for cleaner, more maintainable code
  - Reduces bundle size and eliminates unnecessary abstraction layer

- **YouTubeCommand interface**: Improved extensibility pattern
  - Introduced `YouTubeCommands` registry interface for centralized command type management
  - `YouTubeCommand` now derived as union type from registry: `YouTubeCommands[keyof YouTubeCommands]`
  - Changed `LikeCommand` from type alias to interface for consistency
  - Adding new command types now only requires updating the registry - automatic type propagation
  - Prevents empty objects from being accepted as valid commands (type safety improvement)

- **MediaSessionHandler**: Improved type safety without assertions
  - Replaced non-null assertions (`desc.get!`, `desc.set!`) with proper type guard function
  - Added `isValidPropertyDescriptor()` type guard that narrows PropertyDescriptor type
  - Removed Chrome-specific action type assertion - now properly typed via `ExtendedMediaSessionAction`
  - More explicit type checking improves maintainability and IDE support

- **PiPWindowReadyCallback**: Simplified with MaybePromise helper
  - Changed from `() => void | PiPCleanupCallback | Promise<void | PiPCleanupCallback>`
  - To cleaner: `() => MaybePromise<void | PiPCleanupCallback>`
  - Improves readability while maintaining identical runtime behavior

- **PiPCleanupCallback**: Simplified with MaybePromise helper
  - Changed from `() => void | Promise<void>` to `() => MaybePromise<void>`
  - More concise and consistent with other async callback types

### Technical Details

- **Type-safe generics**: Leveraging TypeScript's generic constraints for DOM operations
- **Zero type assertions**: Eliminated unnecessary `as` casts through proper interface extensions
- **Type guards over assertions**: Replaced non-null assertions with explicit type guard functions
- **Command Registry Pattern**: Extensible design for adding new YouTube command types
- **Helper type utilities**: Reusable `MaybePromise<T>` pattern for async/sync flexibility
- **Bundle impact**: +0.23 KB raw, +0.10 KB gzip (minimal impact from type improvements)

## [1.4.1] - 2026-01-29

### Added

- **constants.ts**: Added specific like action constants
  - Added `YT_LIKE_ACTIONS` with `LIKE`, `DISLIKE`, and `REMOVE` actions specific to like/dislike endpoint
  - Refactored `YT_ACTIONS` as general-purpose action constants that extends `YT_LIKE_ACTIONS`
  - Separation allows future expansion with other action types without affecting existing like endpoint type safety

- **types/youtube.ts**: Added specific like action type
  - Added `LikeActionType` type derived from `YT_LIKE_ACTIONS` constant ('LIKE' | 'DISLIKE' | 'INDIFFERENT')
  - Ensures `LikeEndpoint.status` remains strictly typed even when `YT_ACTIONS` expands with new action types

### Changed

- **YtActionSender**: Renamed method for clarity and specificity
  - Renamed `send()` to `sendLikeAction()` to reflect specific purpose for like/dislike actions
  - Updated parameter type to use `LikeActionType` instead of `YouTubeActionType`
  - Action map now uses `YT_LIKE_ACTIONS` constants instead of generic `YT_ACTIONS`
  - Method name now clearly indicates it's specifically for like/dislike operations

- **LikeButtonHandler**: Updated to use specific like action constants
  - Replaced `YT_ACTIONS` with `YT_LIKE_ACTIONS` for like/dislike/remove actions
  - Updated to use renamed `sendLikeAction()` method
  - Ensures only valid like endpoint actions are used

- **LikeEndpoint interface**: Uses specific like action type
  - `status` property now uses `LikeActionType` instead of general `YouTubeActionType`
  - Specific type ensures only like/dislike actions are valid, not future unrelated actions
  - Linked to `YT_LIKE_ACTIONS` constants via type system

### Technical Details

- **Separation of concerns**: Like actions now have dedicated constants and type, separate from general YouTube actions
- **Future-proof**: Adding new action types to `YT_ACTIONS` won't affect `LikeEndpoint` type safety
- **Type precision**: Each endpoint can have its own specific action type derived from appropriate constants
- **Semantic naming**: `sendLikeAction()` clearly indicates method purpose, enabling future methods like `sendSubscribeAction()`, etc.

## [1.4.0] - 2026-01-29

### Added

- **constants.ts**: Added YouTube event and action name constants
  - Added `YT_EVENTS` with `ACTION` ('yt-action') and `NAVIGATE` ('yt-navigate') event names
  - Added `YT_ACTION_NAMES` with `ACTIVATE_MINIPLAYER` and `ACTIVATE_MINIPLAYER_FROM_WATCH` action names
  - Added `MOUSE_BUTTONS` with all standard mouse button codes (PRIMARY, AUXILIARY, SECONDARY, FOURTH, FIFTH)
  - Centralized all YouTube API string literals and browser event constants in one place

- **types/youtube.ts**: Added strict TypeScript types derived from constants
  - `PlayerState` type from `PLAYER_STATES` constant (-1 | 0 | 1 | 2 | 3 | 5)
  - `YouTubeActionType` type from `YT_ACTIONS` constant ('LIKE' | 'DISLIKE' | 'INDIFFERENT')
  - `WebPageType` type from `WEB_PAGE_TYPES` constant ('WEB_PAGE_TYPE_WATCH')
  - `YouTubeEventName` type from `YT_EVENTS` constant ('yt-action' | 'yt-navigate')
  - All types include comprehensive documentation with possible values

### Changed

- **MiniPlayerController**: Replaced all inline strings with constants
  - Replaced `'yt-action'` with `YT_EVENTS.ACTION`
  - Replaced `'yt-navigate'` with `YT_EVENTS.NAVIGATE`
  - Replaced `'yt-activate-miniplayer'` with `YT_ACTION_NAMES.ACTIVATE_MINIPLAYER`
  - Replaced `'yt-activate-miniplayer-from-watch-action'` with `YT_ACTION_NAMES.ACTIVATE_MINIPLAYER_FROM_WATCH`
  - Updated code comments to reference constants instead of string literals

- **YtActionSender**: Improved type safety and consistency
  - Updated `send()` parameter type from `string` to strict `YouTubeActionType` union type
  - Action map now uses `YT_ACTIONS` constants for values instead of hardcoded strings ('LIKE', 'DISLIKE', 'INDIFFERENT')
  - Ensures compile-time type checking for YouTube actions

- **PlayerManager**: Enhanced type safety for player state
  - `getPlayerState()` now returns `PlayerState` type instead of generic `number`
  - Added JSDoc comment explaining return value comes from `PLAYER_STATES`

- **YouTubePlayer interface**: Updated to use strict type
  - `getPlayerState()` returns `PlayerState` instead of `number`

- **YouTubeAppElement interface**: Type-safe event dispatching
  - `fire()` method now accepts `YouTubeEventName` instead of generic `string`
  - Prevents invalid event names at compile time

- **WebCommandMetadata interface**: Type-safe page type
  - `webPageType` property now uses `WebPageType` instead of `string`
  - Added JSDoc clarifying values come from `WEB_PAGE_TYPES` constant

- **LikeEndpoint interface**: Type-safe action status
  - `status` property now uses `YouTubeActionType` instead of inline union
  - General-purpose type extensible for future action types beyond like/dislike
  - Linked to `YT_ACTIONS` constants via type system

- **NavigationHandler**: Replaced hardcoded string with constant
  - Log message now uses `YT_EVENTS.NAVIGATE` instead of `'yt-navigate'` string literal

- **MenuObserver**: Replaced magic number with semantic constant
  - Replaced `0` with `TIMEOUTS.ELEMENT_WAIT_INFINITE` for infinite timeout

- **ContextMenuHandler**: Replaced magic numbers with semantic constants
  - Replaced `0` with `TIMEOUTS.ELEMENT_WAIT_INFINITE` for infinite timeout
  - Replaced `2` with `MOUSE_BUTTONS.SECONDARY` for right mouse button

### Technical Details

- **Type safety**: TypeScript now catches invalid values at compile time (invalid event names, player states, actions)
- **IDE support**: Autocomplete now provides suggestions for all constant values with inline documentation
- **Single source of truth**: All values defined once in `constants.ts`, referenced everywhere via imports
- **Maintainability**: Changing a constant automatically updates all usages; no risk of typos
- **Type derivation pattern**: Uses `(typeof CONSTANT)[keyof typeof CONSTANT]` for automatic type inference from constants
- **Zero runtime cost**: Types are compile-time only; constants are tree-shaken if unused

## [1.3.4] - 2026-01-29

### Changed

- **PiPManager**: Improved error handling in `open()` method
  - Replaced `logger.error()` + `throw error` with `throw new PiPError()`
  - Wraps errors in custom `PiPError` class for better error context
  - Maintains error chain while adding descriptive message
  - Consistent with other error handling patterns in the codebase

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

[1.6.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.6.0...refs/tags/v1.6.1
[1.6.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.5.2...refs/tags/v1.6.0
[1.5.2]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.5.1...refs/tags/v1.5.2
[1.5.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.5.0...refs/tags/v1.5.1
[1.5.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.4.1...refs/tags/v1.5.0
[1.4.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.4.0...refs/tags/v1.4.1
[1.4.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.3.4...refs/tags/v1.4.0
[1.3.4]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.3.3...refs/tags/v1.3.4
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
