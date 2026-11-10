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

# Docker layer cache in ECR (BuildKit registry cache, tag `buildcache` of the same repository): unchanged layers
# (apt packages, npm ci) come from the cache and are not pushed again. Falls back to a plain build where buildx
# is missing.
build_and_push() {
  local dockerfile="$1" context="$2"
  local cache_ref="${ECR_REGISTRY}/${ECR_REPO}:buildcache"
  if docker buildx version >/dev/null 2>&1; then
    docker buildx inspect image-cache >/dev/null 2>&1 \
      || docker buildx create --name image-cache --driver docker-container >/dev/null
    docker buildx build --builder image-cache --platform linux/amd64 --provenance=false \
      --cache-from "type=registry,ref=${cache_ref}" \
      --cache-to "type=registry,ref=${cache_ref},mode=max,image-manifest=true,oci-mediatypes=true" \
      -t "${IMAGE_REF}" -f "${dockerfile}" --push "${context}"
  else
    docker build --platform linux/amd64 -t "${IMAGE_REF}" -f "${dockerfile}" "${context}"
    docker push "${IMAGE_REF}"
  fi
}

# Context = repository root (the image contains scripts/dev-worker)
build_and_push terraform/dev-worker/Dockerfile .
echo "Pushed: ${IMAGE_REF}"
