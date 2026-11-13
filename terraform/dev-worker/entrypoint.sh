#!/usr/bin/env bash
# Dev worker entrypoint (docs/DEV_WORKER.md): GitHub auth for git / gh, then the worker loop. exec keeps the worker
# PID 1, so ECS StopTask's SIGTERM reaches it (it saves the session to S3 and reports in the chat).
set -euo pipefail

git config --global user.name "${GIT_USER_NAME:-Dev worker}"
git config --global user.email "${GIT_USER_EMAIL:-dev-worker@users.noreply.github.com}"
git config --global init.defaultBranch main
git config --global pull.rebase false

# The worker's own GitHub App: a fresh installation token for every git / gh call (github-app-token caches it for its
# hour). No static token in the environment.
: "${GITHUB_APP_ID:?GITHUB_APP_ID is required: the GitHub App of the worker, secret youtube-pip-dev-worker}"
unset GITHUB_TOKEN GH_TOKEN
git config --global credential.https://github.com.helper \
  '!f() { [ "$1" = get ] || exit 0; echo username=x-access-token; echo "password=$(github-app-token)"; }; f'
github-app-token >/dev/null

exec node /opt/dev-worker/worker.mjs
