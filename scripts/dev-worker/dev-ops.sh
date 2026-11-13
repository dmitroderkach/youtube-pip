#!/usr/bin/env bash
# dev-ops (docs/DEV_WORKER.md, "Infrastructure and images"; terraform/dev_worker_ops.tf): Terraform plans of main and
# Docker images for the dev worker, which itself only reads AWS. A terraform apply and a :latest image go through the
# owner's ✅ in Telegram: the message with the button comes from tf-plan / the dev-ops Lambda, never from the worker.
set -euo pipefail

: "${DEV_OPS_FUNCTION:?DEV_OPS_FUNCTION is not set (dev worker task definition)}"
WAIT_SECONDS=$((45 * 60))

usage() {
  cat <<'EOF'
Usage:
  dev-ops plan                          terraform plan of main in CodeBuild (tf-plan), printed here; the owner gets it
                                        in Telegram with ✅ Apply, and tf-apply applies exactly that plan on ✅
  dev-ops build <runner|dev-worker> [ref]
                                        build the image from a branch or commit (default main) into the candidates
                                        repository (neither CI nor the worker runs it); waits, prints the image
  dev-ops publish <runner|dev-worker>   ask the owner to publish :latest built from the current main commit (✅ in
                                        Telegram); the result comes to the chat
  dev-ops telegram                      ask the owner to set the bot up from the current main commit
                                        (scripts/dev-worker/setup-telegram.mjs: webhook, command menu; ✅ in Telegram)
  dev-ops merge <pr>                    ask the owner to squash-merge the PR into main at its current head (✅ in
                                        Telegram; the request lists files, +/−, sensitive paths, checks); github-gate
                                        merges with the gate App only that commit and reports to the chat
  dev-ops release                       ask the owner to release the package.json version of the current main commit
                                        (✅ in Telegram); github-gate creates the tag, release.yml publishes
  dev-ops status <build id>             status of a build and the end of its log
  dev-ops runs                          latest builds of the dev-ops CodeBuild projects
EOF
}

invoke() {
  local out
  out="$(mktemp)"
  aws lambda invoke --function-name "$DEV_OPS_FUNCTION" --cli-binary-format raw-in-base64-out \
    --payload "$1" "$out" >/dev/null
  if jq -e '.error' "$out" >/dev/null; then
    echo "dev-ops: $(jq -r '.error' "$out")" >&2
    rm -f "$out"
    exit 1
  fi
  cat "$out"
  rm -f "$out"
}

build_field() {
  aws codebuild batch-get-builds --ids "$1" --query "builds[0].$2" --output text
}

log_tail() {
  local group stream
  group="$(build_field "$1" logs.groupName)"
  stream="$(build_field "$1" logs.streamName)"
  if [ "$stream" = "None" ]; then
    echo "(no log yet)"
    return
  fi
  aws logs get-log-events --log-group-name "$group" --log-stream-name "$stream" --no-start-from-head \
    --limit "${2:-40}" --query 'events[].message' --output text | tr '\t' '\n' | sed '/^$/d'
}

wait_build() {
  local id="$1" status waited=0
  while :; do
    status="$(build_field "$id" buildStatus)"
    [ "$status" != "IN_PROGRESS" ] && break
    if [ "$waited" -ge "$WAIT_SECONDS" ]; then
      echo "Still running after $((WAIT_SECONDS / 60)) min: dev-ops status $id" >&2
      return 1
    fi
    sleep 15
    waited=$((waited + 15))
  done
  echo "$id: $status"
  [ "$status" = "SUCCEEDED" ]
}

image_arg() {
  case "${1:-}" in
    runner | dev-worker) ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

case "${1:-}" in
  plan)
    response="$(invoke '{"action":"plan"}')"
    id="$(jq -r .build_id <<<"$response")"
    run="$(jq -r .run_id <<<"$response")"
    echo "tf-plan started: $id"
    if ! wait_build "$id"; then
      log_tail "$id" 60
      exit 1
    fi
    if aws s3 cp --quiet "s3://$OPS_BUCKET/tf-runs/$run/plan.txt" - 2>/dev/null; then
      echo
      echo "The owner got this plan in Telegram; it is applied (tf-apply) only when they press ✅. Check: dev-ops runs"
    else
      log_tail "$id" 60
    fi
    ;;
  build)
    image_arg "${2:-}"
    payload="$(jq -cn --arg image "$2" --arg ref "${3:-main}" '{action: "build", image: $image, ref: $ref}')"
    response="$(invoke "$payload")"
    id="$(jq -r .build_id <<<"$response")"
    echo "image-build started: $id → $(jq -r .image_uri <<<"$response")"
    if wait_build "$id"; then
      echo "Pushed: $(jq -r .image_uri <<<"$response")"
    else
      log_tail "$id" 60
      exit 1
    fi
    ;;
  publish)
    image_arg "${2:-}"
    response="$(invoke "$(jq -cn --arg image "$2" '{action: "publish", image: $image}')")"
    echo "Asked the owner in Telegram: publish $2:latest from main@$(jq -r '.sha[0:7]' <<<"$response")." \
      "On ✅ image-publish builds it and reports to the chat; follow it with: dev-ops runs"
    ;;
  telegram)
    response="$(invoke '{"action":"telegram"}')"
    echo "Asked the owner in Telegram: set the bot up from main@$(jq -r '.sha[0:7]' <<<"$response")" \
      "($(jq -r .commands <<<"$response") menu commands). On ✅ telegram-setup runs and reports to the chat."
    ;;
  merge)
    [[ "${2:-}" =~ ^[0-9]+$ ]] || {
      usage >&2
      exit 2
    }
    response="$(invoke "$(jq -cn --argjson pr "$2" '{action: "merge", pr: $pr}')")"
    echo "Asked the owner in Telegram: merge PR #$2 at $(jq -r '.sha[0:7]' <<<"$response")" \
      "(checks $(jq -r .checks <<<"$response"), $(jq -r .sensitive <<<"$response") sensitive files)." \
      "On ✅ github-gate merges exactly that commit and reports to the chat; a later push to the branch voids it."
    ;;
  release)
    response="$(invoke '{"action":"release"}')"
    echo "Asked the owner in Telegram: release v$(jq -r .version <<<"$response") from main@$(jq -r '.sha[0:7]' <<<"$response")." \
      "On ✅ github-gate creates the tag; release.yml publishes the release."
    ;;
  status)
    [ -n "${2:-}" ] || {
      usage >&2
      exit 2
    }
    aws codebuild batch-get-builds --ids "$2" \
      --query 'builds[0].[projectName, buildStatus, startTime, endTime]' --output text
    log_tail "$2" 40
    ;;
  runs)
    IFS=, read -ra projects <<<"${DEV_OPS_PROJECTS:?DEV_OPS_PROJECTS is not set}"
    for project in "${projects[@]}"; do
      ids="$(aws codebuild list-builds-for-project --project-name "$project" --max-items 3 \
        --query 'ids' --output text | tr '\t' ' ' | sed 's/None//')"
      [ -z "${ids// /}" ] && continue
      # shellcheck disable=SC2086
      aws codebuild batch-get-builds --ids $ids \
        --query 'builds[].[id, buildStatus, startTime, join(`,`, environment.environmentVariables[?name==`RUN_ID` || name==`IMAGE` || name==`REF` || name==`ACTION` || name==`PR` || name==`VERSION` || name==`SHA`].value)]' \
        --output text
    done
    ;;
  *)
    usage
    [ -z "${1:-}" ] || [ "$1" = "-h" ] || [ "$1" = "--help" ] || exit 2
    ;;
esac
