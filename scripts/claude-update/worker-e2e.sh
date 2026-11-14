#!/usr/bin/env bash
# The dev worker end to end with the real Claude (CLAUDE_CODE_OAUTH_TOKEN) and a fake AWS / Telegram: it starts,
# answers a message from its queue through Claude, and saves its session on SIGTERM. Run by claude-code-update.yml
# after `npm ci` in scripts/dev-worker. Exit 1 when a step fails.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export FAKE_ROOT="$(mktemp -d)"
mkdir -p "$FAKE_ROOT/bin" "$FAKE_ROOT/home/youtube-pip/.git" "$FAKE_ROOT/s3/state" "$FAKE_ROOT/queue"
cp "$ROOT/scripts/claude-update/fake-aws.cjs" "$FAKE_ROOT/bin/aws"
printf '#!/bin/sh\necho ""\n' > "$FAKE_ROOT/bin/git"
printf '#!/bin/sh\nexit 0\n' > "$FAKE_ROOT/bin/npm"
printf '#!/bin/sh\n[ "$1" = czf ] && : > "$2"\nexit 0\n' > "$FAKE_ROOT/bin/tar"
chmod +x "$FAKE_ROOT/bin/"*
echo '{"sessionId":null}' > "$FAKE_ROOT/s3/state/meta.json"
echo "{\"text\":\"Reply with exactly: worker-ok\",\"date\":$(date +%s)}" > "$FAKE_ROOT/queue/001.json"

HOME="$FAKE_ROOT/home" PATH="$FAKE_ROOT/bin:$PATH" STATE_BUCKET=b QUEUE_URL=q TELEGRAM_BOT_TOKEN=x \
  TELEGRAM_CHAT_ID=1 UP_AT=0 CLAUDE_MODEL=haiku \
  node --import "$ROOT/scripts/claude-update/fake-telegram.mjs" "$ROOT/scripts/dev-worker/worker.mjs" \
  > "$FAKE_ROOT/worker.log" 2>&1 &
WORKER=$!

fail() {
  echo "FAIL $1"
  tail -40 "$FAKE_ROOT/worker.log" || true
  kill "$WORKER" 2>/dev/null || true
  exit 1
}

for _ in $(seq 1 180); do
  grep -q 'worker-ok' "$FAKE_ROOT/telegram.log" 2>/dev/null && break
  kill -0 "$WORKER" 2>/dev/null || fail "the worker exited"
  sleep 1
done
grep -q 'worker-ok' "$FAKE_ROOT/telegram.log" || fail "no answer from Claude within 3 minutes"
echo "ok   the worker answered a message through Claude"
# Claude Code got only the proxy's placeholder (anthropic-proxy.mjs): the answer came through the proxy
grep -q 'claude token proxy on' "$FAKE_ROOT/worker.log" || fail "the Claude token proxy did not start"
echo "ok   Claude answered through the token proxy"

kill -TERM "$WORKER"
for _ in $(seq 1 60); do
  grep -q 'saved: session=' "$FAKE_ROOT/worker.log" && break
  sleep 1
done
grep -q 'saved: session=' "$FAKE_ROOT/worker.log" || fail "no save on SIGTERM"
SESSION="$(grep -o 'saved: session=[^ ]*' "$FAKE_ROOT/worker.log" | tail -1 | cut -d= -f2)"
[ -n "$SESSION" ] && [ "$SESSION" != null ] || fail "the save has no session id"
ls "$FAKE_ROOT/s3/transcripts/"*/"$SESSION.jsonl" >/dev/null 2>&1 || fail "no transcript under transcripts/"
echo "ok   SIGTERM saved the session ($SESSION) and its transcript"
wait "$WORKER" 2>/dev/null || true
