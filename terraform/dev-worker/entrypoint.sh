#!/usr/bin/env bash
# Dev worker entrypoint (docs/DEV_WORKER.md): runs as devworker, which holds the secrets; Claude Code runs as
# CLAUDE_USER without them (isolation.mjs). exec keeps the worker PID 1, so ECS StopTask's SIGTERM reaches it (it
# saves the session to S3 and reports in the chat).
set -euo pipefail

# The worker's own GitHub App: a fresh installation token for every git / gh call (github-app-token caches it for its
# hour; Claude's user gets tokens from the worker's broker socket). No static token in the environment.
: "${GITHUB_APP_ID:?GITHUB_APP_ID is required: the GitHub App of the worker, secret youtube-pip-dev-worker}"
unset GITHUB_TOKEN GH_TOKEN
github-app-token >/dev/null

# Claude's git identity, in its own home (the credential helper is set in the image)
as_claude() {
  sudo -n -u "${CLAUDE_USER:?}" -- /usr/bin/env -i HOME="${CLAUDE_HOME:?}" PATH="$PATH" "$@"
}
as_claude git config --global user.name "${GIT_USER_NAME:-Dev worker}"
as_claude git config --global user.email "${GIT_USER_EMAIL:-dev-worker@users.noreply.github.com}"

exec node /opt/dev-worker/worker.mjs
