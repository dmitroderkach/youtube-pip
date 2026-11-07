# On-call: Daily E2E Watch and YouTube Flag Scan

After every run of the **Manual E2E** workflow (daily at 16:00 UTC and on manual dispatch) an `oncall` job:

1. **Summarizes the results** — `scripts/oncall/summarize-results.mjs` reads the Playwright JSON report: failed, flaky, passed.
2. **Scans YouTube experiment flags** — `scripts/oncall/scan-flags.mjs` loads a logged-out watch page, reads the page `EXPERIMENT_FLAGS` and the player `serializedExperimentFlags`, keeps the ones that can touch the userscript (PiP, mini player, CoW, context menu, watch-while, hotkeys, Shorts, …) and compares them with [`experiment-flags-baseline.json`](experiment-flags-baseline.json) and with the flags reported by earlier runs (GitHub Actions cache). It also downloads the Kevlar and player bundles of that page.
3. **Investigates, only if needed** — when a test failed or was flaky, the results or the flag scan are missing, or there are new relevant flags, Claude Code runs headless with [`scripts/oncall/investigate-prompt.md`](../scripts/oncall/investigate-prompt.md): it classifies each failure (our regression / YouTube change / environment) from the error, the mini player timeline, the userscript log and the page snapshot, and for each new flag reads its uses in the bundles and recommends ignore / watch / add to the e2e matrix / fix.
4. **Sends the finding to Telegram** in Ukrainian (`scripts/oncall/telegram-send.mjs`): verdict, tests and flags with cause, evidence and what to do, the run link, and a line to continue in Claude Code. All green without new flags → no message.

The artifact `oncall` of the run keeps `results-summary.json`, `flags.json`, the report, the sent message and the full Claude transcript (`claude-transcript.jsonl`).

## Continue in Claude Code

Every message ends with `Розбери онкол-прогін <run URL>`. Paste it into a Claude Code session in this repo: the run's artifacts (`oncall`, `e2e-results`, `playwright-report-manual-e2e`) hold everything the on-call saw, including its transcript (`gh run download <id> -n oncall`).

## Runner and secrets

- The job runs on `runs-on: [self-hosted, fargate, oncall]`. The dispatcher Lambda starts a separate, small task definition `runner-oncall` (1 vCPU / 2 GB) for it, with the secrets from AWS Secrets Manager **`youtube-pip-oncall`** (JSON: `claude_code_oauth_token`, `telegram_bot_token`, `telegram_chat_id`) as `CLAUDE_CODE_OAUTH_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. The CI runner never gets them.
- The repository is public and any workflow file (also one changed in a pull request) could ask for the `oncall` label, so the Lambda checks the run through the GitHub API: only `schedule` / `workflow_dispatch` runs of `var.oncall_branch` (default `main`) of this repository get the on-call runner (`terraform/lambda/worker.py`).
- Claude Code runs with read-only tools (`Read`, `Grep`, `Glob`), no shell and no network, and without the Telegram secrets in its environment: it reads data downloaded from YouTube, which is untrusted. Usage counts against the Claude subscription of `claude setup-token`, not AWS.

## Operating

- **Test the pipeline**: run **Manual E2E** with `force_report: true` — investigates and sends a message even if everything passed.
- **Test from a branch**: the Lambda only allows `var.oncall_branch`; for a test apply with `-var oncall_branch=<branch>`, dispatch the workflow on that branch, then apply again without it.
- **Rotate a token**: edit the secret `youtube-pip-oncall` in Secrets Manager; new tasks pick it up.
- **Too many flag messages**: flags are reported once (cache `oncall-seen-flags-*`). To accept the current set, regenerate the baseline: run `node scripts/oncall/scan-flags.mjs <dir>` a couple of times and put the union of the `relevant` names into `experiment-flags-baseline.json` (only observed flags: the ones we merely force in e2e are not served to logged-out pages and would show up as "gone").
- **Pause**: disable the **Manual E2E** workflow (`gh workflow disable e2e-manual.yml`).
