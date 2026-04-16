# Release Guide

## Overview

Release automation uses conventional commits plus `commit-and-tag-version` to update `CHANGELOG.md`, bump the package version, create the release commit, and create the git tag.

The release workflow lives in `scripts/release.sh` and is exposed through npm scripts in `package.json`.

## Prerequisites

- a clean git worktree
- current branch is `master`
- `git`, `npm`, and `docker` installed locally
- `GITHUB_TOKEN` exported with GitHub Container Registry package write access for a real release

Optional overrides:

- `GITHUB_ACTOR`: defaults to the owner from the `origin` GitHub remote
- `GITHUB_REPOSITORY`: defaults to the repository resolved from the `origin` GitHub remote

For the lower-level container publishing script details, see `docs/deployment.md`.

## Commands

```bash
export GITHUB_TOKEN=your-token

npm run release
npm run release -- --dry-run
npm run release -- patch
npm run release -- patch --dry-run
npm run release -- major
npm run release:dry-run
npm run release:patch
npm run release:patch:dry-run
npm run release:minor
npm run release:minor:dry-run
```

`npm run release` auto-detects the next version bump from conventional commits.

`npm run release -- <type>` supports `patch`, `minor`, `major`, and `auto`.

`--dry-run` shows the versioning and changelog commands that would run without creating a release, pushing tags, or publishing images. Dry runs do not require `GITHUB_TOKEN`.

## Release Flow

Before creating a release, `scripts/release.sh` runs these preflight checks:

- verifies `auto|patch|minor|major` input
- verifies `origin` exists
- verifies a clean git worktree
- verifies the current branch is `master`
- verifies required commands are installed
- verifies `GITHUB_TOKEN` is set
- runs `npm run check`
- runs `npm run typecheck`

After the checks pass, the script runs:

```bash
npm exec commit-and-tag-version
# or
npm exec commit-and-tag-version -- --release-as <patch|minor|major>
git push origin master --follow-tags
./scripts/build-and-push.sh latest
```

In dry-run mode, the script runs `commit-and-tag-version --dry-run` and prints the push and image publish commands instead of executing them.

Using `latest` for image publishing publishes both:

- `ghcr.io/<owner>/<repo>:latest`
- `ghcr.io/<owner>/<repo>:<package-version>`

## Changelog Tool

`commit-and-tag-version` generates `CHANGELOG.md` from conventional commits and creates the version bump commit and tag.

With auto-detection enabled, it maps conventional commits like this:

- `feat:` -> `minor`
- `fix:` -> `patch`
- `feat!:` or `BREAKING CHANGE:` -> `major`

Conventional commit examples:

```text
feat: add live voxel cache warmup
fix: handle missing surface tile gracefully
feat!: rename websocket update payload fields
```

Breaking changes can be declared with `!` in the type or with a `BREAKING CHANGE:` footer.
