# Manual Session in a Visible Browser

Opens YouTube in a visible (headed) Playwright browser with the freshly built userscript, the e2e handler stub and, by default, the frozen test account session. Use it to check a change by hand under a specific set of YouTube experiment flags (e.g. the old flow without YouTube's own PiP), which a normal Chrome profile cannot switch.

Code: [`docs/manual-session/`](manual-session/) — `manual-session.spec.ts` (the session) and `playwright.manual.config.ts` (the e2e config with this folder as test dir). It is not part of the e2e suite (`npx playwright test` only looks in `e2e/`).

## Run

```bash
npm run build
npx playwright test -c docs/manual-session/playwright.manual.config.ts --project=chromium --headed
```

The session lasts until you close the browser window (the test has no timeout). Userscript debug logs (`[YouTube PiP] …`), stub messages and page errors are echoed to the terminal.

- **Open PiP**: Playwright's Chromium has no PiP button in its media controls, so the page gets a red **Open PiP** button (top right). It calls the userscript's `enterpictureinpicture` handler through `window.__E2E_PIP__`, as the e2e tests do.
- **Rebuild** (`npm run build`) after code changes and start a new session; the userscript is read from `dist/userscript.js` when the session starts.

## Options

| How                                    | Effect                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--project=<name>`                     | Flag set from the e2e matrix: `chromium`, `chromium-yt-pip`, `chromium-cow-player`, `chromium-legacy-ui`, `chromium-all-flags`. |
| `E2E_FORCE_EXPERIMENT_FLAGS=a,b=false` | Force extra flags on (`name`) or off (`name=false`) on top of the project's set.                                                |
| `MANUAL_URL=<url>`                     | Page to open (default: a video in a playlist).                                                                                  |
| `MANUAL_AUTH=false`                    | Logged out instead of the test account (`e2e/.auth/storageState.json`).                                                         |

Flags and the flows they touch: [YOUTUBE_EXPERIMENT_FLAGS.md](YOUTUBE_EXPERIMENT_FLAGS.md).

## Examples

Old flow, without YouTube's own PiP (the menu opens on the page and the userscript moves it into PiP):

```bash
E2E_FORCE_EXPERIMENT_FLAGS="web_watch_pip=false,web_shorts_pip=false,web_pip_minimize_breakages=false,web_watch_pip_context_menu_button=false" \
  npx playwright test -c docs/manual-session/playwright.manual.config.ts --project=chromium --headed
```

YouTube's PiP flags on (the menu opens directly in the PiP window):

```bash
npx playwright test -c docs/manual-session/playwright.manual.config.ts --project=chromium-yt-pip --headed
```

Shorts, logged out:

```bash
MANUAL_URL="https://www.youtube.com/shorts" MANUAL_AUTH=false \
  npx playwright test -c docs/manual-session/playwright.manual.config.ts --project=chromium --headed
```

## Notes

- Keep the YouTube traffic low: many page loads from one IP trigger Google's "unusual traffic" CAPTCHA (see `CLAUDE.md`, E2E).
- The test account may already be in some experiments; `--project` and `E2E_FORCE_EXPERIMENT_FLAGS` make the flag set explicit. Real-profile issues still need a check in Chrome with Tampermonkey.
