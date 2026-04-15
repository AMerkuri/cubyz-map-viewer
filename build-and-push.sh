#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration
REGISTRY="ghcr.io"
IMAGE_NAME="${GITHUB_REPOSITORY:-}"
REQUESTED_TAG="${1:-latest}"
PLATFORMS="linux/amd64,linux/arm64"
BUILDER_NAME="cubyz-map-viewer-builder"
PACKAGE_VERSION="$(node -e "console.log(JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).version)" "$SCRIPT_DIR/package.json")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [[ -z "$IMAGE_NAME" ]]; then
    echo -e "${RED}Error: GITHUB_REPOSITORY is not set.${NC}"
    echo -e "${YELLOW}Set it to the target GitHub repository, for example:${NC}"
    echo "export GITHUB_REPOSITORY=owner/cubyz-map-viewer"
    exit 1
fi

if [[ -z "${GITHUB_ACTOR:-}" ]]; then
    echo -e "${RED}Error: GITHUB_ACTOR is not set.${NC}"
    echo -e "${YELLOW}Set it to your GitHub username before running this script.${NC}"
    exit 1
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    echo -e "${RED}Error: GITHUB_TOKEN is not set.${NC}"
    echo -e "${YELLOW}Create a GitHub token with package write access and export it before running this script.${NC}"
    exit 1
fi

IMAGE_NAME="${IMAGE_NAME,,}"

TAGS=("${REQUESTED_TAG}")
if [[ "$REQUESTED_TAG" == "latest" ]]; then
    TAGS=("latest" "$PACKAGE_VERSION")
fi

IMAGE_REF_BASE="${REGISTRY}/${IMAGE_NAME}"
TAG_ARGS=()
for tag in "${TAGS[@]}"; do
    TAG_ARGS+=(--tag "${IMAGE_REF_BASE}:${tag}")
done

echo -e "${GREEN}=== Building and pushing multi-arch image ===${NC}"
echo "Registry: ${REGISTRY}"
echo "Image: ${IMAGE_NAME}"
echo "Requested tag: ${REQUESTED_TAG}"
echo "Published tags: ${TAGS[*]}"
echo "Package version: ${PACKAGE_VERSION}"
echo "Platforms: ${PLATFORMS}"
echo ""

if ! printf '%s\n' "$GITHUB_TOKEN" | docker login "$REGISTRY" -u "$GITHUB_ACTOR" --password-stdin >/dev/null 2>&1; then
    echo -e "${RED}Error: Docker login to ${REGISTRY} failed.${NC}"
    echo -e "${YELLOW}Check GITHUB_TOKEN, GITHUB_ACTOR, and your package permissions.${NC}"
    exit 1
fi

if ! docker buildx inspect "$BUILDER_NAME" >/dev/null 2>&1; then
    echo -e "${GREEN}Creating buildx builder...${NC}"
    docker buildx create --name "$BUILDER_NAME" --driver docker-container --use >/dev/null
    docker buildx inspect --bootstrap >/dev/null
else
    echo -e "${GREEN}Using existing buildx builder...${NC}"
    docker buildx use "$BUILDER_NAME" >/dev/null
fi

echo -e "${GREEN}Building and pushing images...${NC}"
docker buildx build \
    --platform "$PLATFORMS" \
    "${TAG_ARGS[@]}" \
    --push \
    "$SCRIPT_DIR"

echo -e "${GREEN}=== Build and push completed successfully! ===${NC}"
for tag in "${TAGS[@]}"; do
    echo -e "Image: ${IMAGE_REF_BASE}:${tag}"
done
echo -e "Platforms: ${PLATFORMS}"
