#!/usr/bin/env bash
# Builds the Python dependencies layer of the Lambdas (terraform/lambda/layer/python, zipped by Terraform).
#
# Reproducible: pinned wheels for Lambda's platform (python3.12, x86_64, glibc of Amazon Linux 2023), no bytecode, so
# every machine (CodeBuild tf-plan, the dev worker, a laptop) gets the same files and Terraform the same layer hash.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf layer/python
mkdir -p layer/python
touch layer/python/.gitkeep
python3 -m pip install --quiet --disable-pip-version-check --no-cache-dir --no-compile --no-deps \
  --only-binary=:all: \
  --platform manylinux_2_34_x86_64 --platform manylinux_2_28_x86_64 --platform manylinux2014_x86_64 --python-version 3.12 --implementation cp \
  --target layer/python -r requirements.txt
# Install records differ between pip versions and are not needed at runtime
find layer/python -path '*.dist-info/*' \
  \( -name RECORD -o -name REQUESTED -o -name INSTALLER -o -name direct_url.json \) -delete
