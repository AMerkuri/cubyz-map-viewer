# Deployment Guide

## Overview

This document covers image publishing and deployment-specific details that are not already documented in `README.md`.

For standard Docker and Compose runtime setup, published-image usage, and troubleshooting, use the `README.md` deployment section first.

Use `scripts/build-and-push.sh` to publish a multi-architecture image to GitHub Container Registry (`ghcr.io`). For the full release workflow that also updates `CHANGELOG.md`, creates tags, pushes `master`, and publishes the matching image, see `docs/release.md`.

## Prerequisites

- Docker with `buildx` support
- permission to publish packages for the target GitHub repository
- a local checkout of this repository with `package.json` present

The script publishes these platforms:

- `linux/amd64`
- `linux/arm64`

## Required Environment Variables

Set these variables before running `scripts/build-and-push.sh` locally:

- `GITHUB_TOKEN`: GitHub token used for `docker login ghcr.io`

Optional overrides:

- `GITHUB_REPOSITORY`: target image name in `owner/repo` form
- `GITHUB_ACTOR`: GitHub username used for `docker login ghcr.io`

If `GITHUB_REPOSITORY` is unset, the script tries to derive it from the `origin` remote. If `GITHUB_ACTOR` is unset, the script derives it from the owner part of that same GitHub remote. If neither source produces a usable value, the script stops before building.

Example:

```bash
export GITHUB_REPOSITORY=owner/cubyz-map-viewer
export GITHUB_ACTOR=your-github-username
export GITHUB_TOKEN=your-token
```

The script rejects invalid `GITHUB_REPOSITORY` values such as `cubyz-map-viewer` without the owner prefix.

If you run the script in GitHub Actions, `GITHUB_REPOSITORY`, `GITHUB_ACTOR`, and `GITHUB_TOKEN` are typically already available in the workflow environment.

For personal repositories that use a matching personal access token, you can often set only `GITHUB_TOKEN` and let the script infer the rest from `origin`.

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

If the target repository belongs to an organization with SSO enabled, authorize the token for that organization.

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

## Published Image Reference

`compose.yml` uses this published image:

```bash
ghcr.io/amerkuri/cubyz-map-viewer:latest
```

For container paths, runtime environment variables, Compose commands, and direct `docker run` examples, see `README.md`.
