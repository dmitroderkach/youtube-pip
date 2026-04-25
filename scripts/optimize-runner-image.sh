#!/usr/bin/env bash
set -euo pipefail

# Builds amd64 runner image, pushes base tag, then creates and pushes SOCI-enabled tag.
# Usage:
#   scripts/optimize-runner-image.sh [base_tag]
# Example:
#   scripts/optimize-runner-image.sh latest

AWS_REGION="${AWS_REGION:-eu-central-1}"
ECR_REPO="${ECR_REPO:-youtube-pip-prod-runner}"
BASE_TAG="${1:-latest}"
SOCI_TAG="${SOCI_TAG:-${BASE_TAG}-soci}"
SOCI_VERSION="${SOCI_VERSION:-v0.13.0}"

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
BASE_IMAGE="${ECR_REGISTRY}/${ECR_REPO}:${BASE_TAG}"
SOCI_IMAGE="${ECR_REGISTRY}/${ECR_REPO}:${SOCI_TAG}"

echo "Region: ${AWS_REGION}"
echo "Repository: ${ECR_REPO}"
echo "Base image: ${BASE_IMAGE}"
echo "SOCI image: ${SOCI_IMAGE}"

echo "Logging in to ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

echo "Building amd64 runner image..."
docker build --platform linux/amd64 -t "${BASE_IMAGE}" -f terraform/runner/Dockerfile terraform/runner

echo "Pushing base image..."
docker push "${BASE_IMAGE}"

ECR_PASS="$(aws ecr get-login-password --region "${AWS_REGION}")"
TMP_ROOT="$(mktemp -d)"
SRC_DIR="${TMP_ROOT}/src"
OUT_DIR="${TMP_ROOT}/out"
CONVERT_OUT_DIR="${OUT_DIR}/converted"
mkdir -p "${SRC_DIR}" "${CONVERT_OUT_DIR}"
trap 'rm -rf "${TMP_ROOT}"' EXIT

echo "Converting base image to SOCI-enabled image..."
docker run --rm --platform linux/amd64 \
  -e ECR_PASS="${ECR_PASS}" \
  -e SRC_IMAGE="${BASE_IMAGE}" \
  -e DST_IMAGE="${SOCI_IMAGE}" \
  -e SOCI_VERSION="${SOCI_VERSION}" \
  -v "${SRC_DIR}:/work/soci-src" \
  -v "${OUT_DIR}:/work/soci-out" \
  ubuntu:24.04 bash -lc '
    set -euo pipefail
    apt-get update >/dev/null
    apt-get install -y --no-install-recommends curl ca-certificates skopeo >/dev/null
    curl -fsSL -o /tmp/soci.tgz "https://github.com/awslabs/soci-snapshotter/releases/download/${SOCI_VERSION}/soci-snapshotter-${SOCI_VERSION#v}-linux-amd64-static.tar.gz"
    tar -xzf /tmp/soci.tgz -C /usr/local/bin soci
    chmod +x /usr/local/bin/soci
    skopeo copy --src-creds "AWS:${ECR_PASS}" "docker://${SRC_IMAGE}" "oci:/work/soci-src:latest"
    soci convert --standalone --format oci-dir /work/soci-src /work/soci-out/converted
    skopeo copy --dest-creds "AWS:${ECR_PASS}" "oci:/work/soci-out/converted" "docker://${DST_IMAGE}"
  '

echo "Done. Current ECR metadata:"
aws ecr describe-images \
  --repository-name "${ECR_REPO}" \
  --image-ids imageTag="${BASE_TAG}" imageTag="${SOCI_TAG}" \
  --region "${AWS_REGION}" \
  --query 'imageDetails[].{tags:imageTags,digest:imageDigest,sizeBytes:imageSizeInBytes,pushedAt:imagePushedAt}' \
  --output table
