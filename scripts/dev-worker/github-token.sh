#!/usr/bin/env bash
# Prints a GitHub installation token of the worker's App (docs/DEV_WORKER.md, "GitHub"): for the git credential helper
# and the gh wrapper. The worker process (it holds the App's key) mints it itself; Claude's user asks the worker's
# token broker on a Unix socket (worker.mjs startGithubBroker) and never sees the key.
set -euo pipefail
if [ -n "${GITHUB_APP_ID:-}" ]; then
  exec github-app-token
fi
exec curl -fsS --max-time 30 --unix-socket "${GITHUB_BROKER_SOCKET:-/srv/dev-worker/github.sock}" http://localhost/token
