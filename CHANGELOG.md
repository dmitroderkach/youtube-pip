# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/2.0.0.html).

## [2.6.1] - 2026-11-07

### Fixed

- **Shorts PiP lost the player with `web_migrate_reel_video_renderer_to_cow`** — With this flag the Shorts video renderer is the CoW `ytd-reel-video-renderer-cow` holding the player's `#player-container`. Moving `ytd-shorts` into PiP makes it dispose and re-render, so the slot the player was parked from is detached and the player was put back into a detached node: no player in PiP or on the page. `PiPManager` now remembers the CoW host around the slot and puts the player into the fresh slot (ARCHITECTURE_DECISIONS §17). Found by forcing all relevant code flags in e2e.

- **Tab title switched to "YouTube" during PiP** — While PiP is open the page is not the watch page (the player went through the mini player), and YouTube sets its own page title after navigations / data updates, replacing the video title we set. `TitleSyncHandler` now watches the page `<title>` and puts our title back, with a guard (at most 5 restores per second) so it never ping-pongs with code that keeps setting its own title.

### Added

- **E2E: all relevant code flags at once** — `chromium-all-flags` forces, besides the curated flags, every relevant boolean flag the Kevlar / player code checks (`codeFlags` from the on-call baseline, ~115), except killswitches, YouTube's test switches (`*_for_testing`, `debug_*`), number flags and `NOT_FORCED_IN_ALL_FLAGS` (`kevlar_watch_fixie`: watch page `ytd-watch-fixie` in development, mini player activation broken in YouTube itself). New project `chromium-killswitches` with the 19 relevant killswitches on. 6 flag sets.
- **On-call** (`docs/ONCALL.md`, #140, #141) — after every daily / manual e2e run: results summary, YouTube experiment flags read from the code (complete) and from a served page (sample), probe runs of new flags, Claude investigation (read-only) and a Telegram report when something is off; broken flag reading and a broken on-call always reported.
- **Manual session in a visible browser** with a chosen flag set (`docs/MANUAL_SESSION.md`, #138).

### Changed

- **CI runner** (#139) — 8 vCPU / 16 GB on Fargate Spot with on-demand fallback (warning on the run), 8 Playwright workers, like-dislike in a single-worker `account-mutations` project; one runner per job.

### Fixed (tests)

- E2E page-ready fixtures recognize the `ytd-watch-fixie` watch page; the e2e session file is written atomically (8 workers read it half-written); "Copy URL at current time" in the Shorts spec waits for playback like the watch spec (`waitForPlaybackTimeInPip`); the keyboard spec waits until YouTube stops moving focus to the first menu item before pressing ArrowDown; skipping ads in PiP works again: the test only looked for `.ytp-skip-ad-button`, while YouTube's other ad UIs use `.ytp-ad-skip-button` / `-modern` (ads then ran to the end and tests hit their timeouts) — all variants are clicked and ads are detected by `ad-showing` on the player. Unskippable ad pods cannot be ended from the page (seeking the ad video does not end them), so the copy and keyboard specs run without ads (`blockAds`: ad fields pruned from YouTube's player responses); the other specs keep ads. Ad budget back to 40 s, long test timeouts gone.

## [2.6.0] - 2026-11-07

### Fixed

- **Context menu broken on the page after using it in PiP** — With `web_watch_pip` / `web_shorts_pip` YouTube opens the player context menu directly in the PiP document. When PiP closed, that menu element stayed in the closed PiP document and YouTube kept reusing it, so on the page the menu stopped closing on item clicks. `ContextMenuHandler.stop()` now returns menus opened in PiP to the main document (closing a still-open one first).
- **Black PiP window when the player reached the mini player late** — Opening PiP from the full watch page waited only for `ytd-miniplayer-player-container`. With the CoW player the container can appear before YouTube moves the player into it, and the empty container was moved to PiP (black window, player left on the page). `movePlayerToPIP` now also waits for `#movie_player` inside the container; if it never arrives, opening fails with an error instead of a black window.

- **Mini player dropped right after activation with `kevlar_watch_while_v2`** — The watch page's `IntersectionObserver` queues a low-priority job that deactivates an active mini player when the player was visible. The job from the first callback after page load can be held back for seconds on a busy page (ad, navigation); a mini player activated for PiP in that window was deactivated ~100 ms later and PiP opened without a player. Before activating the mini player, `PiPManager` now waits for YouTube's pending low-priority jobs (`YouTubeScheduler.waitForLowPriorityJobs`, public `yt.scheduler.instance.addJob`, FIFO per priority; capped at 2 s). ARCHITECTURE_DECISIONS §18.

- **No "copied" feedback for copy items in PiP** — On the page YouTube shows a bezel in the player after "Copy video URL" etc.; in PiP we stopped YouTube's handler (its main-document copy fails there), so nothing was shown. Now YouTube's handler runs after our copy with that one `execCommand('copy')` reported as successful (no copying, our clipboard text stays): it closes the menu and shows its bezel, as on the page. Checked in all five flag projects, watch and Shorts.

- **Keyboard in the PiP context menu with `web_watch_pip` / `web_shorts_pip`** — Keys pressed in PiP are forwarded to the player unless a player menu is open, but only menus we move into PiP were reported as open. Menus YouTube opens in PiP itself were not, so arrows, Enter, Space etc. went to the player instead of the menu. `DocumentFocusHandler` now leaves every key to the menu when one is shown in the PiP document (`ContextMenuHandler.isMenuOpenInPip`) or when focus is inside a player popup (`.ytp-popup`, e.g. settings).

### Added

- **E2E `context-menu-keyboard.spec.ts`** — In PiP: focus "Copy video URL", ArrowDown moves to the next item, Enter copies with the "copied" bezel and closes the menu. Runs in the whole matrix; fails without the fix in `chromium-yt-pip`.
- **E2E `context-menu-after-pip.spec.ts`** — Menu opened in PiP, PiP closed with the menu open, then the menu on the page must close on an item click. Fails without the fix in `chromium-yt-pip`.
- **E2E: watch page ready = hydrated** — `videoPageReady` / `playlistVideoPageReady` now also wait for `ytd-watch-flexy[has-metadata]` (or `ytd-watch-grid`). On slow CI runners the page was still a skeleton after the consent reload when the userscript was ready, and YouTube silently drops miniplayer activation (`i`, `yt-activate-miniplayer-from-watch-action`) without a watch response. This caused the CI flakes in `chromium-yt-pip`, `chromium-all-flags` and `chromium-legacy-ui` (PiP/mini player not opening).
- **E2E context-menu-copy waits for state, not fixed time** — `waitForPiPAdToEnd` uses one 75 s deadline for all ads in a row (a single 30 s wait threw on the first timeout, so its retry loop never ran); before "Copy URL at current time" the test waits until the PiP video has played 2 s (starting it if paused) instead of a fixed 5 s. Test timeout 180 s.
- **E2E: wait for YouTube's low-priority jobs and a mini player timeline** — Page-ready fixtures use the same scheduler barrier before the test acts (the `chromium-all-flags` flakes in `mini-player` / `like-dislike`). Every test records a mini player timeline (state, `yt-action`s, navigations, watch-while observer callbacks, stack of each mini player `setActive()`), printed and attached on failure; this is what located the cause. `docs/E2E_TESTS.md`, `docs/YOUTUBE_INTERNAL_API.md` (scheduler), `docs/YOUTUBE_EXPERIMENT_FLAGS.md`.
- **E2E readiness uses the watch response, copy feedback is asserted** — Page-ready fixtures wait for `ytd-watch-flexy` / `ytd-watch-grid` `.data.currentVideoEndpoint` instead of `[has-metadata]` (YouTube deferred the metadata render during an ad for > 30 s on CI). `clickCopyMenuItemInPip` expects the "copied" bezel and a closed menu. In `context-menu-copy` the `t=` check is skipped with a warning annotation when the video never plays (CI runners sometimes get ads but no video stream).
- **E2E diagnostics** — Userscript debug logs are on in e2e; on failure the `[YouTube PiP]` log lines are printed and attached next to the mini player timeline. The CI report is uploaded also when the run is cancelled (Playwright writes it on SIGINT), so a run can be stopped as soon as a flake shows up.
- **TypeScript 6 in the editor** — `tsconfig.json` sets `types: ["node"]` explicitly (TS 6 no longer includes `@types/*` by default; Cursor bundles TS 6.0.3, so `process`, `node:fs`, `Error.captureStackTrace` were errors in the editor) and includes the root config files (`playwright.config.ts`, `vite.config.ts`, `vitest.config.ts`).

### Changed

- **Logger prints the error `cause` chain** — `AppError` keeps the original error in `cause`, which the console does not show; a wrapped failure appeared only as `PiPError: Error opening PiP`. `logger.error` / `warn` now add each cause (up to 5 levels) as `Caused by:` arguments. Needed to diagnose the intermittent `chromium-all-flags` "Error opening PiP" in CI.

## [2.5.1] - 2026-11-07

### Fixed

- **Context menu copy with flag-dependent menu items** — Copy items in PiP were identified by absolute index (plus a "+1" offset for Shorts). YouTube adds optional items above them depending on experiment flags: without `web_player_miniplayer_in_context_menu` (no "Miniplayer" item) a copy click was not recognised and nothing was copied; with `web_watch_pip_context_menu_button` (extra "Picture-in-picture" item) the wrong text was copied. Copy items are now identified by their position from the end of their own menu (`COPY_MENU_POSITIONS_FROM_END`); the last six items are always the four copy items, "Troubleshoot playback issue" and "Stats for nerds". Not seen on default profiles; reproduced by forcing the flags.

### Changed

- **E2E flag matrix** — Flags can be forced off with `name=false`. `chromium-yt-pip` adds `web_watch_pip_context_menu_button`; new `chromium-legacy-ui` (`web_player_miniplayer_in_context_menu=false`, `web_migrate_reel_player_overlay_to_cow=false`); `chromium-all-flags` also adds `kevlar_watch_while_v2`. 5 projects, 40 tests.
- **E2E context menu helpers** — `waitForContextMenuItemVisible` / `clickContextMenuItem` take a position from the end of the visible menu (shared `COPY_MENU_POSITIONS_FROM_END`).
- **Docs** — `docs/YOUTUBE_EXPERIMENT_FLAGS.md`: findings from a Kevlar/player bundle review (context menu items, `appendTo` killswitch, Shorts overlay migration, watch-while, speedmaster/spacebar, hotkey routing), flags checked and not relevant, updated matrix. `docs/E2E_TESTS.md`.

## [2.5.0] - 2026-11-07

### Added

- **E2E experiment flag matrix** — `playwright.config.ts` runs the whole suite once per YouTube experiment flag set: `chromium` (none), `chromium-yt-pip` (`web_watch_pip`, `web_shorts_pip`, `web_pip_minimize_breakages`), `chromium-cow-player` (`kevlar_player_cow_player_component_all_contexts`), `chromium-all-flags`. Flags come from the `experimentFlags` fixture option and are forced in both the page `EXPERIMENT_FLAGS` and the player `serializedExperimentFlags`. Run one cell locally with `--project=<name>`.
- **`docs/YOUTUBE_EXPERIMENT_FLAGS.md`** — Which YouTube experiment flags affect the userscript, what each changes, which flows they touch, how we handle them, and how to add a new one.

### Fixed

- **Shift+N / Shift+P in PiP** — Keyboard events forwarded from PiP to the player now keep `shiftKey` / `ctrlKey` / `altKey` / `metaKey` (and `repeat`, `location`). The player checks the modifier on the event, so Shift+N arrived as a plain "N" and next/previous video did nothing.

### Changed

- **E2E handler stub** — New `__E2E_PIP__.ready()`; page-ready fixtures wait until the userscript installed its Media Session guard. With `web_*_pip` YouTube registers its own `enterpictureinpicture` handler first, so "a handler exists" could trigger YouTube's PiP instead of ours.
- **E2E `openContextMenuInPip`** — Dispatches a cancelable `contextmenu` like a real right-click. With `web_*_pip` YouTube's close listener is on the PiP document and closed a non-cancelable (un-prevented) menu immediately.
- **Docs** — `docs/E2E_TESTS.md` (matrix), `CLAUDE.md`.

## [2.4.8] - 2026-11-07

### Fixed

- **PiP and mini player with YouTube's CoW player experiment** — With `kevlar_player_cow_player_component_*` the player (and the mini player) are YouTube "CoW" components that dispose and drop `#movie_player` when moved with a plain DOM move. PiP then showed a fresh empty player, and after closing PiP the mini player had no player (also the cause of ~3–7% `mini-player` e2e flakes on anonymous runs). `PiPManager` now parks `ytd-player` with YouTube's own `ytd-player.appendTo()` (reparent-safe) around every move into and out of PiP, for both the mini player and Shorts, and on return moves the player into the fresh mini player container YouTube renders, dropping our old one once it is empty.
- **Player missing after closing PiP from the full watch page** — `waitForMainPlayer` resolved immediately because `#movie_player` was still inside the mini player container we had just moved back, so the container could be removed with the player in it. It now waits for `#movie_player` outside the mini player container, and a container that still holds the player is never removed.
- **Context menu item click left the menu open** — Clicking a copy item in PiP also ran YouTube's own copy, which copies via `execCommand` in the main document and fails while the PiP window has focus; YouTube then kept the menu open, showed the text in a sub-panel and switched items to "Get …" for the rest of the session. After our copy succeeds the click is stopped and the menu is dismissed.
- **Escape did not close the context menu in PiP** — YouTube handles Escape only on the focused menu element; `ContextMenuHandler` now closes a visible menu on Escape when YouTube did not.
- **Context menu overflowed the PiP window** — Without `web_watch_pip` / `web_shorts_pip`, YouTube sizes and positions the menu for the main window; after moving it into PiP it is now shrunk to the PiP window (popup, panel, panel menu) and shifted to fit, like YouTube's own in-PiP placement. No more horizontal scrollbar in narrow (Shorts) PiP windows.
- **Clicking the video in PiP switched playback to 2x** — YouTube's "hold for 2x" press helper listens for `mouseup` on the main document unless its own PiP experiments are on, so a click inside PiP looked like a press that never ended: the first click sped the video up instead of pausing it. `PiPEventBridgeHandler` now forwards `mouseup` from the PiP document to the main document.

### Added

- **E2E: `E2E_FORCE_EXPERIMENT_FLAGS`** — Comma-separated YouTube experiment flags forced on via an init script (`e2e/fixtures/experiment-flags.ts`) to reproduce rollout-specific bugs deterministically.

### Changed

- **E2E context menu helpers** — `waitForContextMenuItemVisible` waits for no _visible_ menu (closed menus stay in the PiP document with `web_*_pip`) and right-clicks again if YouTube ignores the first one during its fade-out.
- **Docs** — `docs/ARCHITECTURE_DECISIONS.md` §17 (CoW-safe player moves, menu positioning), `docs/E2E_TESTS.md` (forcing experiment flags, keep local e2e volume small), `CLAUDE.md`.

## [2.4.7] - 2026-11-07

### Fixed

- **Native browser menu on the second right-click in PiP** — Opening the YouTube context menu in PiP, closing it with a left click outside, then right-clicking again showed the browser's context menu. `ContextMenuHandler` hides the menu directly, so the player kept its "menu open" state; with YouTube's `web_watch_pip` / `web_shorts_pip` experiments the menu and its close listener live in the PiP document, which our main-window reset never reached. The dismissal handler now also dispatches a synthetic `contextmenu` on the PiP body so YouTube closes the menu itself and resets that state. `simulateMainContextMenu` is generalized to `simulateContextMenu(target)`.

## [2.4.6] - 2026-11-07

### Fixed

- **Like / dislike missing in mini player PiP** — YouTube's `web_pip_minimize_breakages` experiment adds `[minimize-pip-breakages]` to playlist rows and hides `#action-buttons` (and `#menu`) under `@media (display-mode: picture-in-picture)`, which also matches our Document PiP window. `src/styles.css` now shows `#action-buttons` again only when it holds the like/dislike toggles and keeps any other child hidden; `#menu` and the playlist header stay hidden as YouTube intends.

### Added

- **`CLAUDE.md`** — Imports the shared Cursor rules (`.cursor/rules/bump-version.mdc`, `release-flow.mdc`, `tests.mdc`) so Claude Code follows the same bump/release/test flows; notes on local e2e and the self-hosted runner image.

## [2.4.5] - 2026-11-07

### Fixed

- **PiP button stopped opening PiP** — YouTube's `web_shorts_pip` / `web_watch_pip` experiments re-register or clear the Media Session `enterpictureinpicture` handler on every SPA navigation, replacing ours. `MediaSessionHandler` now guards `setActionHandler` so page attempts to change this action are ignored (other actions pass through).
- **Like / dislike in mini player PiP did nothing** — YouTube removed `ytd-app.resolveCommand`. The mini player PiP now uses `PiPEventBridgeHandler` (as Shorts already did), so the native buttons' `yt-action` / `yt-service-request` events reach the main app and YouTube sends the request itself.

### Changed

- **Runner image** — Bump the self-hosted GitHub Actions runner in `terraform/runner/Dockerfile` from `2.336.0` to `2.338.2`; GitHub now rejects `2.336.0` at connect time with "Runner version v2.336.0 is deprecated and cannot receive messages", so self-hosted jobs stayed queued.
- **Docs** — `docs/YOUTUBE_INTERNAL_API.md`: PiP Event Bridge now covers the mini player (with the `yt-action` events it emits in PiP); Kevlar Command System marked deprecated with the reason and the list of removed code. `docs/ARCHITECTURE_DECISIONS.md`: §5 adds the "native events over private commands" rule, new §16 documents the `enterpictureinpicture` handler guard. README feature list and project tree updated.

### Removed

- **`LikeButtonHandler`, `YtActionSender`** — replaced by the PiP event bridge.
- **Command types and constants** — `YouTubeCommand`, `YouTubeCommands`, `LikeCommand`, `LikeEndpoint`, `LikeEndpointTarget`, `LikeActionType`, `YouTubeActionType`, `YT_LIKE_ACTIONS`, `YT_ACTIONS`, `YouTubeAppElement.resolveCommand`, test helper `createFakeYtdAppWithResolveCommand`. See `docs/YOUTUBE_INTERNAL_API.md` → _Kevlar Command System (deprecated)_.

## [2.4.4] - 2026-08-21

### Changed

- **Runner image** — Bump the self-hosted GitHub Actions runner in `terraform/runner/Dockerfile` from `2.334.0` to `2.336.0`; the old version is deprecated and rejected at connect time with "Runner version v2.334.0 is deprecated and cannot receive messages".

## [2.4.3] - 2026-08-10

### Removed

- **`YtdShortsProvider.reinitShortsLifeCycle`** — Dropped the remove/restore Shorts lifecycle workaround after closing PiP (was used to stop render loops / stale metadata).
- **`ShortsInfoPanelHandler`** — Removed info-panel unhide observer/handler and related selectors; Shorts PiP no longer patches info panel visibility.

## [2.4.2] - 2026-08-10

### Fixed

- **Shorts PiP context menu copy** — Map copy menu item indices with a +1 offset in Shorts mode so URL, URL at time, embed, and debug info actions copy the correct payload again.

## [2.4.1] - 2026-08-09

### Fixed

- **Shorts PiP layout** — Hide metapanel / overlay action buttons that clutter the narrow PiP window; keep reel overlay metadata visible with compact padding; force overlay and info panel width to the viewport; disable pointer events on info panel overview so controls do not block interaction.

## [2.4.0] - 2026-04-24

### Added

- **Terraform / AWS** — `terraform/` stack for on-demand GitHub Actions runners: Lambda webhook dispatcher (GitHub App + AWS Secrets Manager), ECS Fargate task on a custom Playwright-based image in ECR, dedicated VPC with NAT EC2 and static Elastic IP, EventBridge-triggered NAT scale-down when no runner tasks remain, and optional `terraform/bootstrap/` for S3 + DynamoDB remote state.
- **Runner image** — `terraform/runner/` Dockerfile and `entrypoint.sh` for ephemeral GitHub Actions runner registration.

### Changed

- **GitHub Actions** — `build.yml`, `e2e-manual.yml`, and `release.yml` use `runs-on: [self-hosted, fargate]`; Playwright install step uses `npx playwright install chromium` for the self-hosted runner environment.
- **`.gitignore`** — Ignore Terraform-generated paths (`.terraform/`, `*.tfstate*`, packaged Lambda zips, vendored layer contents under `terraform/lambda/layer/python/` except `.gitkeep`).

## [2.3.19] - 2026-04-24

### Added

- **GitHub Actions** — Added a separate manual workflow `.github/workflows/e2e-manual.yml` (`workflow_dispatch`) to run full e2e on demand, with `SKIP_AUTH_E2E_ON_CI=false` so auth-backed tests are included.
- **Docs** — `docs/E2E_TESTS.md` Running section now documents how to launch `Manual E2E` and what it does (full suite + report artifact).

## [2.3.18] - 2026-04-24

### Changed

- **E2E (CI toggle)** — Added environment-driven gate `SKIP_AUTH_E2E_ON_CI` (parsed from `process.env.SKIP_AUTH_E2E_ON_CI`) so auth-backed tests (`authState: true`) can be skipped via CI configuration without code changes.
- **GitHub Actions** — `.github/workflows/build.yml` now passes `SKIP_AUTH_E2E_ON_CI` from `vars.SKIP_AUTH_E2E_ON_CI` (default `false`) to the e2e step.
- **Docs** — `docs/E2E_TESTS.md` updated with how to toggle auth-backed tests from GitHub Variables and refreshed constants description.

## [2.3.17] - 2026-04-24

### Changed

- **E2E (CI)** — Removed the auth-backed CI skip block from `e2e/fixtures/index.ts` (`testInfo.skip` / `SKIP_AUTH_E2E_ON_CI`), so tests with `authState: true` run on CI again.

## [2.3.16] - 2026-04-24

### Changed

- **E2E (CI)** — Skipping auth-backed tests when `SKIP_AUTH_E2E_ON_CI` is true is handled in the **`context`** fixture (`e2e/fixtures/index.ts`) via **`testInfo.skip`** before a browser context is created, instead of wrapping each spec in `test.describe.skip`.
- **`e2e/constants.ts`** — Comment documents the fixture-based skip.
- **E2E specs** — `like-dislike.spec.ts`, `shorts-pip.spec.ts`, `shorts-navigation.spec.ts`, and `shorts-context-menu-copy.spec.ts` use plain `test.describe` and no longer import `SKIP_AUTH_E2E_ON_CI`.
- **Docs** — `docs/E2E_TESTS.md`: section _Skipping auth-backed tests on CI_, structure/constants/Running text updated for the fixture behaviour.

## [2.3.15] - 2026-04-24

### Added

- **E2E** — `SKIP_AUTH_E2E_ON_CI` in `e2e/constants.ts` (`true` when `process.env.CI` is set).

### Changed

- **E2E (CI)** — Auth-backed specs (`like-dislike`, `shorts-pip`, `shorts-navigation`, `shorts-context-menu-copy`) use `test.describe.skip` on CI so the workflow does not fail while `E2E_STORAGE_STATE_BASE64` is invalid; they still run locally when `CI` is unset.
- **Docs** — `docs/E2E_TESTS.md`: skipping auth suites on CI, `SKIP_AUTH_E2E_ON_CI` in the constants section, `BUTTON_SHAPE` comma-list note, and Running section.

## [2.3.14] - 2026-04-24

### Changed

- **Selectors (YouTube DOM)** — `MENU_BUTTON` and `BUTTON_SHAPE` accept both `.yt-spec-button-shape-next` and `.ytSpecButtonShapeNextHost` (comma-separated) in `src/selectors.ts` and `e2e/selectors.ts` so mini-player expand and like/dislike clicks work across YouTube markup variants (CI vs current web).
- **Tests** — `firstSelectorClass()` in `test-utils/test-helpers.ts` for mock `className` when a selector is a comma list; `LikeButtonHandler` and `MenuObserver` unit tests use it instead of `SELECTORS.BUTTON_SHAPE.slice(1)`.

## [2.3.13] - 2026-03-15

### Changed

- **Playback handoff (Shorts ↔ main)** — In `restoreMainPlayerIfShortsStolePlayback`, removed the early return based on Shorts player state (playing/CUED). When Shorts is visible we now always run stop + restore so the main player is restored regardless of Shorts play state.

## [2.3.12] - 2026-03-15

### Fixed

- **Playback handoff (Shorts ↔ main)** — Skip “restore main player if Shorts stole playback” when Shorts is not visible (e.g. on a regular watch page), by checking `isShortsVisible()` before running the restore logic.

## [2.3.11] - 2026-03-15

### Fixed

- **Playback handoff (Shorts ↔ main)** — When Shorts player is in CUED state, the logic that restores the main player after “Shorts stole playback” now runs instead of returning early, so handoff behaves correctly when Shorts has cued but not yet started playing.

## [2.3.10] - 2026-03-14

### Changed

- **E2E Shorts navigation** — Wait before scrolling to next Short in PiP (200ms IDLE_TIMEOUT + 50ms buffer) so the test runs after `lockLoadVideo` restores; avoids flakiness.

## [2.3.9] - 2026-03-14

### Changed

- **Release workflow** — Upgraded `softprops/action-gh-release` from v1 to v2 so the action runs on Node.js 24 and the Node 20 deprecation warning is removed.

## [2.3.8] - 2026-03-14

### Changed

- **E2E selectors** — Aligned `PANEL_MENU_ITEMS` in `e2e/selectors.ts` with the app selector (`.ytp-contextmenu .ytp-panel-menu > .ytp-menuitem`) so context menu copy specs target the correct items.

## [2.3.7] - 2026-03-14

### Fixed

- **Copy menu actions** — corrected selector for panel menu items so that context menu copy actions (Copy video URL, Copy URL at time, Copy embed, Copy debug info) resolve and click the correct items in both regular video and Shorts PiP.

## [2.3.6] - 2026-03-13

### Fixed

- **Shorts info panel overlay** — adjusted overlay width in Shorts PiP styles so that the info panel does not overflow or clip content in the narrow layout.

## [2.3.5] - 2026-03-13

### Added

- **E2E tests — Shorts**: Added end-to-end coverage for Shorts flows in PiP:
  - `shorts-pip.spec.ts` — verifies that the Shorts player moves into the PiP window and returns back to the main page without losing the current reel.
  - `shorts-context-menu-copy.spec.ts` — verifies context menu copy actions in Shorts PiP (Shorts URLs and URLs at time use the `https://www.youtube.com/shorts/VIDEO_ID?feature=share` / `?t=N&feature=share` format).
  - `shorts-navigation.spec.ts` — verifies navigation between Shorts reels inside PiP via `ArrowDown`, asserting that the underlying video source changes.

### Changed

- **E2E docs** — `docs/E2E_TESTS.md`: documented new Shorts fixtures (`shortsPageReady`, `waitForShortsPlayerVisibleInMain`, `waitForShortsPlayerVisibleInPip`, `scrollToNextShortInPip`) and the three Shorts e2e specs.

## [2.3.4] - 2026-03-07

### Changed

- **YtdShortsProvider** — `reinitShortsLifeCycle` restore step now uses `requestIdleCallback` (with timeout) when available, otherwise `requestAnimationFrame`; JSDoc and ARCHITECTURE_DECISIONS updated accordingly.
- **Constants** — `SHORTS_LOAD_VIDEO_RESTORE_AFTER_MS` renamed to `IDLE_TIMEOUT` (200ms); used for lockLoadVideo restore and reinit idle timeout.
- **PipShortsWindowHandlers** — Shorts PiP document focus handler now initialized with `initialize(true)` (Shorts mode) so keyboard events dispatch to ytd-app.
- **Docs** — ARCHITECTURE_DECISIONS: Shorts Reinit decision updated for requestIdleCallback; added ADR 14 (Monkey Patch Guard). YOUTUBE_INTERNAL_API: Shorts lifecycle workaround section updated to describe restore via requestIdleCallback (when available) or requestAnimationFrame.

### Fixed

- **Tests** — DocumentFocusHandler tests: added PlayerManager mock and binding; ytdApp dispatch tests use `initialize(true)`.

## [2.3.3] - 2026-03-06

### Changed

- **YtdShortsProvider** — `lockLoadVideo` debug log message updated to "will restore after idle" (replaces "500ms without calls").

## [2.3.2] - 2026-03-06

### Fixed

- **Shorts PiP — reel no longer resets when returning to tab after delay**: When closing the PiP popup and switching back to the YouTube tab only after some time, the visible Short no longer resets to the first reel. Fix ensures the current reel is preserved across delayed return to the page.

## [2.3.1] - 2026-03-06

### Fixed

- **Shorts PiP — current reel preserved**: When moving Shorts into the PiP window or when returning them to the main tab, the visible reel no longer resets to the first one.
  - **lockLoadVideo** in `YtdShortsProvider`: before `appendChild`, `loadVideo` on the Shorts element is replaced with a no-op so YouTube’s internal logic (e.g. IntersectionObserver) does not call it and change the reel. If `loadVideo` is not called for 200ms, the original method is restored automatically.
  - PiPManager calls `lockLoadVideo()` before moving the Shorts element into the PiP document and before restoring it to the main window.

## [2.3.0] 🚀 The Shorts Revolution - 2026-03-06

### Added

- **Full Shorts support in PiP**: Move the entire Shorts feed into Document PiP with infinite scroll preserved
- **Smart Layout Adaptation**: Automatic switch to "narrow mode" (Layout 0); interaction buttons are compactly placed on the video as in the mobile app
- **Dynamic Aspect Ratio**: PiP window automatically adjusts to video proportions (9:16), eliminating black bars
- **Event Bridge**: Proxy system for events (`yt-navigate`, `yt-action`) between the popup and the main page for seamless navigation
- **Title Sync**: Automatic synchronization of the PiP window title with the current Shorts title
- **DI Architecture**: Improved modularity with new providers for Shorts and windows

### Fixed

- **Lifecycle Reboot**: Fixed critical Polymer render loop when returning shorts elements to the main page
- **Visibility Handling**: Element restoration is now synchronized with `visibilitychange` and `requestAnimationFrame` for stability when tabs are inactive

## [2.2.12] - 2026-02-23

### Changed

- **Userscript metadata**: Added `@noframes` directive to prevent script execution in iframes
  - Ensures script runs only in the main YouTube page context
  - Prevents unnecessary initialization in embedded YouTube players on external sites
  - Improves performance and avoids potential conflicts in iframe contexts

## [2.2.11] - 2026-02-21

### Added

- **e2e fixtures** — Modular `e2e/fixtures/` folder: `auth.ts`, `handler-stub.ts`, `pip-playlist.ts`, `pip-like-dislike.ts`, `pip-context-menu.ts`, `index.ts`; shared PiP helpers moved from specs into fixtures and re-exported from index

### Changed

- **e2e** — Replaced single `fixtures.ts` with `fixtures/`; playlist-navigation, like-dislike, context-menu-copy, pip-focus now import shared helpers from `../fixtures`; README and docs updated for new structure

### Removed

- **e2e** — `e2e/fixtures.ts` (logic moved into `e2e/fixtures/` modules)

## [2.2.10] - 2026-02-21

### Added

- **e2e fixtures** — `storeAuthState` option (`true` / `false` / `undefined`): when `true`, context storage state is written to `e2e/.auth/storageState.json` on context close. For local use only: log in once and save state (one-off), or reset broken state (delete the file, run a test with `storeAuthState: true` while logged in to re-login and save).

## [2.2.9] - 2026-02-21

### Added

- **e2e** — Auth state from GitHub secret: when the file is missing and `E2E_STORAGE_STATE_BASE64` is set, `ensureStorageStateFromSecret()` decodes and writes `e2e/.auth/storageState.json` so tests using `authState: true` work on CI
- **e2e** — `authState` fixture option and `E2E_STORAGE_STATE_PATH` export; context uses `defaultContextOptions`; no write-back of storage state on test end
- **e2e** — Like/dislike test in PiP (like → remove like → dislike → remove dislike; asserts via network responses; uses `authState: true`)
- **e2e selectors** — `LIKE_BUTTON`, `BUTTON_SHAPE` for like/dislike tests

### Changed

- **CI (build.yml)** — Pass `E2E_STORAGE_STATE_BASE64` from secrets into e2e step; auth state is taken only from the secret (no cache)

## [2.2.8] - 2026-02-21

### Changed

- **e2e fixtures** — `waitForPiPAdToEnd`: comment updated for Skip ad click — only real/trusted click when PiP is a separate page (no programmatic fallback)

## [2.2.7] - 2026-02-21

### Added

- **e2e** — Playlist navigation test: open playlist video → mini player → expand → click another video; assert video src changes in mini player
- **e2e** — Context menu copy test: copy video URL, URL at time, embed iframe, debug info in PiP; wait for ad to end (`waitForPiPAdToEnd`), then open menu and assert clipboard via `expect.poll()`
- **e2e** — PiP focus test: player has focus when PiP opens; focus returns after click outside (below player); focus not on context menu while open; focus returns after ESC
- **e2e fixtures** — `playlistVideoPageReady`, `waitForPiPAdToEnd`; constant `PLAYLIST_VIDEO_URL` and `E2E_CONTEXT_MENU_ITEM_VISIBLE_TIMEOUT_MS`
- **e2e selectors** — `MENU_BUTTON`, `PLAYLIST_PANEL`, `PLAYLIST_VIDEO_ITEM`, `CONTEXT_MENU`, `PANEL_MENU_ITEMS`, `AD_PLAYER_OVERLAY`

### Changed

- **e2e** — Context menu copy uses `expect.poll()` for clipboard checks (replacing async `waitForFunction` which did not await the predicate); ad overlay wait before opening menu

## [2.2.6] - 2026-02-18

### Changed

- **e2e fixtures** — Userscript runs via `addInitScript(initHandlerStub, userscriptBody)` so script executes before page load; `videoPageReady` no longer evals userscript in page; fixtures that don't need `page` use empty dependency `{}`; ESLint `no-empty-pattern` disabled for that block
- **Playwright** — `viewport: null`, `colorScheme: 'dark'`, `deviceScaleFactor: undefined` so context works with null viewport (fix "deviceScaleFactor not supported with null viewport")

## [2.2.5] - 2026-02-17

### Changed

- **e2e** — Skip consent flow on CI (no cookie banner in GitHub Actions region); remove `E2E_WAIT_CONSENT_TIMEOUT_MS`, use single timeout for consent wait/click

## [2.2.4] - 2026-02-17

### Changed

- **e2e fixtures** — Consent flow: remove `initHandlerStub` re-inject after accept (stub already applied via addInitScript on each load)

## [2.2.3] - 2026-02-17

### Added

- **e2e** — Mini player test (press "i" → PiP → close → mini player visible again)

### Changed

- **e2e** — Improvements: shared constants/selectors, `assertPiPWindowHasPlayer` fixture, tests in `e2e/tests/`, default wait timeout in config

## [2.2.2] - 2026-02-17

### Changed

- **e2e fixtures** — Consent flow: wait for next reload via `waitForEvent('domcontentloaded')` instead of `waitForLoadState`; `videoPageReady`: removed 5s `waitForTimeout`

## [2.2.1] - 2026-02-17

### Changed

- **e2e fixtures** — Consent flow: run `waitForLoadState('domcontentloaded')` and button click in `Promise.all` (replaces deprecated `waitForNavigation`)

## [2.2.0] - 2026-02-17

### Added

- **E2E in CI** — GitHub Actions: install Playwright Chromium, run `test:e2e`, upload Playwright HTML report artifact when e2e run completes (success or failure); report retained 7 days
- **.gitignore** — `playwright-report/`, `test-results/` so Playwright outputs are not committed

### Changed

- **build.yml** — Steps: Install Playwright browsers, Run e2e tests, Upload Playwright report (conditional on e2e step outcome)
- **global.d.ts** — MediaSession `setActionHandler` signature extended for e2e stub (action: string, handler: unknown)
- **tsconfig.eslint.json** — Include `e2e/**/*` for type-aware linting

## [2.1.6] - 2026-02-17

### Changed

- **DocumentFocusHandler** — Removed `player.contains(active)` from early return; simplified focus check to only `!active` or `active === player`

## [2.1.5] - 2026-02-16

### Changed

- **DocumentFocusHandler** — Replaced interval poll with body click and keyup (any key except Tab); focus change via `setTimeout(0)` so it runs after other handlers
- **NavigationHandler** — Minor cleanup (2 lines removed)
- **Tests** — DocumentFocusHandler tests updated for click/keyup flow; added onKeyUp Tab filter and non-Tab key coverage

## [2.1.4] - 2026-02-15

### Added

- **TitleSyncHandler** — Keeps PiP and main window titles in sync: observes video element (`src`) and notify renderer (childList/subtree), syncs on init and on mutation from `player.getVideoData().title`; skips sync when PiP was opened from mini player (reads `PlayerManager.getWasMiniPlayerActiveBeforePiP()`). No dependency on PiPManager.

### Changed

- **PlayerManager** — Added `wasMiniPlayerActiveBeforePiP` state with `setWasMiniPlayerActiveBeforePiP` / `getWasMiniPlayerActiveBeforePiP` (moved from PiPManager; used by TitleSyncHandler)
- **PiPManager** — Removed local `wasMiniPlayerActiveBeforePiP`; uses PlayerManager; `pipWindowHandlers.initialize(miniplayer)` no longer passes second argument
- **PiPWindowHandlers** — `initialize(miniplayer)` single argument; initializes TitleSyncHandler (no args)
- **Tests** — PiPManager, PiPWindowHandlers, TitleSyncHandler, PlayerManager updated; PlayerManager coverage for new get/set
- **MediaSessionHandler** — Simplified; test suite reduced
- **.gitignore** — Track `.cursor/commands/`
- **Cursor** — Added `.cursor/commands/` with bump-version and release-flow commands

## [2.1.3] - 2026-02-09

### Changed

- **Test container** — `createTestContainer()` returns an empty container with only `LoggerFactory` (mock); no real app implementations. Each unit test binds the class under test (`.toSelf()`) and all dependencies as mocks (`.toInstance(mock)`), so unit tests use only mocks
- **Tests** — All test files that use the test container now explicitly register the class under test and its dependency mocks (YtdAppProvider, PlayerManager, PipWindowProvider, SeekHandler, LikeButtonHandler, NavigationHandler, YtActionSender, ResizeTracker, MenuObserver, ContextMenuHandler, MiniPlayerController, DocumentFocusHandler; MediaSessionHandler, PiPManager, PiPWindowHandlers already did)

## [2.1.2] - 2026-02-09

### Changed

- **Constants** — Removed `UI_CLASSES` from constants; tests now use `SELECTORS` with `.slice(1)` (and `.replace(/\./g, ' ')` for compound selectors) to derive class names from selectors
- **Selectors** — Added `PANEL_MENU: '.ytp-panel-menu'` for tests that need the panel class
- **Magic constants cleanup** — Replaced raw numbers/strings in tests with named constants: DOMUtils (`MUTATION_SKIP_TIMEOUT_MS`, `MUTATION_STEP_MS`, `TEST_SELECTOR_*`), SeekHandler (`BAR_RECT`, `MOCK_DURATION_SEC`, `SEEK_CLICK_X`, etc.), ResizeTracker (`RESIZE_WIDTH_*`), VersionDetector (`USER_AGENT_*`), ContextMenuHandler (`STYLE_DISPLAY_*`), NavigationHandler (`SAMPLE_WATCH_URL*`), YtdAppProvider (regex via `SELECTORS.YTD_APP`)

## [2.1.1] - 2026-02-09

**Goal:** Achieve 100% test coverage.

### Changed

- **Tests** — Aligned with test rules: replaced magic constants with named constants (DOMUtils, SeekHandler, ResizeTracker); replaced inline type assertions (`as unknown as HandlerPrivateAccess`) with bracket notation for private member access (MediaSessionHandler, ContextMenuHandler)
- **Coverage** — Added v8 ignore comments for uncovered branches in DOMUtils and VersionDetector (branches that cannot be exercised in tests)
- **Test rules** — Updated `.cursor/rules/tests.mdc` (avoid inline types, minimize `as never`)

## [2.1.0] - 2026-02-08

### Added

- **Unit tests** — Vitest test suite with coverage (branch ≥90%); test container (`createTestContainer()`), vitest-mock-extended, `__mocks__` per `__tests__`; tests for logger, DI (container, decorators, metadata), core (PiPManager, PlayerManager, NavigationHandler, PipWindowProvider, PiPWindowHandlers, YtdAppProvider, YtActionSender), handlers (DocumentFocusHandler, LikeButtonHandler, MediaSessionHandler, SeekHandler), ui (ContextMenuHandler, MenuObserver, MiniPlayerController, ResizeTracker), utils (copyPayload, DOMUtils, StyleUtils, AsyncLock, VersionDetector), errors
- **CI** — "Run tests" step in GitHub Actions build workflow; tests (with coverage) run on every push/PR to main/master
- **DI container** — `bind(token).toInstance(instance)` for registering ready-made instances (e.g. mocks in tests); `get()` returns cached instance when set
- **Test rules** (`.cursor/rules/tests.mdc`) — fake timers (no real delays), no magic constants, wait for async completion instead of magic time

### Changed

- **PiPManager** — `close()` now returns `Promise<void>` so callers can await completion; tests use `awaitClose(manager)` instead of advancing time by a fixed delay
- **.gitignore** — added `coverage/` so coverage reports are not committed

## [2.0.5] - 2026-02-08

### Changed

- **PiP styles** — temporarily hide `.dropdown-trigger` in PiP window until context menu interception is implemented (TODO in styles.css)

## [2.0.4] - 2026-02-05

### Added

- **Constants** — `TIMEOUTS.ACTIVE_ELEMENT_POLL` (100ms) for DocumentFocusHandler polling

### Changed

- **DocumentFocusHandler** — replaced `focusin` with polling `document.activeElement` via `setInterval` for more reliable focus tracking; returns focus to player only when context menu is closed

### Removed

- **PiPManager** — removed explicit `player.focus()` after unwrap (focus handled by DocumentFocusHandler)

## [2.0.3] - 2026-02-05

### Added

- **DocumentFocusHandler** — observes focus changes in PiP window via `focusin`; returns focus to player when it leaves
  - Subscribes to `ContextMenuHandler.subscribeContextMenu`; pauses focus return when menu open, returns focus when menu closes
- **ContextMenuHandler** — `subscribeContextMenu(callback)` for visibility changes; notifies on open/close

### Changed

- **NavigationHandler** — removed focus logic (handled by DocumentFocusHandler); removed `PlayerManager` dependency
- **PiPWindowHandlers** — added `DocumentFocusHandler`; initializes and cleans up last/first

## [2.0.2] - 2026-02-02

### Added

- **DI container** — constructor parameter validation: throws `AppRuntimeError` when a parameter is not decorated with `@inject(token)` (clear message with class name and parameter index)

## [2.0.1] - 2026-02-02

### Added

- **DI container** — `@injectable()` validation: throws `AppRuntimeError` when resolving a class not decorated with `@injectable()`
  - `injectableClasses` WeakSet in metadata; `setInjectable` / `isInjectable` helpers
  - `injectable()` decorator now marks class via `setInjectable(target)` instead of no-op

### Changed

- **LoggerFactory** — added `@injectable()`; imports `injectable` from `./di/decorators` to avoid circular dependency with container-config
- **main.ts** — bootstrap logger uses `Logger.getInstance('Main')` instead of resolving via container

## [2.0.0] - 2026-02-02

### Added

- **DI Container** — dependency injection without external libraries (Inversify-style)
  - `src/di/` — metadata, decorators (`@injectable`, `@inject`), container, types
  - Class-based tokens: `container.bind(Class).toSelf()` — no separate token registry
  - Symbol/string tokens supported: `bind(Symbol('X')).to(Impl)`, `bind('X').to(Impl)`
  - Circular dependency detection — throws `AppRuntimeError` with chain (e.g. `A → B → C → A`)
  - `LoggerFactory` bound as transient; all services use `loggerFactory.create('Scope')`
  - `createContainer()` configures bindings; `main.ts` resolves services and runs initialization

- **Centralized DOM element providers**
  - `YtdAppProvider` — holds `ytd-app` reference, initialized at app startup
  - `PlayerManager` — holds `#movie_player` reference, initialized at app startup
  - `PipWindowProvider` — holds PiP window reference, set by `PiPManager` when PiP opens/closes
  - `MiniPlayerController` — holds `ytd-miniplayer` reference, initialized at app startup
  - All DOM queries for these elements go exclusively through these providers

- **PiPWindowHandlers** — extracts PiP window handler setup from `PiPManager`
  - `initialize(miniplayer)` — handlers obtain `pipWindow` from `PipWindowProvider`
  - `NavigationHandler.initialize()` moved here from `PiPManager`

- **AppRuntimeError** — new error class for runtime/DI failures (extends `AppError`)

- **YtActionSender** — now injectable, uses `PipWindowProvider` instead of `pipWindow` constructor param

### Changed

- **Breaking**: Manual constructor wiring removed — all dependencies resolved via container

- **main.ts**
  - Replaced `YouTubePiPApp` with `createContainer().get(...)` and explicit init sequence
  - Initialization order: `ytdAppProvider`, `playerManager`, `miniPlayerController`, `mediaSessionHandler`
  - Wrapped in `try/catch`; logs `AppInitializationError` on failure

- **Non-nullable getters** (post-initialization guarantees)
  - `PlayerManager.getPlayer(): YouTubePlayer` — always defined after `initialize()`
  - `YtdAppProvider.getApp(): YouTubeAppElement` — always defined after `initialize()`
  - `MiniPlayerController.getMiniplayer(): MiniPlayerElement` — always defined after `initialize()`
  - Removed all `if (!player)`, `if (!mainApp)`, `if (!miniplayer)` guards for these

- **PlayerManager** — no longer accepts `Document`/player params
  - `savePlayingState(player: YouTubePlayer)`, `restorePlayingState(player: YouTubePlayer)` — required params
  - `getPlayerState(player)`, `isPlaying(player)` — required params
  - Internal methods use `this.getPlayer()` instead of `this.player`

- **Logger scope** — string literals instead of `ClassName.name` for minifier compatibility
  - e.g. `loggerFactory.create('PlayerManager')` so logs show real names after minification

- **PiPManager**
  - Injects `PipWindowProvider`; sets/clears it when PiP opens/closes
  - Uses `miniPlayerController.getMiniplayer()` — no local `miniplayer` field
  - Uses `ytdAppProvider.getApp()`, `playerManager.getPlayer()` — no null checks
  - `PiPWindowHandlers.initialize(miniplayer)` — no `pipWindow` param

- **Handlers** — inject `PipWindowProvider`, get `pipWindow` in `initialize()`
  - `NavigationHandler`, `MenuObserver`, `ContextMenuHandler`, `SeekHandler`, `LikeButtonHandler`
  - `ResizeTracker.start(miniplayer)` — removed unused `pipWindow` param

- **Parameter property shorthand** — constructors use `private readonly x: X` for injected deps

- **tsconfig**: `experimentalDecorators: true` for decorator support

## [1.6.7] - 2026-02-01

### Added

- **Types for `fire()` detail** — type-safe event details for `ytd-app.fire()`, similar to `resolveCommand`
  - `YouTubeActionEventDetail` — for yt-action (actionName, args, optionalAction, returnValue)
  - `YouTubeNavigateEventDetail` — for yt-navigate (endpoint, entryTime)
  - `YouTubeFireDetails` registry — extensible mapping event name → detail type
  - `YouTubeFireDetail<E>` — indexed by event name
  - `fire?<E>(eventName: E, detail?: YouTubeFireDetail<E>)` — generic overload

### Changed

- **types/youtube.ts**: `NavigationEndpoint.commandMetadata`, `NavigationState.entryTime` — made optional

## [1.6.6] - 2026-01-31

### Added

- **PiPManager**: Notification count in window title — PiP and main window titles now show `(N) ` prefix when notifications exist
  - Uses `ytd-notification-topbar-button-renderer` → `showNotificationCount`
  - `SELECTORS.NOTIFICATION_TOPBAR_BUTTON_RENDERER` in selectors.ts
  - `NotificationTopbarButtonRenderer` interface in types/youtube.ts

## [1.6.5] - 2026-01-31

### Added

- **PiPManager**: Phantom window detection — after 500ms, if PiP window was closed without pagehide, triggers cleanup
  - `TIMEOUTS.PHANTOM_WINDOW_CHECK` (500ms) — delay before phantom window check
  - Handles cases where pagehide event is lost (tab suspended, etc.)

### Changed

- **PiPManager**: Critical section for open/close — `AsyncLock` serializes concurrent open/close to prevent races
- **PiPManager**: `close` extracted as arrow function, uses `asyncLock.withLock()` for returnPlayerToMain
- **PiPManager**: pagehide listener attached immediately after `requestWindow` (before DOM setup)
- **PiPManager**: `movePlayerToMain` — restore playback state now awaited (Promise + setTimeout for next event loop iteration)

## [1.6.4] - 2026-01-30

### Added

- **Dynamic embed dimensions**: "Copy embed code" in PiP now uses current player size
  - `PlayerManager.getPlayerSizeFromDocument(doc)` — returns `player.getPlayerSize()` (width/height) or `null`
  - Embed iframe `width`/`height` taken from player when available; fallback 400×225
  - `PlayerSize` interface and `getPlayerSize?()` in `YouTubePlayer` (types/youtube.ts)

### Changed

- **ContextMenuHandler**: `getCopyPayload` now accepts a single params object (`videoId`, `playlistId`, `currentTime`, `title`, `copyType`, `embedSize`) instead of six separate arguments

## [1.6.3] - 2026-01-30

### Changed

- **ContextMenuHandler**: Log level for "not a menu item or no parent" copy click reduced from `warn` to `debug` — expected when user clicks outside a menu item, no need to warn

## [1.6.2] - 2026-01-30

### Added

- **Copy debug information** in PiP context menu
  - New copy menu item: "Copy debug information" (index 5)
  - Uses `player.getDebugText()` from YouTube player API; copies the same debug payload as on the main page
  - `PlayerManager.getDebugInfoFromDocument(doc)` returns debug string or `null`
  - `COPY_MENU_INDICES.DEBUG_INFO`, `CopyType.DEBUG_INFO` added

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

[2.6.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.6.0...refs/tags/v2.6.1
[2.6.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.5.1...refs/tags/v2.6.0
[2.5.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.5.0...refs/tags/v2.5.1
[2.5.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.4.8...refs/tags/v2.5.0
[2.4.8]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.4.7...refs/tags/v2.4.8
[2.4.7]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.4.6...refs/tags/v2.4.7
[2.4.6]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.4.5...refs/tags/v2.4.6
[2.4.5]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.4.4...refs/tags/v2.4.5
[2.4.4]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.4.3...refs/tags/v2.4.4
[2.4.3]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.4.2...refs/tags/v2.4.3
[2.4.2]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.4.1...refs/tags/v2.4.2
[2.4.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.4.0...refs/tags/v2.4.1
[2.4.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.19...refs/tags/v2.4.0
[2.3.19]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.18...refs/tags/v2.3.19
[2.3.18]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.17...refs/tags/v2.3.18
[2.3.17]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.16...refs/tags/v2.3.17
[2.3.16]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.15...refs/tags/v2.3.16
[2.3.15]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.14...refs/tags/v2.3.15
[2.3.14]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.13...refs/tags/v2.3.14
[2.3.13]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.12...refs/tags/v2.3.13
[2.3.12]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.11...refs/tags/v2.3.12
[2.3.11]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.10...refs/tags/v2.3.11
[2.3.10]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.9...refs/tags/v2.3.10
[2.3.9]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.8...refs/tags/v2.3.9
[2.3.8]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.7...refs/tags/v2.3.8
[2.3.7]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.6...refs/tags/v2.3.7
[2.3.6]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.5...refs/tags/v2.3.6
[2.3.5]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.4...refs/tags/v2.3.5
[2.3.4]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.3...refs/tags/v2.3.4
[2.3.3]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.2...refs/tags/v2.3.3
[2.3.2]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.1...refs/tags/v2.3.2
[2.3.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.3.0...refs/tags/v2.3.1
[2.3.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.12...refs/tags/v2.3.0
[2.2.12]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.11...refs/tags/v2.2.12
[2.2.11]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.10...refs/tags/v2.2.11
[2.2.10]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.9...refs/tags/v2.2.10
[2.2.9]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.8...refs/tags/v2.2.9
[2.2.8]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.7...refs/tags/v2.2.8
[2.2.7]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.6...refs/tags/v2.2.7
[2.2.6]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.5...refs/tags/v2.2.6
[2.2.5]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.4...refs/tags/v2.2.5
[2.2.4]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.3...refs/tags/v2.2.4
[2.2.3]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.2...refs/tags/v2.2.3
[2.2.2]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.1...refs/tags/v2.2.2
[2.2.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.2.0...refs/tags/v2.2.1
[2.2.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.1.6...refs/tags/v2.2.0
[2.1.6]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.1.5...refs/tags/v2.1.6
[2.1.5]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.1.4...refs/tags/v2.1.5
[2.1.4]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.1.3...refs/tags/v2.1.4
[2.1.3]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.1.2...refs/tags/v2.1.3
[2.1.2]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.1.1...refs/tags/v2.1.2
[2.1.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.1.0...refs/tags/v2.1.1
[2.1.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.0.5...refs/tags/v2.1.0
[2.0.5]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.0.4...refs/tags/v2.0.5
[2.0.4]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.0.3...refs/tags/v2.0.4
[2.0.3]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.0.2...refs/tags/v2.0.3
[2.0.2]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.0.1...refs/tags/v2.0.2
[2.0.1]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v2.0.0...refs/tags/v2.0.1
[2.0.0]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.6.7...refs/tags/v2.0.0
[1.6.7]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.6.6...refs/tags/v1.6.7
[1.6.6]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.6.5...refs/tags/v1.6.6
[1.6.5]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.6.4...refs/tags/v1.6.5
[1.6.4]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.6.3...refs/tags/v1.6.4
[1.6.3]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.6.2...refs/tags/v1.6.3
[1.6.2]: https://github.com/dmitroderkach/youtube-pip/compare/refs/tags/v1.6.1...refs/tags/v1.6.2
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
