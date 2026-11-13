#!/usr/bin/env bash
# gh with a fresh installation token of the dev worker's GitHub App (github-app-token, docs/DEV_WORKER.md "GitHub").
# Installed as /usr/local/bin/gh, ahead of the real /usr/bin/gh. Without the App (the older fine-grained token in
# GH_TOKEN) it runs gh as is.
set -euo pipefail
if [ -n "${GITHUB_APP_ID:-}" ]; then
  GH_TOKEN="$(github-app-token)"
  export GH_TOKEN
fi
exec /usr/bin/gh "$@"
