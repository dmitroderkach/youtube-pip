#!/usr/bin/env bash
set -euo pipefail

# Build and push the dev worker image to ECR (docs/DEV_WORKER.md).
#
# Usage:
#   scripts/build-dev-worker-image.sh [tag]   (default: latest; the task definition uses :latest)

AWS_REGION="${AWS_REGION:-eu-central-1}"
ECR_REPO="${ECR_REPO:-youtube-pip-prod-dev-worker}"
IMAGE_TAG="${1:-latest}"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_REF="${ECR_REGISTRY}/${ECR_REPO}:${IMAGE_TAG}"

echo "Image: ${IMAGE_REF}"
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

# Context = repository root (the image contains scripts/dev-worker)
docker build --platform linux/amd64 -t "${IMAGE_REF}" -f terraform/dev-worker/Dockerfile .
docker push "${IMAGE_REF}"
echo "Pushed: ${IMAGE_REF}"
