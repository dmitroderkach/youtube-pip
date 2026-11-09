# Dev worker: Claude Code in Telegram

A Claude Code session (Opus) on an on-demand ECS task that the owner starts, talks to and stops from the on-call Telegram chat. It has what development and delivery need in this repository (branches, commits, PRs, CI status, releases with approval in the chat); its session survives restarts through S3. Same bot and same Claude subscription token as the on-call ([ONCALL.md](ONCALL.md)).

## Commands and statuses

| In the chat                                                 | What happens                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/up`                                                       | `⏳ Піднімаю воркера…` → `🟢 Воркер готовий (Opus). Контекст відновлено з сесії від <дата>; гілка <branch>[, робоча копія свіжа].` (no saved session: `🟢 Воркер готовий (Opus). Нова сесія; гілка <branch>.`); or `🟢 Воркер уже працює`, `⏳ Воркер уже піднімається`, `⏳ Попередній воркер ще вимикається: підніму новий, щойно він зупиниться` → `⏳ Піднімаю новий воркер…`, `🔴 Не вдалося підняти воркера: …`                    |
| `/down`                                                     | `⏳ Зупиняю, зберігаю контекст…` → `Контекст збережено, вимикаюсь…` (during a turn: `Поточну задачу перервано. Контекст збережено, вимикаюсь…`) → `⚪ Воркер зупинено` (sent by the bot on the task's STOPPED event, when it really is stopped); not running: `⚪ Воркер і так не запущений`                                                                                                                                             |
| `/start`                                                    | `Команди: /up — підняти воркера, /down — зупинити. Поки він працює, пиши йому сюди.`                                                                                                                                                                                                                                                                                                                                                     |
| `/context`                                                  | answered by the worker itself, no Claude turn (also mid-turn): `ctx 61% · 5h 12% ↻2h15m · week 14% ↻Fri 21:00` and the context tokens. `ctx` = session context window used (`getContextUsage`), `5h` / `week` = plan usage and reset (in 2h15m / Fri 21:00 Warsaw time) from the session's last `rate_limit_event`; before Claude's first answer in a run the limits show `?`. Not running: the bot starts the worker as for any message |
| `/background`                                               | answered by the worker itself, no Claude turn (also mid-turn): whether Claude is working now and the session's background tasks (shell commands, subagents): type, description, running for (since the worker saw it start)                                                                                                                                                                                                              |
| `/voice` [`auto` \| `on` \| `off` \| `samples` \| `<name>`] | voice reply settings, answered by the worker: mode (`auto`: answer the owner's voice messages also by voice, default; `on`: every answer; `off`), `samples` sends a sample of 6 female Chirp 3 HD voices, `<name>` (e.g. `Kore`) picks the voice; kept in `state/meta.json`                                                                                                                                                              |
| text, photo, voice, audio, file                             | to the worker; its answer comes back in the chat (`⏳ Працюю…` with the current step while it works). Not running: the worker is started for it (`⏳ Воркер не був запущений: піднімаю, передам повідомлення…`); starting: `📥 Отримав, передам, щойно підніметься`                                                                                                                                                                      |
| (10 min idle)                                               | `💤 10 хв без активності. Контекст збережено, вимикаюсь…` → `⚪ Воркер зупинено`                                                                                                                                                                                                                                                                                                                                                         |
| (15 min after the last answer, still up, no turn running)   | `🟡 Воркер працює вже N хв після останньої відповіді…` from the dev-bot (idle watchdog, every 5 min, repeated every 15 min while it stays so): likely a stray background task keeping the idle timer from firing; /background to look, /down to stop                                                                                                                                                                                     |
| (unexpected)                                                | `🔴 Воркер несподівано зупинився (<причина>). Контекст останнього збереження: <час>`                                                                                                                                                                                                                                                                                                                                                     |

Idle = no message from the owner and no work in progress for 10 minutes.

The worker's own stop message is sent as its process ends, and ECS needs another 30–60 s to stop the task. A message or `/up` while a stopped worker is still shutting down (possibly still saving its session) is not lost and not refused: the message is queued, the bot answers `⏳ Попередній воркер ще вимикається: підніму новий…` and leaves a marker (`state/pending-start.json` in the state bucket); the STOPPED event of that task starts the new worker, so it never restores a session that is still being saved.

## Architecture

```
Telegram ──webhook──▶ Lambda dev-bot (Function URL)
                        │  checks X-Telegram-Bot-Api-Secret-Token and the owner's chat id
                        ├─ /up    ─▶ ecs:RunTask  (dev-worker, FARGATE on-demand, public subnet + public IP)
                        ├─ /down  ─▶ ecs:StopTask (SIGTERM → the worker saves and exits)
                        └─ text   ─▶ SQS FIFO dev-worker-inbox
                                        │
                     ECS task dev-worker (2 vCPU / 4 GB) ◀──┘ long poll
                        ├─ restores the session and the working-copy snapshot from S3 (clones the repo only without a snapshot)
                        ├─ one Claude Code session for the whole run (Agent SDK, streaming input, opus, all tools);
                        │  each message goes into it; a message during a turn: running commands → background, priority 'next'
                        ├─ answers / statuses ─▶ Telegram Bot API
                        ├─ after each answer: session + working-copy snapshot ─▶ S3 dev-worker-state
                        ├─ after each answer: {lastAnswerAt, turnActive} ─▶ S3 state/activity.json
                        └─ idle 10 min / SIGTERM: save, notify, exit 0

EventBridge rate(5 minutes) ─▶ Lambda dev-bot (idle watchdog)
                        └─ worker up, no turn running, last answer ≥ 15 min ago ─▶ `🟡` warning + watchdog message in the queue, again every 15 min while it stays so
                             └─ worker: Claude stops the orphaned background tasks ─▶ idle timer stops the worker

EventBridge "ECS Task State Change" (dev-worker STOPPED) ─▶ Lambda dev-bot
                        └─ stop the worker did not report itself (exit ≠ 0, OOM, task killed) ─▶ `🔴` in the chat
```

- **Lambda dev-bot**: Telegram webhook, commands, statuses of starting / stopping, forwarding messages to the queue, and the `🔴` on an unexpected stop. Only the owner's chat (`telegram_chat_id` of `youtube-pip-oncall`) is served; the webhook is registered with a secret token that Telegram sends in every request.
- **SQS FIFO `dev-worker-inbox`**: messages in order, kept while the worker starts. Telegram allows either a webhook or polling per bot, so the worker never polls Telegram itself.
- **ECS task `dev-worker`**: on-demand Fargate (an interactive session interrupted by Spot costs more than the ~$0.07/h saved), its own image (Node, git, `gh`, Claude Code, Playwright Chromium for narrowed tests), in its own ECS cluster `dev-worker`, in the public subnet of the runner VPC with a public IP. It does not use the NAT instance: the NAT exists for the e2e runs, and the NAT lifecycle Lambda starts it whenever the runner cluster has a task, so the worker stays out of that cluster.
- **S3 `dev-worker-state`**: the Claude Code session (transcript), its id and a snapshot of the working copy (`state/workspace.tar.gz`, without `node_modules`, `dist`, test output and `terraform/.terraform`). Restored on every `/up`, so the conversation continues across `/down`, idle stops and restarts.
- **EventBridge rule**: ECS stop events of the `dev-worker` family → dev-bot, so a crash is reported even when the worker could not say anything.

## Idle watchdog

The worker stops after 10 minutes without a turn or a background task. A background task that never ends (a stuck watch, a forgotten server) keeps it up indefinitely, and there is no hard lifetime limit. So the worker writes `state/activity.json` (`lastAnswerAt`, `turnActive`, `stopping`: a worker saving its session before it exits is not warned about) when a turn starts and after each answer (also the ready message), and the dev-bot Lambda runs every 5 minutes (EventBridge schedule): if the worker task is running, no turn is active and the last answer is at least `dev_worker_idle_alert_minutes` (15, above the 10-minute idle stop) old, it sends `🟡 Воркер працює вже N хв після останньої відповіді…` with /background and /down, and repeats every `dev_worker_idle_alert_minutes` while nothing changes (`state/idle-alert.json` keeps the answer and the time of the last warning). The same check also puts a watchdog message into the worker's queue (`{watchdog: "idle", lastAnswerAt, minutes}`, deduplicated per warning). The worker does not count it as the owner's activity; when it is current (no answer since), no turn is running and background tasks exist, it gives Claude the list of background tasks (type, description, running time, task id). Claude stops only the orphaned ones (nobody waits for them any more) with TaskStop, keeps the ones it deliberately waits for and says in the chat what it stopped and kept; with no background task left, the 10-minute idle timer stops the worker without the owner. The dev-bot never stops the worker itself; a long turn is not warned about.

## Talking while it works

The worker keeps one Claude Code session open for the whole run (Claude Agent SDK, streaming input), like an interactive terminal:

- A message that arrives while Claude is working is not queued behind the turn: its running commands (Bash, subagents) are moved to the background (`backgroundTasks()`, the SDK's Ctrl+B) and keep running, and the message is delivered at the turn's next step (`priority: 'next'`: at once when nothing blocks, without cutting off what the model is writing) with a note that it arrived mid-task. The chat gets `📨 Передав одразу; поточні команди пішли у фон` (only when there were blocking commands; the worker tracks tool calls still waiting for their result). A turn that still ends cut off by the new message is marked `↪️ Перервано новим повідомленням` instead of showing its internal error.
- Long waits (CI, builds, e2e) are run in the background by the model (system prompt); background tasks survive between turns, and their completion notifies the model.
- The idle timer counts only while there is no turn and no background task, so a long CI watch in the background does not stop the worker.
- Any turn (also one started by a finished background task) shows `⏳ Працюю…` with the current step and ends with its answer.

## Photos, voice and files (both ways)

- **Photos, screenshots, files** (with an optional caption): the worker downloads them through the Bot API (up to 20 MB) to `~/inbox` and passes the paths to Claude, which opens images and PDFs with its Read tool.
- **Voice messages and audio**: AWS Transcribe (`uk-UA`, batch job on the file uploaded to `inbox/` of the state bucket, deleted afterwards; ~10 s for a short message, ≈ $0.024 per minute of audio). The chat gets `🎙 Розпізнав: «…»` and the text goes to Claude as the message.
- **From the worker to the chat**: files Claude saves into `~/outbox` (screenshots of a headless browser, logs, reports, a built userscript) are sent right after its answer: png / jpg / webp / gif as photos, anything else and images over 10 MB as documents (up to 50 MB, the Bot API limit), the file name as caption; then moved to `~/outbox/sent`.

## Voice replies

- Google Cloud Text-to-Speech, Chirp 3 HD voices `uk-UA-Chirp3-HD-<name>` (default `Aoede`), OGG/Opus sent with `sendVoice`. API key `google_tts_api_key` in the secret `youtube-pip-dev-worker` (restricted to the Text-to-Speech API) → `GOOGLE_TTS_API_KEY`, removed from Claude's environment like the Telegram token. The task definition reads it from the secret, so the key must exist there (ECS does not start the task otherwise); an empty value turns voice replies off.
- A message that gets a voice reply (`/voice` mode) carries a note asking Claude to end the answer with `<voice>…</voice>`, a short spoken summary; the worker cuts it out of the text (the text answer stays complete), speaks it and sends it after the text. No block: a shortened text without links and code is spoken.
- Cost: Chirp 3 HD $30 per 1M characters with 1M free a month (a summary is ~300–500 characters); set a budget alert in the GCP project.

## Replies, forwards and on-call reports

- **Replies and forwards**: the dev-bot Lambda passes the replied-to message (its text or caption, whether the bot or the owner wrote it, its attachments' kinds, the quoted part) and a forward's origin with the message; the worker puts them before the owner's text as a quote. So the owner can reply to an earlier answer, an on-call report or their own message, or forward one, instead of copying it.
- **On-call reports**: the on-call agent ([ONCALL.md](ONCALL.md)) posts through the same bot, and Telegram does not deliver a bot's own messages to its webhook, so a report never starts the worker. With each owner message (checked at most once a minute) the worker looks for **Manual E2E** runs of the last 48 h whose on-call job sent a report (`Send to Telegram` or `Report on-call failure` succeeded) and that this session has not seen (`oncallHandled` in `state/meta.json`). The newest 3 are downloaded (artifact `oncall` → `~/oncall/<run id>`) and go to Claude before the owner's text: the message the owner got, the run link and where the files are. The chat gets `📎 Підвантажив звіт онколу: <time>`. So "берись за фікс" after a report is enough; an older report: reply to it.

## Permissions and secrets

| What                       | Where                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code (subscription) | `youtube-pip-oncall` → `claude_code_oauth_token` (same as the on-call; shares its usage limits)                                                                                            |
| Telegram bot, chat id      | `youtube-pip-oncall` → `telegram_bot_token`, `telegram_chat_id`                                                                                                                            |
| GitHub                     | `youtube-pip-dev-worker` → `github_token`: fine-grained token for `dmitroderkach/youtube-pip` only: Contents, Pull requests, Workflows, Actions read/write; Commit statuses, Metadata read |
| Google Text-to-Speech      | `youtube-pip-dev-worker` → `google_tts_api_key`: API key of the GCP project `youtube-pip-dev-worker`, restricted to the Cloud Text-to-Speech API (voice replies)                           |
| AWS (task role)            | only its S3 state bucket, its SQS queue and AWS Transcribe jobs: no infrastructure rights                                                                                                  |

- The worker runs Claude Code with all tools (shell, edits, network) inside the container. The repository's `CLAUDE.md` rules apply: merges, tags / releases and anything outward-facing only after the owner's explicit "так" in the chat; infrastructure changes (`terraform apply`) are not done from the worker.
- Checks without AWS: the image has Terraform (`fmt`, `init -backend=false`, `validate`; providers cached per run in `~/.terraform.d/plugin-cache`, outside the saved workspace) and Python 3.12 with boto3 (the Lambda runtime) for `terraform/lambda`. `terraform plan` / `apply` stay with the owner.
- `main` stays protected (squash merge, required green `build`), so nothing lands without CI.
- The worker reads data from the web (YouTube pages, CI logs): untrusted. The blast radius is bounded by the repository-scoped token and the absence of AWS rights; the GitHub token is rotated on expiry (the worker says so in the chat when GitHub rejects it).

## Cost

On-demand 2 vCPU / 4 GB ≈ $0.10 per hour of work (plus a public IPv4 address, ≈ $0.005/h); nothing while stopped (idle stop after 10 min; no hard lifetime limit: the idle watchdog warns when a run stays up 15 min after the last answer with no turn running, e.g. held by a stray background task). Lambda, SQS and S3 are within cents. Claude usage counts against the subscription of `claude setup-token`, shared with the on-call (Opus uses the limits faster than the on-call's Sonnet).

## Files

- `terraform/dev_worker.tf` — dev-worker ECS cluster, dev-bot Lambda + Function URL, SQS FIFO, S3 bucket, ECR repository, task definition, EventBridge rule, IAM.
- `terraform/lambda/dev_bot.py` — webhook, commands, statuses, stop events.
- `terraform/dev-worker/` — worker image (`Dockerfile`, entrypoint).
- `scripts/dev-worker/` — the worker loop (queue, Claude Code, Telegram, S3 state, idle timer), the system prompt and a Claude Code `PreToolUse` hook (`english-only-hook.mjs`, installed as the worker's user settings) that blocks `gh pr|issue|release|api` / `git commit|tag` commands with Cyrillic text: the model tends to copy earlier Ukrainian texts from the session despite the prompt, and the block makes it rewrite them in English.

## Setup and operating

1. Secret `youtube-pip-dev-worker` (Secrets Manager, filled by hand): `github_token`, `google_tts_api_key` (both must exist before the task starts). The webhook secret is added by step 4.
2. `terraform -chdir=terraform apply` (the dev-worker resources live in `terraform/dev_worker.tf`).
3. `scripts/build-dev-worker-image.sh` builds and pushes the image (`:latest`, used by the next `/up`). Rebuild it when `scripts/dev-worker/` or `terraform/dev-worker/` changes.
4. (also after a change of the command menu) `node scripts/dev-worker/setup-telegram.mjs "$(terraform -chdir=terraform output -raw dev_bot_webhook_url)"`: generates the webhook secret (stored in the secret, never printed), sets the bot's webhook to the dev-bot Lambda and the `/up`, `/down`, `/context`, `/background`, `/voice` menu.

- **Telegram network**: every Bot API call is retried (3 attempts with a pause) and never throws; a stray rejection is logged, not fatal. A dropped connection to Telegram (seen live: `connect ETIMEDOUT` to api.telegram.org) used to kill the worker through an unhandled rejection of a progress update.
- **Logs**: CloudWatch `/ecs/youtube-pip-prod-dev-worker` (worker), `/aws/lambda/youtube-pip-prod-dev-bot` (bot).
- **Start fresh**: delete `state/` and `claude/` in the state bucket (or wait a week without using the worker).
- **Rotate the GitHub token**: new fine-grained token with the permissions above → `github_token` in the secret; the next `/up` uses it.
- **Bot stops answering**: `getWebhookInfo` of the bot shows the last delivery error; re-run step 4.
