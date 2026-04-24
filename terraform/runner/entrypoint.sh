#!/usr/bin/env bash
set -euo pipefail

cd /home/runner/actions-runner

if [[ -z "${REPO_URL:-}" || -z "${RUNNER_TOKEN:-}" || -z "${RUNNER_NAME:-}" ]]; then
  echo "REPO_URL, RUNNER_TOKEN, and RUNNER_NAME are required."
  exit 1
fi

LABELS="${LABELS:-self-hosted,fargate}"
EPHEMERAL="${EPHEMERAL:-1}"
DISABLE_AUTO_UPDATE="${DISABLE_AUTO_UPDATE:-1}"
RUNNER_WORKDIR="${RUNNER_WORKDIR:-_work}"

cleanup() {
  echo "Removing runner registration..."
  ./config.sh remove --unattended --token "${RUNNER_TOKEN}" || true
}
trap cleanup EXIT

CONFIG_ARGS=(
  --url "${REPO_URL}"
  --token "${RUNNER_TOKEN}"
  --name "${RUNNER_NAME}"
  --work "${RUNNER_WORKDIR}"
  --labels "${LABELS}"
  --unattended
  --replace
)

if [[ "${EPHEMERAL}" == "1" || "${EPHEMERAL}" == "true" ]]; then
  CONFIG_ARGS+=(--ephemeral)
fi

if [[ "${DISABLE_AUTO_UPDATE}" == "1" || "${DISABLE_AUTO_UPDATE}" == "true" ]]; then
  CONFIG_ARGS+=(--disableupdate)
fi

echo "Configuring runner ${RUNNER_NAME}..."
./config.sh "${CONFIG_ARGS[@]}"

echo "Starting runner..."
exec ./run.sh
