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

# SOCI (lazy loading on Fargate, docs/DEV_WORKER.md "Start time"): the image is pushed as an image index with a SOCI
# index manifest v2, so Fargate starts the task before the big layers are pulled and fetches their files when read.
# Tools pinned with their release checksums.
SOCI_VERSION=0.16.1
SOCI_SHA256=2ad05a0430042885a7b2ab4a707a85250117dd39f41adc097e83a00a83ae4bc7
CRANE_VERSION=0.22.1
CRANE_SHA256=0ab7a1d6932a213aed964ce97666c3077fe691c8606413674a8b3e0b9ec4cda0

install_soci_tools() {
  local dir="$1"
  curl -fsSL -o "${dir}/soci.tgz" \
    "https://github.com/awslabs/soci-snapshotter/releases/download/v${SOCI_VERSION}/soci-snapshotter-${SOCI_VERSION}-linux-amd64-static.tar.gz"
  echo "${SOCI_SHA256}  ${dir}/soci.tgz" | sha256sum -c -
  tar xzf "${dir}/soci.tgz" -C "${dir}" soci
  curl -fsSL -o "${dir}/crane.tgz" \
    "https://github.com/google/go-containerregistry/releases/download/v${CRANE_VERSION}/go-containerregistry_Linux_x86_64.tar.gz"
  echo "${CRANE_SHA256}  ${dir}/crane.tgz" | sha256sum -c -
  tar xzf "${dir}/crane.tgz" -C "${dir}" crane
}

# Docker layer cache in ECR (BuildKit registry cache, tag `buildcache` of the same repository): unchanged layers
# (apt packages, npm ci) come from the cache and are not pushed again. Falls back to a plain build (no SOCI) where
# buildx is missing.
build_and_push() {
  local dockerfile="$1" context="$2"
  local cache_ref="${ECR_REGISTRY}/${ECR_REPO}:buildcache"
  if docker buildx version >/dev/null 2>&1; then
    local work
    work="$(mktemp -d)"
    install_soci_tools "${work}"
    docker buildx inspect image-cache >/dev/null 2>&1 \
      || docker buildx create --name image-cache --driver docker-container >/dev/null
    # Built into an OCI image layout archive (not pushed yet): SOCI indexes it first
    docker buildx build --builder image-cache --platform linux/amd64 --provenance=false \
      --cache-from "type=registry,ref=${cache_ref}" \
      --cache-to "type=registry,ref=${cache_ref},mode=max,image-manifest=true,oci-mediatypes=true" \
      --output "type=oci,dest=${work}/image.tar" -f "${dockerfile}" "${context}"
    # Layers over 10 MB get a zTOC (the default --min-layer-size); smaller ones are pulled whole before the start
    "${work}/soci" convert --standalone --format oci-dir "${work}/image.tar" "${work}/soci-image"
    aws ecr get-login-password --region "${AWS_REGION}" \
      | "${work}/crane" auth login "${ECR_REGISTRY}" -u AWS --password-stdin
    "${work}/crane" push "${work}/soci-image" "${IMAGE_REF}"
    rm -rf "${work}"
  else
    docker build --platform linux/amd64 -t "${IMAGE_REF}" -f "${dockerfile}" "${context}"
    docker push "${IMAGE_REF}"
  fi
}

# Context = repository root (the image contains scripts/dev-worker)
build_and_push terraform/dev-worker/Dockerfile .
echo "Pushed: ${IMAGE_REF}"
