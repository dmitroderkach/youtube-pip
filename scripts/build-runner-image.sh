#!/usr/bin/env bash
set -euo pipefail

# Build and push runner image to ECR.
#
# Usage:
#   scripts/build-runner-image.sh [tag]
#
# Examples:
#   scripts/build-runner-image.sh latest
#   ECR_REPO=youtube-pip-prod-runner scripts/build-runner-image.sh playwright

AWS_REGION="${AWS_REGION:-eu-central-1}"
ECR_REPO="${ECR_REPO:-youtube-pip-prod-runner}"
IMAGE_TAG="${1:-latest}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required."
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_REF="${ECR_REGISTRY}/${ECR_REPO}:${IMAGE_TAG}"

echo "Region: ${AWS_REGION}"
echo "Repository: ${ECR_REPO}"
echo "Image: ${IMAGE_REF}"

echo "Logging in to ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

echo "Building amd64 runner image..."
docker build --platform linux/amd64 -t "${IMAGE_REF}" -f terraform/runner/Dockerfile terraform/runner

echo "Pushing image..."
docker push "${IMAGE_REF}"

DIGEST="$(aws ecr describe-images \
  --region "${AWS_REGION}" \
  --repository-name "${ECR_REPO}" \
  --image-ids imageTag="${IMAGE_TAG}" \
  --query 'imageDetails[0].imageDigest' \
  --output text)"

echo "Done."
echo "Pushed: ${IMAGE_REF}"
echo "Digest: ${DIGEST}"
