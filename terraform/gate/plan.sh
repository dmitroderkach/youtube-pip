#!/usr/bin/env bash
# CodeBuild tf-plan (terraform/dev_worker_ops.tf): plans main for the dev worker's gated apply. The saved plan and the
# files it was made with (Lambda zips, the dependencies layer) go to the ops bucket as tf-runs/<run>/bundle.tgz, so
# tf-apply applies exactly what the owner saw; report.py sends the plan to the owner's chat with ✅ Apply / 🚫.
set -euo pipefail
cd /tmp/repo
export SHA SUBJECT RUN_ID
SHA="$(git rev-parse HEAD)"
SUBJECT="$(git log -1 --format=%s)"
RUN_ID="${CODEBUILD_BUILD_ID##*:}"

bash terraform/lambda/build-layer.sh
cd terraform
terraform init -input=false -no-color

set +e
terraform plan -input=false -no-color -detailed-exitcode -out=tfplan 2>&1 | tee plan-log.txt
code=${PIPESTATUS[0]}
set -e
if [ "$code" = 1 ]; then
  python3 gate/report.py plan-failed plan-log.txt
  exit 1
fi

terraform show -no-color tfplan > plan.txt
terraform show -json tfplan > plan.json
aws s3 cp --quiet plan.txt "s3://$OPS_BUCKET/tf-runs/$RUN_ID/plan.txt"
if [ "$code" = 2 ]; then
  printf '{"sha": "%s", "run_id": "%s"}\n' "$SHA" "$RUN_ID" > gate-run.json
  tar czf /tmp/bundle.tgz --exclude=./.terraform -C /tmp/repo/terraform .
  aws s3 cp --quiet /tmp/bundle.tgz "s3://$OPS_BUCKET/tf-runs/$RUN_ID/bundle.tgz"
fi
# Last: the gate record it writes makes the ✅ valid, and the bundle is in place by then
python3 gate/report.py plan plan.json
