#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_TYPE="auto"
DRY_RUN=false
DEFAULT_BRANCH="master"

usage() {
    cat <<'EOF'
Usage: ./scripts/release.sh [patch|minor|major|auto] [--dry-run]

Runs preflight checks, generates CHANGELOG.md from conventional commits,
creates the release commit and tag, pushes master with follow-tags, and
publishes the Docker image via scripts/build-and-push.sh.
EOF
}

parse_args() {
    local release_type_set=false

    for arg in "$@"; do
        case "$arg" in
            auto|patch|minor|major)
                if [[ "$release_type_set" == true ]]; then
                    printf 'Error: specify only one release type.\n' >&2
                    exit 1
                fi

                RELEASE_TYPE="$arg"
                release_type_set=true
                ;;
            --dry-run)
                DRY_RUN=true
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                usage >&2
                exit 1
                ;;
        esac
    done
}

run_release() {
    local release_args=()

    if [[ "$RELEASE_TYPE" != "auto" ]]; then
        release_args+=(--release-as "$RELEASE_TYPE")
    fi

    if [[ "$DRY_RUN" == true ]]; then
        release_args+=(--dry-run)
    fi

    if [[ ${#release_args[@]} -eq 0 ]]; then
        npm --prefix "$REPO_ROOT" exec commit-and-tag-version
        return
    fi

    npm --prefix "$REPO_ROOT" exec commit-and-tag-version -- "${release_args[@]}"
}

run_post_release() {
    if [[ "$DRY_RUN" == true ]]; then
        printf 'Dry run: skipping publish steps.\n'
        printf 'Would run: git push origin %s --follow-tags\n' "$DEFAULT_BRANCH"
        printf 'Would run: ./scripts/build-and-push.sh latest\n'
        return
    fi

    git -C "$REPO_ROOT" push origin "$DEFAULT_BRANCH" --follow-tags
    "$REPO_ROOT/scripts/build-and-push.sh" latest
}

require_command() {
    local command_name="$1"

    if ! command -v "$command_name" >/dev/null 2>&1; then
        printf 'Error: required command not found: %s\n' "$command_name" >&2
        exit 1
    fi
}

ensure_clean_worktree() {
    if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
        printf 'Error: git worktree must be clean before releasing.\n' >&2
        exit 1
    fi
}

ensure_branch() {
    local current_branch
    current_branch="$(git -C "$REPO_ROOT" branch --show-current)"

    if [[ "$current_branch" != "$DEFAULT_BRANCH" ]]; then
        printf 'Error: releases must be created from %s (current: %s).\n' "$DEFAULT_BRANCH" "$current_branch" >&2
        exit 1
    fi
}

ensure_origin_remote() {
    if ! git -C "$REPO_ROOT" remote get-url origin >/dev/null 2>&1; then
        printf 'Error: git remote "origin" is required for release publishing.\n' >&2
        exit 1
    fi
}

ensure_release_type() {
    case "$RELEASE_TYPE" in
        auto|patch|minor|major)
            ;;
        *)
            usage >&2
            exit 1
            ;;
    esac
}

ensure_required_environment() {
    if [[ "$DRY_RUN" == true ]]; then
        return
    fi

    if [[ -z "${GITHUB_TOKEN:-}" ]]; then
        printf 'Error: GITHUB_TOKEN must be set before running a release.\n' >&2
        exit 1
    fi
}

main() {
    parse_args "$@"
    ensure_release_type
    require_command git
    require_command npm
    require_command docker
    ensure_origin_remote
    ensure_clean_worktree
    ensure_branch
    ensure_required_environment

    npm --prefix "$REPO_ROOT" run check
    npm --prefix "$REPO_ROOT" run check:knip
    npm --prefix "$REPO_ROOT" run typecheck
    run_release
    run_post_release
}

main "$@"
