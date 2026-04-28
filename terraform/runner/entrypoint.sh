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
RUNNER_IDLE_TIMEOUT_SECONDS="${RUNNER_IDLE_TIMEOUT_SECONDS:-600}"

cleanup() {
  echo "Removing runner registration..."
  ./config.sh remove --token "${RUNNER_TOKEN}" || true
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
if [[ "${RUNNER_IDLE_TIMEOUT_SECONDS}" =~ ^[0-9]+$ ]] && [[ "${RUNNER_IDLE_TIMEOUT_SECONDS}" -gt 0 ]]; then
  echo "Runner idle timeout is set to ${RUNNER_IDLE_TIMEOUT_SECONDS}s."
  ./run.sh &
  runner_pid=$!

  (
    sleep "${RUNNER_IDLE_TIMEOUT_SECONDS}"
    if kill -0 "${runner_pid}" 2>/dev/null; then
      echo "Runner idle timeout reached (${RUNNER_IDLE_TIMEOUT_SECONDS}s). Trying cleanup and waiting for runner to finish."
      cleanup
    fi
  ) &
  watchdog_pid=$!

  set +e
  wait "${runner_pid}"
  run_exit_code=$?
  set -e

  kill "${watchdog_pid}" 2>/dev/null || true
  wait "${watchdog_pid}" 2>/dev/null || true
  exit "${run_exit_code}"
fi

echo "Runner idle timeout disabled. Running without watchdog."
exec ./run.sh
