# Dev worker: Claude Code in Telegram

A Claude Code session (Opus) on an on-demand ECS task that the owner starts, talks to and stops from the on-call Telegram chat. It has what development and delivery need in this repository (branches, commits, PRs, CI status, releases with approval in the chat); its session survives restarts through S3. Same bot and same Claude subscription token as the on-call ([ONCALL.md](ONCALL.md)).

## Commands and statuses

| In the chat                     | What happens                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/up`                           | `⏳ Піднімаю воркера…` → `🟢 Воркер готовий. Контекст відновлено з сесії від <дата>` (or `🟢 Воркер уже працює`, `🔴 Не вдалося підняти: …`)                                    |
| `/down`                         | `⏳ Зупиняю, зберігаю контекст…` → `⚪ Воркер зупинено, контекст збережено`                                                                                                     |
| text, photo, voice, audio, file | to the worker; its answer comes back in the chat (`працюю…` while it works). Not running: `Воркер не запущений. Напиши /up`; starting: `📥 Отримав, передам, щойно підніметься` |
| (10 min idle)                   | `💤 10 хв без активності: контекст збережено, воркер зупинився`                                                                                                                 |
| (4 h lifetime)                  | `⏱ Досягнуто ліміту 4 год: контекст збережено, воркер зупинився`                                                                                                                |
| (unexpected)                    | `🔴 Воркер несподівано зупинився (<причина>). Контекст останнього збереження: <час>`                                                                                            |

Idle = no message from the owner and no work in progress for 10 minutes.

## Architecture

```
Telegram ──webhook──▶ Lambda dev-bot (Function URL)
                        │  checks X-Telegram-Bot-Api-Secret-Token and the owner's chat id
                        ├─ /up    ─▶ ecs:RunTask  (dev-worker, FARGATE on-demand, public subnet + public IP)
                        ├─ /down  ─▶ ecs:StopTask (SIGTERM → the worker saves and exits)
                        └─ text   ─▶ SQS FIFO dev-worker-inbox
                                        │
                     ECS task dev-worker (2 vCPU / 4 GB) ◀──┘ long poll
                        ├─ restores the session from S3, clones the repo, applies the saved uncommitted changes
                        ├─ one Claude Code session for the whole run (Agent SDK, streaming input, opus, all tools);
                        │  each message goes into it; a message during a turn: running commands → background, priority 'now'
                        ├─ answers / statuses ─▶ Telegram Bot API
                        ├─ after each answer: session + uncommitted diff ─▶ S3 dev-worker-state
                        └─ idle 10 min / 4 h / SIGTERM: save, notify, exit 0

EventBridge "ECS Task State Change" (dev-worker STOPPED) ─▶ Lambda dev-bot
                        └─ stop the worker did not report itself (exit ≠ 0, OOM, task killed) ─▶ `🔴` in the chat
```

- **Lambda dev-bot**: Telegram webhook, commands, statuses of starting / stopping, forwarding messages to the queue, and the `🔴` on an unexpected stop. Only the owner's chat (`telegram_chat_id` of `youtube-pip-oncall`) is served; the webhook is registered with a secret token that Telegram sends in every request.
- **SQS FIFO `dev-worker-inbox`**: messages in order, kept while the worker starts. Telegram allows either a webhook or polling per bot, so the worker never polls Telegram itself.
- **ECS task `dev-worker`**: on-demand Fargate (an interactive session interrupted by Spot costs more than the ~$0.07/h saved), its own image (Node, git, `gh`, Claude Code, Playwright Chromium for narrowed tests), in its own ECS cluster `dev-worker`, in the public subnet of the runner VPC with a public IP. It does not use the NAT instance: the NAT exists for the e2e runs, and the NAT lifecycle Lambda starts it whenever the runner cluster has a task, so the worker stays out of that cluster.
- **S3 `dev-worker-state`**: the Claude Code session (transcript), its id and the uncommitted diff of the working tree. Restored on every `/up`, so the conversation continues across `/down`, idle stops and restarts.
- **EventBridge rule**: ECS stop events of the `dev-worker` family → dev-bot, so a crash is reported even when the worker could not say anything.

## Talking while it works

The worker keeps one Claude Code session open for the whole run (Claude Agent SDK, streaming input), like an interactive terminal:

- A message that arrives while Claude is working is not queued behind the turn: its running commands (Bash, subagents) are moved to the background (`backgroundTasks()`, the SDK's Ctrl+B) and keep running, and the message is delivered at once (`priority: 'now'`) with a note that it arrived mid-task. The chat gets `📨 Передав одразу; поточні команди пішли у фон`.
- Long waits (CI, builds, e2e) are run in the background by the model (system prompt); background tasks survive between turns, and their completion notifies the model.
- The idle timer counts only while there is no turn and no background task, so a long CI watch in the background does not stop the worker.
- Any turn (also one started by a finished background task) shows `⏳ Працюю…` with the current step and ends with its answer.

## Photos, voice and files

- **Photos, screenshots, files** (with an optional caption): the worker downloads them through the Bot API (up to 20 MB) to `~/inbox` and passes the paths to Claude, which opens images and PDFs with its Read tool.
- **Voice messages and audio**: AWS Transcribe (`uk-UA`, batch job on the file uploaded to `inbox/` of the state bucket, deleted afterwards; ~10 s for a short message, ≈ $0.024 per minute of audio). The chat gets `🎙 Розпізнав: «…»` and the text goes to Claude as the message.

## Permissions and secrets

| What                       | Where                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code (subscription) | `youtube-pip-oncall` → `claude_code_oauth_token` (same as the on-call; shares its usage limits)                                                                                            |
| Telegram bot, chat id      | `youtube-pip-oncall` → `telegram_bot_token`, `telegram_chat_id`                                                                                                                            |
| GitHub                     | `youtube-pip-dev-worker` → `github_token`: fine-grained token for `dmitroderkach/youtube-pip` only: Contents, Pull requests, Workflows, Actions read/write; Commit statuses, Metadata read |
| AWS (task role)            | only its S3 state bucket, its SQS queue and AWS Transcribe jobs: no infrastructure rights                                                                                                  |

- The worker runs Claude Code with all tools (shell, edits, network) inside the container. The repository's `CLAUDE.md` rules apply: merges, tags / releases and anything outward-facing only after the owner's explicit "так" in the chat; infrastructure changes (`terraform apply`) are not done from the worker.
- `main` stays protected (squash merge, required green `build`), so nothing lands without CI.
- The worker reads data from the web (YouTube pages, CI logs): untrusted. The blast radius is bounded by the repository-scoped token and the absence of AWS rights; the GitHub token is rotated on expiry (the worker says so in the chat when GitHub rejects it).

## Cost

On-demand 2 vCPU / 4 GB ≈ $0.10 per hour of work (plus a public IPv4 address, ≈ $0.005/h); nothing while stopped (idle stop after 10 min, hard limit 4 h). Lambda, SQS and S3 are within cents. Claude usage counts against the subscription of `claude setup-token`, shared with the on-call (Opus uses the limits faster than the on-call's Sonnet).

## Files

- `terraform/main.tf` — dev-worker ECS cluster, dev-bot Lambda + Function URL, SQS FIFO, S3 bucket, ECR repository, task definition, EventBridge rule, IAM.
- `terraform/lambda/dev_bot.py` — webhook, commands, statuses, stop events.
- `terraform/dev-worker/` — worker image (`Dockerfile`, entrypoint).
- `scripts/dev-worker/` — the worker loop (queue, Claude Code, Telegram, S3 state, idle timer), the system prompt and a Claude Code `PreToolUse` hook (`english-only-hook.mjs`, installed as the worker's user settings) that blocks `gh pr|issue|release|api` / `git commit|tag` commands with Cyrillic text: the model tends to copy earlier Ukrainian texts from the session despite the prompt, and the block makes it rewrite them in English.

## Setup and operating

1. Secret `youtube-pip-dev-worker` (Secrets Manager, filled by hand): `github_token`. The webhook secret is added by step 4.
2. `terraform -chdir=terraform apply` (the dev-worker resources live in `terraform/dev_worker.tf`).
3. `scripts/build-dev-worker-image.sh` builds and pushes the image (`:latest`, used by the next `/up`). Rebuild it when `scripts/dev-worker/` or `terraform/dev-worker/` changes.
4. `node scripts/dev-worker/setup-telegram.mjs "$(terraform -chdir=terraform output -raw dev_bot_webhook_url)"`: generates the webhook secret (stored in the secret, never printed), sets the bot's webhook to the dev-bot Lambda and the `/up`, `/down` menu.

- **Logs**: CloudWatch `/ecs/youtube-pip-prod-dev-worker` (worker), `/aws/lambda/youtube-pip-prod-dev-bot` (bot).
- **Start fresh**: delete `state/` and `claude/` in the state bucket (or wait a week without using the worker).
- **Rotate the GitHub token**: new fine-grained token with the permissions above → `github_token` in the secret; the next `/up` uses it.
- **Bot stops answering**: `getWebhookInfo` of the bot shows the last delivery error; re-run step 4.
