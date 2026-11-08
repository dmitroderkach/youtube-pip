#!/usr/bin/env bash
# Dev worker entrypoint (docs/DEV_WORKER.md): GitHub auth for git / gh, then the worker loop. exec keeps the worker
# PID 1, so ECS StopTask's SIGTERM reaches it (it saves the session to S3 and reports in the chat).
set -euo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN is required}"
export GH_TOKEN="${GITHUB_TOKEN}"
unset GITHUB_TOKEN

git config --global user.name "${GIT_USER_NAME:-Dev worker}"
git config --global user.email "${GIT_USER_EMAIL:-dev-worker@users.noreply.github.com}"
git config --global init.defaultBranch main
git config --global pull.rebase false
gh auth setup-git

exec node /opt/dev-worker/worker.mjs
