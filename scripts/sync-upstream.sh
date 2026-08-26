#!/usr/bin/env bash
#
# Sync the Cognovis fork with the atomic-ehr/codegen baseline.
#
# `main` is the only Cognovis integration branch and it is published, so a sync
# merges `upstream/main` into `main`: the history of the published branch is
# never rewritten and every push here is plain (COGNOVIS.md, "Branch topology").
#
# This script is dry-run by default: it reports what a sync would do and
# changes nothing in the checkout. The fetch it performs is real, though -- it
# moves the `upstream/*` remote-tracking refs that every worktree of this
# repository shares, so pass --no-fetch when reporting from a task worktree.
# The report is always about `main`, whichever branch is checked out.
#
# Usage:
#   scripts/sync-upstream.sh                    # dry run: report only
#   scripts/sync-upstream.sh --merge            # merge, then run the gate
#   scripts/sync-upstream.sh --merge --push     # ... and publish if the gate passed
#   scripts/sync-upstream.sh [--no-fetch]       # report against already-fetched refs
#
# The gate is `apply-cognovis-overlay.sh --audit`, the focused regression tests,
# and the build. It runs after every merge, including a no-op one, and any
# failure -- including a focused test file that no longer exists -- exits
# non-zero without pushing. On a merge conflict the script stops and reports
# `git merge --abort` as the rollback.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

INTEGRATION_BRANCH="main"
UPSTREAM_REMOTE="upstream"
UPSTREAM_BRANCH="main"
PUBLISH_REMOTE="origin"
UPSTREAM_REF="${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
INTEGRATION_REF="refs/heads/${INTEGRATION_BRANCH}"
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
    # The report is about the integration branch, never about whatever branch
    # happens to be checked out, so that ref has to exist.
    git -C "${REPO_ROOT}" rev-parse --verify --quiet "${INTEGRATION_REF}" >/dev/null ||
        die "no ${INTEGRATION_REF} in ${REPO_ROOT}; the sync report is always about '${INTEGRATION_BRANCH}'"
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

# 0 when upstream/main is already an ancestor of the integration branch, 1 when
# a merge is needed. Asked about refs/heads/main and not about HEAD: the answer
# must not change with the branch the report is run from. `--merge` additionally
# requires HEAD to be that branch, so in the merge path the two coincide.
merge_needed() {
    ! git -C "${REPO_ROOT}" merge-base --is-ancestor "${UPSTREAM_REF}" "${INTEGRATION_REF}"
}

report_state() {
    local behind ahead
    git -C "${REPO_ROOT}" rev-parse --verify --quiet "${UPSTREAM_REF}" >/dev/null ||
        die "${UPSTREAM_REF} is unknown; run without --no-fetch first"

    behind="$(git -C "${REPO_ROOT}" rev-list --count "${INTEGRATION_REF}..${UPSTREAM_REF}")"
    ahead="$(git -C "${REPO_ROOT}" rev-list --count "${UPSTREAM_REF}..${INTEGRATION_REF}")"

    heading "State: ${INTEGRATION_BRANCH} vs ${UPSTREAM_REF}"
    info "checkout      : ${REPO_ROOT}"
    info "checked out   : $(current_branch) (the report below is about '${INTEGRATION_BRANCH}')"
    info "${INTEGRATION_BRANCH}          : $(git -C "${REPO_ROOT}" rev-parse --short "${INTEGRATION_REF}")"
    info "${UPSTREAM_REF} : $(git -C "${REPO_ROOT}" rev-parse --short "${UPSTREAM_REF}")"
    info "ahead         : ${ahead} commit(s) on ${INTEGRATION_BRANCH} not upstream (fork commits, see COGNOVIS.md)"
    info "behind        : ${behind} upstream commit(s) not merged into ${INTEGRATION_BRANCH}"

    if merge_needed; then
        info "merge         : needed"
    else
        info "merge         : not needed (${UPSTREAM_REF} is already merged)"
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

# `bun test a-real-file a-missing-file` exits 0 after running only the real one,
# so a focused test that upstream renamed or deleted would drop out of the gate
# silently. Existence is checked here instead, before bun is ever invoked.
require_focused_tests() {
    local file missing=0
    for file in "${FOCUSED_TESTS[@]}"; do
        if ! test -f "${REPO_ROOT}/${file}"; then
            printf 'sync-upstream: focused test file is missing: %s\n' "${file}" >&2
            missing=$((missing + 1))
        fi
    done
    test "${missing}" -eq 0 ||
        die "${missing} focused test file(s) named by the gate do not exist; upstream moved or removed them, so update FOCUSED_TESTS deliberately instead of syncing past a gate that silently shrank"
}

run_gate() {
    heading "Gate"
    require_focused_tests
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
    sed -n '3,25p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'
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
