#!/usr/bin/env bash
# CodeBuild tf-apply (terraform/dev_worker_ops.tf): applies the plan of a tf-plan run the owner approved (bundle
# unpacked to /tmp/repo/terraform by the buildspec) and reports the result to the owner's chat.
set -euo pipefail
cd /tmp/repo/terraform
terraform init -input=false -no-color

set +e
terraform apply -input=false -no-color tfplan 2>&1 | tee apply.txt
code=${PIPESTATUS[0]}
set -e
python3 gate/report.py apply "$code" apply.txt
exit "$code"
