#!/usr/bin/env bash
# Scheduled tasks of the owner (docs/DEV_WORKER.md, "Scheduled tasks"): the dev-bot Lambda checks state/scheduled/
# every minute and sends a due task to the worker as the owner's message (starting the worker when it sleeps).
#
#   schedule add "<YYYY-MM-DD HH:MM>" "<task>" [time zone]   time in the owner's working time zone (state/meta.json)
#                                                             unless a zone is given; one-off, in the future
#   schedule list                                             id, due time (UTC and local), task
#   schedule cancel <id>
set -euo pipefail

PREFIX="s3://${STATE_BUCKET:?}/state/scheduled"

owner_zone() {
  aws s3 cp "s3://${STATE_BUCKET}/state/meta.json" - 2>/dev/null | jq -r '.timeZone // empty' 2>/dev/null || true
}

case "${1:-}" in
  add)
    when="${2:?time, e.g. \"2026-11-10 18:00\"}"
    text="${3:?task text}"
    zone="${4:-$(owner_zone)}"
    zone="${zone:-Europe/Warsaw}"
    due="$(TZ=UTC date -d "TZ=\"${zone}\" ${when}" +%Y-%m-%dT%H:%M:%SZ)"
    if [[ "$(date -u -d "${due}" +%s)" -le "$(date -u +%s)" ]]; then
      echo "schedule: ${when} (${zone}) = ${due} is not in the future" >&2
      exit 1
    fi
    id="$(date -u +%Y%m%dT%H%M%S)-${RANDOM}"
    jq -n --arg id "${id}" --arg due "${due}" --arg zone "${zone}" --arg text "${text}" \
      --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      '{id: $id, dueAt: $due, timeZone: $zone, text: $text, createdAt: $created}' |
      aws s3 cp - "${PREFIX}/${id}.json" --quiet
    echo "scheduled ${id}: ${due} UTC = ${when} ${zone}"
    ;;
  list)
    for key in $(aws s3 ls "${PREFIX}/" | awk '{print $4}'); do
      aws s3 cp "${PREFIX}/${key}" - |
        jq -r '"\(.id)\t\(.dueAt)\t\(.timeZone)\t\(.text | gsub("\n"; " ") | .[0:200])"'
    done
    ;;
  cancel)
    aws s3 rm "${PREFIX}/${2:?id}.json" --quiet
    echo "cancelled ${2}"
    ;;
  *)
    sed -n '4,8p' "$0"
    exit 2
    ;;
esac
