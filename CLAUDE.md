# CLAUDE.md

Project rules live in `.cursor/` and are shared with Cursor. They are imported here so Claude Code follows the same flows; edit the `.mdc` files, not this file, to change a flow.

## Workflows (Cursor rules)

| User says                                                    | Follow                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| "бамп версії" [мінор / мажор], "bump version"                | **Bump Version Flow** — @.cursor/rules/bump-version.mdc |
| "реліз флов", "залий зміни і створи реліз", "create release" | **Release Flow** — @.cursor/rules/release-flow.mdc      |
| Writing or changing unit tests                               | **Test rules** — @.cursor/rules/tests.mdc               |

The Cursor slash commands `.cursor/commands/bump-version.md` and `.cursor/commands/release-flow.md` only point at these rules. Run the flows step by step in the order the rule gives; when a step fails (e.g. PR checks), stop and handle it as the rule says before continuing.

## Language

- Talk to the owner in Ukrainian (this chat, Telegram messages).
- Everything in the repository and on GitHub is in English: code, comments, docs, commit messages, branch names, PR titles and descriptions, PR / issue comments, CHANGELOG.

## Commit and PR conventions

- Commit message for a release = first line of `PR_DESCRIPTION.md` (after `# `). `PR_DESCRIPTION.md` is git-ignored and never committed.
- Squash-merge PRs; tag with `npm run release:tag` on `main` after the merge so the tag points at the merge commit.

## E2E

- CI e2e runs only on the AWS self-hosted runner (`runs-on: [self-hosted, fargate]`); never move it to GitHub-hosted runners (the Google test account gets banned there).
- Locally: `npx playwright test` uses the frozen session in `e2e/.auth/storageState.json`. `SKIP_AUTH_E2E_ON_CI=true` skips the auth-backed specs (like-dislike, Shorts). Never re-save the session from CI.
- E2E triggers PiP through a stub (`__E2E_PIP__.trigger`), not Chrome's media controls, and the test account may sit in different YouTube experiments than a real profile. Check real-profile issues in Chrome too, or force the experiment with `E2E_FORCE_EXPERIMENT_FLAGS=<flag,…>`. The suite runs as a matrix over known YouTube experiment flags (Playwright projects); flags and the flows they touch: `docs/YOUTUBE_EXPERIMENT_FLAGS.md`. Locally run one project (`--project=chromium`). `like-dislike.spec.ts` changes the test account, so it runs only in the single-worker `account-mutations` project (all flag sets in sequence); never let it run in parallel with itself.
- Manual check in a visible browser with a chosen flag set (e.g. the old flow without PiP flags): `docs/MANUAL_SESSION.md` (`npx playwright test -c docs/manual-session/playwright.manual.config.ts --project=<project> --headed`).
- Keep local e2e volume small (a handful of runs per check). Hundreds of YouTube loads from one IP trigger Google's "unusual traffic" CAPTCHA; if it appears, stop all YouTube traffic.

## On-call

- "Розбери онкол-прогін <run URL>": download the run's artifacts (`gh run download <id> -n oncall`, `-n e2e-results`, `-n playwright-report-manual-e2e`), read `report.txt` and `claude-transcript.jsonl` first, then continue the investigation. How it works: `docs/ONCALL.md`.

## Self-hosted runner

- Runner task: 8 vCPU / 16 GB on Fargate Spot with on-demand fallback (`terraform/README.md`); Playwright uses 8 workers on CI (`CI_WORKERS`). Lower it if Google's CAPTCHA appears on CI.

### Runner image

- `terraform/runner/Dockerfile` pins `RUNNER_VERSION`. When jobs stay queued and the runner log says `Runner version vX is deprecated and cannot receive messages`, bump it to the latest stable from https://github.com/actions/runner/releases.
- Build and push with `scripts/build-runner-image.sh latest` (amd64, ECR `youtube-pip-prod-runner:latest`). It overwrites the prod image, so get explicit approval first. Then re-run the stuck workflow run, because queued jobs are not re-dispatched automatically.
