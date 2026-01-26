# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-01-26

### Changed

- **NavigationHandler**: Removed `history.pushState` when navigating from PiP
  - YouTube does not update the URL in the mini player, so we no longer update it on the main page
  - Only `popstate` event is dispatched to trigger SPA navigation

## [1.0.1] - 2026-01-26

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

[1.0.2]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.0.1...refs/tags/v1.0.2
[1.0.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/main...refs/tags/v1.0.1
[1.0.0]: https://github.com/dmitroderkach/youtube-pip/releases/tag/main
