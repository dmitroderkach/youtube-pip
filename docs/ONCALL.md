# On-call: Daily E2E Watch and YouTube Flag Scan

After every run of the **Manual E2E** workflow (daily at 16:00 UTC and on manual dispatch) an `oncall` job:

1. **Summarizes the results** — `scripts/oncall/summarize-results.mjs` reads the Playwright JSON report: failed, flaky, passed.
2. **Scans YouTube experiment flags** — `scripts/oncall/scan-flags.mjs`, keeping the flags that can touch the userscript. A flag is **relevant** when
   - its **name** matches our areas (`pip`, `miniplayer`, `cow`, `context_menu`, `watch_while`, `hotkey`, `shorts`, `speedmaster`, `popup`, `append_to`, …; `RELEVANT_FLAG_RE`), or
   - it is **checked next to code our flows go through**: within ~600 characters (about one minified function) of an anchor such as `yt-activate-miniplayer`, `ytd-miniplayer`, `SET_MINIPLAYER_IS_ACTIVE`, `enterpictureinpicture`, `documentPictureInPicture`, `setActionHandler`, `appendTo`, `ytd-player`, `ytd-shorts`, `ytp-contextmenu`, `ytp-bezel` (`CODE_ANCHORS`). This catches flags with unrelated names (e.g. `disable_theater_mode` next to mini player activation); each flag carries `why` (`name`, `near <anchor>`).

   Two scans:
   - **In the code (complete)**: every flag the Kevlar and player bundles check. The bundles are the same for every user, so this shows what YouTube prepares before it is rolled out to anyone (today ~1800 flags checked, ~140 relevant — ~120 by name, ~20 only by an anchor — most of them not served to a logged-out visitor). The flag-reading functions are minified differently in every build; they are recognized from the data (call targets whose string arguments are largely flags the page was served).
   - **Served (a sample)**: the flags this logged-out page got (page `EXPERIMENT_FLAGS`, player `serializedExperimentFlags`). YouTube buckets visitors randomly into experiments, so every load sees a different subset — this shows what is rolled out, never everything.
   - Both are compared with [`experiment-flags-baseline.json`](experiment-flags-baseline.json) (`codeFlags`, `flags`) and with flags already reported (GitHub Actions cache, saved only after the report went out), so each new flag is reported once.

3. **Probes new flags** — for up to 5 new relevant boolean flags, the `chromium` e2e set (9 tests) runs once with the flag forced to the opposite of its usual state (on if the page was not served it, off if it got true; `scripts/oncall/probe-flags.mjs`). A test failing only with the flag forced shows the flag breaks us; all green shows our flows survive it. Runs in the `flags` job on the CI runner; without new flags that job is only the scan. Flags over the limit are listed in the message ("⏳ Не прогнано тестами …") and stay new, so the next runs probe them (5 per run).
4. **Finds the flag culprit of failed and flaky tests** — `scripts/oncall/confirm-flag-culprit.mjs`, in the `flags` job. The e2e fixtures record the relevant boolean flags that were `true` for each failed attempt and for a passing retry and not forced by the project (`e2e/fixtures/page-flags.ts`, files in `e2e-results/page-flags/`). A logged-out context lands in a random experiment bucket on every load, so a flag may show up in one attempt only and a plain re-run proves nothing; instead:
   - **suspects** = flags on in every failed attempt, minus flags also on in the passing retry (a flaky test whose passing attempt had the same flags is not a flag problem);
   - the test re-runs with all suspects **forced on** (the failed attempt's state): passes → not reproduced by flags; then with all **forced off**: still fails → not the flags;
   - otherwise **bisect** (suspects on, half of them off) down to one flag, or the set that only fails together.

   Failed tests first, then flaky ones; at most 2 tests per run (~log2(suspects) + 2 runs each, ~1 min per run on CI). The result is a fixed line in the message, independent of Claude: "🎯 Прапорець-винуватець: <flag> — <test>: з ним падає, без нього проходить", "🔎 <test>: … — не прапорець", or "⏳ Не перевірено на прапорці" over the limit. To check a culprit by hand: `E2E_FORCE_EXPERIMENT_FLAGS=<flag>=false npx playwright test <spec>:<line> --project=<project>`.

5. **Investigates, only if needed** — when a test failed or was flaky, the results are missing, reading flags broke, or there are new relevant flags (in the code or served), Claude Code runs headless with [`scripts/oncall/investigate-prompt.md`](../scripts/oncall/investigate-prompt.md): it classifies each failure (our regression / YouTube change / environment) from the error, the mini player timeline, the userscript log and the page snapshot, and for each new flag reads its uses in the bundles and recommends ignore / watch / add to the e2e matrix / fix.
6. **Sends the finding to Telegram** in Ukrainian (`scripts/oncall/telegram-send.mjs`): the reason for the report, verdict, tests and flags with cause, evidence and what to do, the run link, and a line to continue in Claude Code. All green without new flags → no message.

**Broken flag reading always reaches Telegram**: the scan fails on purpose when no flags are on the page, a bundle is missing, no flag reader is found, or the code yields less than half of the baseline's relevant flags; a failed scan is a reason to report. If the on-call job itself breaks before a message went out, a last step sends "🔴 Онкол зламався" with the run link.

The artifact `oncall` of the run keeps `results-summary.json`, `flags.json`, the probe and culprit summaries, the report, the sent message and the full Claude transcript (`claude-transcript.jsonl`).

## Continue in Claude Code

Every message ends with `Розбери онкол-прогін <run URL>`. Paste it into a Claude Code session in this repo: the run's artifacts (`oncall`, `e2e-results`, `playwright-report-manual-e2e`) hold everything the on-call saw, including its transcript (`gh run download <id> -n oncall`).

## Runner and secrets

- The job runs on `runs-on: [self-hosted, fargate, oncall]`. The dispatcher Lambda starts a separate, small task definition `runner-oncall` (1 vCPU / 2 GB) for it, with the secrets from AWS Secrets Manager **`youtube-pip-oncall`** (JSON: `claude_code_oauth_token`, `telegram_bot_token`, `telegram_chat_id`) as `CLAUDE_CODE_OAUTH_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. The CI runner never gets them.
- The repository is public and any workflow file (also one changed in a pull request) could ask for the `oncall` label, so the Lambda checks the run through the GitHub API: only `schedule` / `workflow_dispatch` runs of `var.oncall_branch` (default `main`) of this repository get the on-call runner (`terraform/lambda/worker.py`).
- Claude Code runs with read-only tools (`Read`, `Grep`, `Glob`), no shell and no network, and without the Telegram secrets in its environment: it reads data downloaded from YouTube, which is untrusted. Model: `--model sonnet`, the alias for the latest Sonnet (updates by itself, never switches to another family); anything suspicious is investigated further by hand. Usage counts against the Claude subscription of `claude setup-token`, not AWS.

## Operating

- **Test the pipeline**: run **Manual E2E** with `force_report: true` — investigates and sends a message even if everything passed.
- **Probe a flag by hand**: run **Manual E2E** with `probe_flags: flag_a,flag_b` (and `force_report: true` to get the message) — the `chromium` set runs with each flag flipped, new or not.
- **Test from a branch**: the Lambda only allows `var.oncall_branch`; for a test apply with `-var oncall_branch=<branch>`, dispatch the workflow on that branch, then apply again without it.
- **Rotate a token**: edit the secret `youtube-pip-oncall` in Secrets Manager; new tasks pick it up.
- **Too many flag messages**: flags are reported once (cache `oncall-seen-flags-*`). To accept the current set, regenerate the baseline: run `node scripts/oncall/scan-flags.mjs <dir>` a couple of times and put the union of the `relevant` names into `experiment-flags-baseline.json` (only observed flags: the ones we merely force in e2e are not served to logged-out pages and would show up as "gone").
- **Pause**: disable the **Manual E2E** workflow (`gh workflow disable e2e-manual.yml`).
