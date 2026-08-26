#!/usr/bin/env bash
#
# Sync the Cognovis fork with the atomic-ehr/codegen baseline.
#
# `main` is the only Cognovis integration branch and it is published, so a sync
# merges `upstream/main` into `main`: the history of the published branch is
# never rewritten and every push here is plain (COGNOVIS.md, "Branch topology").
# This script is dry-run by default: it reports what a sync would do and
# changes nothing.
#
# Usage:
#   scripts/sync-upstream.sh                    # dry run: report only
#   scripts/sync-upstream.sh --merge            # merge, then run the gate
#   scripts/sync-upstream.sh --merge --push     # ... and publish if the gate passed
#   scripts/sync-upstream.sh [--no-fetch]       # report against already-fetched refs
#
# The gate is `apply-cognovis-overlay.sh --audit`, the focused regression tests,
# and the build. It runs after every merge, including a no-op one, and any
# failure exits non-zero without pushing. On a merge conflict the script stops
# and reports `git merge --abort` as the rollback.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

INTEGRATION_BRANCH="main"
UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="main"
PUBLISH_REMOTE="origin"
UPSTREAM_REF="${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
OVERLAY_SCRIPT="scripts/apply-cognovis-overlay.sh"

# The regression surface a bad upstream merge is most likely to break: profile
# slice accessors, field building, and the TypeScript writer.
FOCUSED_TESTS=(
    "test/unit/api/writer-generator/typescript/profile-slices.test.ts"
    "test/unit/typeschema/field-builder.test.ts"
    "test/api/write-generator/typescript.test.ts"
)

die() {
    printf 'sync-upstream: %s\n' "$1" >&2
    exit 1
}

info() {
    printf '  %s\n' "$1"
}

heading() {
    printf '\n== %s\n' "$1"
}

# --- preflight -------------------------------------------------------------

require_remote() {
    local remote="$1"
    git -C "${REPO_ROOT}" remote get-url "${remote}" >/dev/null 2>&1 ||
        die "no '${remote}' remote configured in ${REPO_ROOT}"
}

current_branch() {
    git -C "${REPO_ROOT}" symbolic-ref --quiet --short HEAD || printf '(detached)'
}

preflight() {
    git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1 ||
        die "not a git checkout: ${REPO_ROOT}"
    require_remote "${UPSTREAM_REMOTE}"
    test -f "${REPO_ROOT}/${OVERLAY_SCRIPT}" ||
        die "missing ${OVERLAY_SCRIPT}; the overlay audit is part of the sync gate"
}

# A merge must not mix into unrelated work, and the gate reads the working tree.
require_mergeable_checkout() {
    local branch
    branch="$(current_branch)"
    test "${branch}" = "${INTEGRATION_BRANCH}" ||
        die "refusing to merge on '${branch}': sync runs in a '${INTEGRATION_BRANCH}' checkout"
    test -z "$(git -C "${REPO_ROOT}" status --porcelain)" ||
        die "working tree is not clean; commit or stash before syncing"
}

# --- reporting -------------------------------------------------------------

fetch_upstream() {
    heading "Fetching ${UPSTREAM_REMOTE}"
    if git -C "${REPO_ROOT}" fetch "${UPSTREAM_REMOTE}"; then
        info "fetched ${UPSTREAM_REMOTE}"
    else
        die "git fetch ${UPSTREAM_REMOTE} failed"
    fi
}

# 0 when upstream/main is already an ancestor of HEAD, 1 when a merge is needed.
merge_needed() {
    ! git -C "${REPO_ROOT}" merge-base --is-ancestor "${UPSTREAM_REF}" HEAD
}

report_state() {
    local behind ahead
    git -C "${REPO_ROOT}" rev-parse --verify --quiet "${UPSTREAM_REF}" >/dev/null ||
        die "${UPSTREAM_REF} is unknown; run without --no-fetch first"

    behind="$(git -C "${REPO_ROOT}" rev-list --count "HEAD..${UPSTREAM_REF}")"
    ahead="$(git -C "${REPO_ROOT}" rev-list --count "${UPSTREAM_REF}..HEAD")"

    heading "State"
    info "checkout   : ${REPO_ROOT}"
    info "branch     : $(current_branch)"
    info "HEAD       : $(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
    info "${UPSTREAM_REF} : $(git -C "${REPO_ROOT}" rev-parse --short "${UPSTREAM_REF}")"
    info "ahead      : ${ahead} commit(s) not upstream (fork commits, see COGNOVIS.md)"
    info "behind     : ${behind} upstream commit(s) not merged"

    if merge_needed; then
        info "merge      : needed"
    else
        info "merge      : not needed (${UPSTREAM_REF} is already merged)"
    fi
}

# --- merge -----------------------------------------------------------------

merge_upstream() {
    heading "Merging ${UPSTREAM_REF} into ${INTEGRATION_BRANCH}"
    if ! merge_needed; then
        info "already up to date; nothing to merge"
        return 0
    fi

    if git -C "${REPO_ROOT}" merge --no-edit "${UPSTREAM_REF}"; then
        info "merged at $(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
        return 0
    fi

    printf '\n' >&2
    printf 'sync-upstream: the merge stopped with conflicts.\n' >&2
    printf '  Conflicted paths:\n' >&2
    git -C "${REPO_ROOT}" diff --name-only --diff-filter=U | sed 's/^/    /' >&2
    printf '\n  Resolve them by hand, then finish with:\n' >&2
    printf '    git add <path>... && git commit\n' >&2
    printf '    scripts/sync-upstream.sh --merge   # rerun to execute the gate\n' >&2
    printf '\n  To roll back and leave main untouched:\n' >&2
    printf '    git merge --abort\n' >&2
    printf '\n  Generator conflicts are pending upstream contributions, not overlay\n' >&2
    printf '  paths; resolve them in favour of the fork commit and see COGNOVIS.md.\n' >&2
    exit 1
}

# --- gate ------------------------------------------------------------------

# Every gate step runs from the repository root and fails the whole sync. `die`
# exits before push_main is ever reached, which is what keeps the push closed.
run_step() {
    local label="$1"
    shift
    printf '\n-- %s\n' "${label}"
    if ! (cd "${REPO_ROOT}" && "$@"); then
        die "gate step '${label}' failed; refusing to push. The merge is local and unpublished."
    fi
    info "${label}: OK"
}

run_gate() {
    heading "Gate"
    run_step "overlay audit" "./${OVERLAY_SCRIPT}" --audit
    run_step "focused tests" bun test "${FOCUSED_TESTS[@]}"
    run_step "build" bun run build
    printf '\n'
    info "gate passed"
}

# --- entry point -----------------------------------------------------------

push_main() {
    heading "Publishing to ${PUBLISH_REMOTE}"
    git -C "${REPO_ROOT}" push "${PUBLISH_REMOTE}" "${INTEGRATION_BRANCH}" ||
        die "push to ${PUBLISH_REMOTE} failed"
    info "pushed ${INTEGRATION_BRANCH} to ${PUBLISH_REMOTE}"
}

usage() {
    sed -n '3,21p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'
}

main() {
    local do_merge=0 do_push=0 do_fetch=1

    while test $# -gt 0; do
        case "$1" in
            --merge) do_merge=1; shift ;;
            --push) do_push=1; shift ;;
            --no-fetch) do_fetch=0; shift ;;
            -h|--help) usage; exit 0 ;;
            *) die "unknown option: $1" ;;
        esac
    done

    # A push is only ever the tail of a gated sync, never a standalone action.
    test "${do_push}" -eq 0 || test "${do_merge}" -eq 1 ||
        die "--push requires --merge: main is published only after the gate passes in the same run"

    preflight

    if test "${do_fetch}" -eq 1; then
        fetch_upstream
    else
        heading "Fetching ${UPSTREAM_REMOTE}"
        info "skipped (--no-fetch); reporting against the last fetched refs"
    fi

    report_state

    if test "${do_merge}" -eq 0; then
        heading "Dry run"
        info "no merge, no push; rerun with --merge to execute the sync"
        exit 0
    fi

    require_mergeable_checkout
    merge_upstream
    run_gate

    if test "${do_push}" -eq 1; then
        push_main
    fi

    heading "Done"
}

main "$@"
