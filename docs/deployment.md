# Deployment Guide

## Overview

This project ships a single container image that serves the built client, HTTP API, and WebSocket server from one Node.js process.

Use `scripts/build-and-push.sh` to publish a multi-architecture image to GitHub Container Registry (`ghcr.io`).

## Prerequisites

- Docker with `buildx` support
- permission to publish packages for the target GitHub repository
- a local checkout of this repository with `package.json` present

The script publishes these platforms:

- `linux/amd64`
- `linux/arm64`

## Required Environment Variables

Set these variables before running `scripts/build-and-push.sh` locally:

- `GITHUB_REPOSITORY`: target image name in `owner/repo` form
- `GITHUB_ACTOR`: your GitHub username
- `GITHUB_TOKEN`: GitHub token used for `docker login ghcr.io`

Example:

```bash
export GITHUB_REPOSITORY=owner/cubyz-map-viewer
export GITHUB_ACTOR=your-github-username
export GITHUB_TOKEN=your-token
```

If you run the script inside GitHub Actions, `GITHUB_REPOSITORY`, `GITHUB_ACTOR`, and `GITHUB_TOKEN` are typically already available from the workflow environment.

## How To Obtain `GITHUB_TOKEN`

For local publishing, create a GitHub personal access token and export it as `GITHUB_TOKEN`.

The simplest option for GHCR publishing is a classic personal access token:

1. Open GitHub.
2. Go to `Settings`.
3. Go to `Developer settings`.
4. Open `Personal access tokens`.
5. Choose `Tokens (classic)`.
6. Create a new token.

Recommended scopes:

- `write:packages`
- `read:packages`

If the target repository belongs to an organization with SSO enabled, authorize the token for that organization as well.

## Publishing Images

Run without arguments, or pass `latest`, to publish both `latest` and the version from `package.json`:

```bash
./scripts/build-and-push.sh
./scripts/build-and-push.sh latest
```

With the current `package.json`, that publishes:

- `ghcr.io/<owner>/<repo>:latest`
- `ghcr.io/<owner>/<repo>:1.0.0`

Pass any other tag to publish only that explicit tag:

```bash
./scripts/build-and-push.sh v1.0.0-rc1
```

That publishes only:

- `ghcr.io/<owner>/<repo>:v1.0.0-rc1`

## Runtime Configuration

Publishing the image does not include world data or Cubyz assets. When you run the container, you still need to provide:

- `SAVE_PATH`: Cubyz save directory inside the container
- `CUBYZ_PATH`: Cubyz asset source inside the container
- `VOXEL_CACHE_DIR`: persistent voxel cache directory
- `LOG_DIR`: server log directory

The checked-in `compose.yml` uses these container paths:

- save data: `/data/save`
- Cubyz checkout: `/data/cubyz`
- voxel cache: `/data/cache/voxels`
- logs: `/data/logs`

## Run The Published Image

```bash
docker run --rm -p 3000:3000 \
  -v /path/to/your/save:/data/save:ro \
  -v /path/to/Cubyz:/data/cubyz:ro \
  -v cubyz-map-viewer-cache:/data/cache \
  -v cubyz-map-viewer-logs:/data/logs \
  ghcr.io/<owner>/<repo>:latest
```

The container listens on port `3000`.
