# YouTube Experiment Flags That Affect the PiP Userscript

YouTube rolls features out per profile through experiment flags. A flag that is on for one user and off for the e2e test account changes which code paths YouTube takes, and several of those paths broke the userscript. This document lists the flags found so far (Nov 2026), what each one changes inside YouTube, which userscript flows it touches, and how we handle it.

Flags are read from two places:

- **Page / Kevlar flags**: `ytcfg.data_.EXPERIMENT_FLAGS` (read by `ytd-app` and other Kevlar components via `_.M("flag")`).
- **Player flags**: `ytcfg.data_.WEB_PLAYER_CONTEXT_CONFIGS[*].serializedExperimentFlags`, a `a=true&b=…` string (read by the player via `this.J.N("flag")` / `experiments`).

Some flags exist in both. To see what a profile has, run in DevTools on youtube.com:

```js
Object.keys(ytcfg.data_.EXPERIMENT_FLAGS).filter((k) => /pip|cow|miniplayer/i.test(k));
```

---

## Flag reference

| Flag                                                                                                | Where         | What it changes in YouTube                                                                                                                                                                                                                                                                                                                             | Userscript flows affected                                                                                                                                                                                                                                           | Our handling                                                                                                                                                                                                | Since               |
| --------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `web_shorts_pip`                                                                                    | page + player | Enables YouTube's own Document PiP for Shorts. On every SPA navigation `ytd-app` (`Jzi`) installs its own `enterpictureinpicture` Media Session handler on Shorts, or clears it with `null` elsewhere. In the player it switches `qM()` (popup document) to the player's own document and sets `HZa` (press/drag listeners on the element's document). | Opening PiP (handler replaced), context menu (opens in the PiP document; its close and Escape listeners live there), click/press handling.                                                                                                                          | `MediaSessionHandler` guards `setActionHandler` and ignores page changes to `enterpictureinpicture` (ADR §16). Context menu dismissal resets YouTube's state in the PiP document and handles Escape itself. | 2.4.5, 2.4.7, 2.4.8 |
| `web_watch_pip`                                                                                     | page + player | Same as above for watch pages (YouTube's own watch PiP).                                                                                                                                                                                                                                                                                               | Same as above.                                                                                                                                                                                                                                                      | Same as above.                                                                                                                                                                                              | 2.4.5               |
| `web_watch_pip_manual`, `web_shorts_pip_manual`                                                     | page          | Only allow YouTube's PiP from an explicit user action (`enterPictureInPictureReason === "useraction"`).                                                                                                                                                                                                                                                | Opening PiP.                                                                                                                                                                                                                                                        | Covered by the handler guard. Not in the e2e matrix.                                                                                                                                                        | 2.4.5               |
| `web_pip_minimize_breakages`                                                                        | page          | Adds `[minimize-pip-breakages]` to playlist panel elements and, under `@media (display-mode: picture-in-picture)`, hides `#action-buttons` (like/dislike) and `#menu` in playlist rows, hides the playlist header, and disables pointer events on thumbnails/reorder handles. Our PiP window matches that media query too.                             | Mini player PiP: like/dislike missing in the selected playlist row.                                                                                                                                                                                                 | `src/styles.css` shows `#action-buttons` again only when it contains the like/dislike toggles; everything else stays as YouTube hides it.                                                                   | 2.4.6               |
| `web_shorts_pip_like_button`, `web_shorts_pip_overflow_menu_button`, `shorts_layout_pip`            | page          | Features of YouTube's own Shorts PiP UI (like button, "⋮" menu, narrow layout).                                                                                                                                                                                                                                                                        | None directly (YouTube's own PiP is blocked by the handler guard).                                                                                                                                                                                                  | —                                                                                                                                                                                                           | —                   |
| `kevlar_player_cow_player_component_all_contexts`, `kevlar_player_cow_player_component_context_ids` | page          | Renders the player as a CoW ("Component on Web Component") wrapper (`ytw-player-with-controls`). A CoW element disposes its component and clears its content on `disconnectedCallback` unless YouTube marked the move as a reparent. `ytd-player.appendTo()` then moves the player through YouTube's reparent-safe helper.                             | Every move of the mini player / Shorts into PiP and back: PiP showed a fresh empty player, the mini player had no player after closing PiP, Shorts PiP lost the reel. Also the root cause of ~3–7% `mini-player` e2e flakes (anonymous sessions randomly bucketed). | `PiPManager.parkYtdPlayer` / `unparkYtdPlayer` move `ytd-player` with `ytd-player.appendTo()` around every move; the player is moved into the mini player container YouTube re-renders (ADR §17).           | 2.4.8               |

### Not a flag, but the same class of change

| Change                                                        | Effect                                                                           | Handling                                                                                                                    | Since |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----- |
| `ytd-app.resolveCommand` removed (Kevlar build ~`2.20261030`) | Like/dislike in mini player PiP sent no request.                                 | Mini player PiP uses the PiP event bridge like Shorts (`docs/YOUTUBE_INTERNAL_API.md` → Kevlar Command System, deprecated). | 2.4.5 |
| `ytd-miniplayer` is always a CoW component                    | Re-renders after every cross-document move and creates a fresh player container. | Player is moved into the fresh container; our old container is removed only once empty (ADR §17).                           | 2.4.8 |

---

## Behaviour that depends on flags (cheat sheet)

| Behaviour                                                   | Without `web_*_pip`                                                                    | With `web_watch_pip` / `web_shorts_pip`                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Where the player context menu opens                         | Main document; we move it into PiP                                                     | PiP document directly                                            |
| Menu size/position                                          | Computed for the main window; we shrink/shift it to fit PiP (`fitMenuIntoPip`)         | Computed for the PiP window by YouTube                           |
| Menu "outside click" / Escape listeners                     | Main document                                                                          | PiP document                                                     |
| Press/drag `mousemove`/`mouseup` listeners (`TS()` / `HZa`) | Main document; we forward `mouseup` from PiP (otherwise a click becomes "hold for 2x") | Element's (PiP) document                                         |
| `enterpictureinpicture` handler                             | Ours                                                                                   | YouTube re-registers its own on navigation; our guard keeps ours |

| Behaviour                                        | Without CoW player | With `kevlar_player_cow_player_component_*`                                     |
| ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------- |
| `ytd-player.appendTo(target)`                    | `appendChild`      | Reparent-safe move (`moveBefore` + reparent mark)                               |
| Plain `appendChild` of an ancestor of the player | Player survives    | Player component disposed, `#movie_player` removed, fresh empty player rendered |

---

## E2E matrix

`playwright.config.ts` runs the whole suite once per flag set (`EXPERIMENT_FLAG_SETS` in `e2e/fixtures/experiment-flags.ts`):

| Project               | Forced flags                                                    |
| --------------------- | --------------------------------------------------------------- |
| `chromium`            | none (test account defaults)                                    |
| `chromium-yt-pip`     | `web_watch_pip`, `web_shorts_pip`, `web_pip_minimize_breakages` |
| `chromium-cow-player` | `kevlar_player_cow_player_component_all_contexts`               |
| `chromium-all-flags`  | all of the above                                                |

Flags are forced through the `experimentFlags` fixture option: an init script wraps `window.ytcfg` and keeps each flag `true` in both `EXPERIMENT_FLAGS` and every `serializedExperimentFlags` before YouTube's scripts read them. `E2E_FORCE_EXPERIMENT_FLAGS=<flag,…>` adds flags ad hoc on top of the project's set.

- Full matrix (CI, `npm run test:e2e`): 4 × the suite.
- One cell locally: `npx playwright test --project=chromium-yt-pip`.
- Keep local runs small: hundreds of YouTube loads from one IP trigger Google's "unusual traffic" CAPTCHA.

The handler stub's `ready()` waits until the userscript has installed its `setActionHandler` guard. With `web_*_pip`, YouTube registers its own `enterpictureinpicture` handler first, so "any handler registered" is not enough: triggering it would open YouTube's PiP instead of ours.

---

## Adding a new flag

1. Find it: inspect the profile's flags (snippet above) and search the bundles (`kevlar_base`, player `base.js`) for the flag name to see what it switches.
2. Reproduce: `E2E_FORCE_EXPERIMENT_FLAGS=<flag> npx playwright test --project=chromium <spec>` (1–3 runs).
3. Fix, then add the flag to an `EXPERIMENT_FLAG_SETS` entry (or a new set + project) so the whole suite keeps covering it.
4. Add a row to the table above.
