#!/usr/bin/env bash
# Dev worker entrypoint (docs/DEV_WORKER.md): GitHub auth for git / gh, then the worker loop. exec keeps the worker
# PID 1, so ECS StopTask's SIGTERM reaches it (it saves the session to S3 and reports in the chat).
set -euo pipefail

git config --global user.name "${GIT_USER_NAME:-Dev worker}"
git config --global user.email "${GIT_USER_EMAIL:-dev-worker@users.noreply.github.com}"
git config --global init.defaultBranch main
git config --global pull.rebase false

if [ -n "${GITHUB_APP_ID:-}" ]; then
  # The worker's own GitHub App: a fresh installation token for every git / gh call (github-app-token caches it for
  # its hour). No static token in the environment.
  unset GITHUB_TOKEN GH_TOKEN
  git config --global credential.https://github.com.helper \
    '!f() { [ "$1" = get ] || exit 0; echo username=x-access-token; echo "password=$(github-app-token)"; }; f'
  github-app-token >/dev/null
else
  # Older setup: the owner's fine-grained token (until the App's keys are in the secret)
  : "${GITHUB_TOKEN:?GITHUB_TOKEN or GITHUB_APP_ID is required}"
  export GH_TOKEN="${GITHUB_TOKEN}"
  unset GITHUB_TOKEN
  gh auth setup-git
fi

exec node /opt/dev-worker/worker.mjs
