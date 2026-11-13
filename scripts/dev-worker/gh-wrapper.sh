#!/usr/bin/env bash
# gh with a fresh installation token of the dev worker's GitHub App (github-token, docs/DEV_WORKER.md "Claude Code as a separate user").
# Installed as /usr/local/bin/gh, ahead of the real /usr/bin/gh.
set -euo pipefail
GH_TOKEN="$(github-token)"
export GH_TOKEN
exec /usr/bin/gh "$@"
