#!/usr/bin/env bash
#
# Apply the Cognovis distribution overlay onto a clean atomic-ehr/codegen checkout.
#
# The overlay is the complete, allowlisted set of repository paths that make the
# Cognovis distribution differ from upstream. It carries package identity, the
# publish pipeline, the Bun shebang, and changelog tooling -- never generator
# behavior. The authoritative allowlist lives in the `overlay-allowlist` fenced
# block in COGNOVIS.md; this script reads that same block, so the document and
# the tool can never drift apart.
#
# Usage:
#   scripts/apply-cognovis-overlay.sh <target-dir>
#   scripts/apply-cognovis-overlay.sh --verify [--base-ref REF] [--tmp-root DIR]
#   scripts/apply-cognovis-overlay.sh --list
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ALLOWLIST_DOC="COGNOVIS.md"

# Generator behavior never belongs to the overlay (COGNOVIS.md contract decision 3).
FORBIDDEN_PREFIXES="src/typeschema/ src/api/writer-generator/"

die() {
    printf 'apply-cognovis-overlay: %s\n' "$1" >&2
    exit 1
}

info() {
    printf '  %s\n' "$1"
}

# --- allowlist -------------------------------------------------------------

# Extract the fenced `overlay-allowlist` block from COGNOVIS.md. Comment lines
# (#) and blank lines are ignored so the block can stay readable.
parse_allowlist() {
    local doc="${REPO_ROOT}/${ALLOWLIST_DOC}"
    test -f "${doc}" || die "missing ${ALLOWLIST_DOC} at ${doc}"
    awk '
        /^```overlay-allowlist[[:space:]]*$/ { inblock = 1; next }
        inblock && /^```/                    { exit }
        inblock && /^[[:space:]]*#/          { next }
        inblock && NF                        { print $1 }
    ' "${doc}"
}

ALLOWLIST=()
load_allowlist() {
    local line
    while IFS= read -r line; do
        ALLOWLIST+=("${line}")
    done < <(parse_allowlist)

    test "${#ALLOWLIST[@]}" -gt 0 ||
        die "no overlay-allowlist block found in ${ALLOWLIST_DOC}; the allowlist is the contract and must be parseable"
}

is_allowlisted() {
    local candidate="$1" entry
    for entry in "${ALLOWLIST[@]}"; do
        test "${entry}" = "${candidate}" && return 0
    done
    return 1
}

is_forbidden() {
    local candidate="$1" prefix
    for prefix in ${FORBIDDEN_PREFIXES}; do
        case "${candidate}" in
            "${prefix}"*) return 0 ;;
        esac
    done
    return 1
}

# Every write goes through this guard, so the script cannot silently grow a path
# that COGNOVIS.md does not publish.
guard_write() {
    local path="$1"
    is_allowlisted "${path}" ||
        die "refusing to write '${path}': not in the ${ALLOWLIST_DOC} overlay allowlist"
    is_forbidden "${path}" &&
        die "refusing to write '${path}': generator sources are never overlay paths"
    return 0
}

# --- overlay operations ----------------------------------------------------

# Whole-file ownership: upstream either has no such file, or the Cognovis version
# supersedes it outright (the publish pipeline and its changelog tooling).
copy_owned() {
    local path="$1" target="$2"
    guard_write "${path}"
    test -f "${REPO_ROOT}/${path}" || die "overlay source missing: ${path}"
    mkdir -p "$(dirname "${target}/${path}")"
    cp "${REPO_ROOT}/${path}" "${target}/${path}"
    info "copied   ${path}"
}

# Rewrite a single file through a sed program, leaving every other line alone.
patch_sed() {
    local path="$1" target="$2" program="$3"
    guard_write "${path}"
    local file="${target}/${path}"
    test -f "${file}" || die "expected upstream file to patch: ${path}"
    local tmp="${file}.overlay-tmp"
    sed "${program}" "${file}" >"${tmp}"
    # Preserve the executable bit that git checked out (the CLI entry point).
    if test -x "${file}"; then
        chmod +x "${tmp}"
    fi
    mv "${tmp}" "${file}"
    info "patched  ${path}"
}

patch_package_json() {
    local target="$1"
    guard_write "package.json"
    local file="${target}/package.json"
    test -f "${file}" || die "expected upstream package.json"
    # shellcheck disable=SC2016  # the JS body is deliberately unexpanded by the shell
    bun -e '
        const fs = require("node:fs");
        const file = process.argv[1];
        const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
        pkg.name = "@cognovis/codegen";
        pkg.scripts = pkg.scripts || {};
        pkg.scripts.prepare = "npx --no-install tsup";
        pkg.allowScripts = ["@atomic-ehr/codegen"];
        fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    ' "${file}"
    info "patched  package.json (name, prepare, allowScripts)"
}

patch_gitignore() {
    local target="$1"
    guard_write ".gitignore"
    local file="${target}/.gitignore"
    test -f "${file}" || die "expected upstream .gitignore"
    if grep -qx '\.intake/' "${file}"; then
        info "skipped  .gitignore (.intake/ already ignored)"
        return 0
    fi
    printf '.intake/\n' >>"${file}"
    info "patched  .gitignore (.intake/)"
}

apply_overlay() {
    local target="$1"
    test -d "${target}" || die "target directory does not exist: ${target}"

    # Fork-owned files: absent upstream, or superseded wholesale.
    copy_owned "COGNOVIS.md" "${target}"
    copy_owned "cliff.toml" "${target}"
    copy_owned ".github/workflows/release.yml" "${target}"
    copy_owned "scripts/release.sh" "${target}"
    chmod +x "${target}/scripts/release.sh"

    # Identity patches against files upstream continues to own.
    patch_package_json "${target}"
    patch_gitignore "${target}"
    patch_sed ".github/workflows/ci.yml" "${target}" \
        's|@atomic-ehr/codegen|@cognovis/codegen|g'
    patch_sed "src/cli/index.ts" "${target}" \
        '1s|^#!/usr/bin/env node$|#!/usr/bin/env bun|'
    patch_sed "tsup.config.ts" "${target}" \
        's|#!/usr/bin/env node|#!/usr/bin/env bun|g'

    # CHANGELOG.md is allowlisted but deliberately not written here: git-cliff
    # regenerates it during scripts/release.sh, and inventing release text is
    # outside the overlay.
}

# --- verify ----------------------------------------------------------------

VERIFY_TMP=""
cleanup_verify() {
    if test -n "${VERIFY_TMP}" && test -d "${VERIFY_TMP}"; then
        rm -rf "${VERIFY_TMP}"
    fi
}

# Materialize a pristine base checkout, apply the overlay, and prove the changed
# path set is a subset of the published allowlist and free of generator paths.
verify_overlay() {
    local base_ref="$1" tmp_root="$2"
    mkdir -p "${tmp_root}"
    VERIFY_TMP="$(mktemp -d "${tmp_root}/cognovis-overlay-verify.XXXXXX")"
    trap cleanup_verify EXIT

    local work="${VERIFY_TMP}/base"
    mkdir -p "${work}"

    printf 'Base ref : %s (%s)\n' "${base_ref}" "$(git -C "${REPO_ROOT}" rev-parse --short "${base_ref}")"
    printf 'Workdir  : %s\n' "${work}"
    printf 'Allowlist: %d paths from %s\n\n' "${#ALLOWLIST[@]}" "${ALLOWLIST_DOC}"

    git -C "${REPO_ROOT}" archive "${base_ref}" | tar -x -C "${work}"
    git -C "${work}" init -q -b main
    # Background maintenance would race the temp-directory cleanup by recreating
    # .git/objects/pack while it is being removed.
    git -C "${work}" config gc.auto 0
    git -C "${work}" config maintenance.auto false
    git -C "${work}" add -A
    git -C "${work}" \
        -c user.name="overlay-verify" \
        -c user.email="overlay-verify@cognovis.local" \
        -c commit.gpgsign=false \
        commit -q -m "baseline ${base_ref}"

    printf 'Applying overlay:\n'
    apply_overlay "${work}"
    printf '\n'

    git -C "${work}" add -A
    local changed
    changed="$(git -C "${work}" diff --cached --name-only HEAD)"

    printf 'Changed paths after apply:\n'
    if test -z "${changed}"; then
        printf '  (none)\n'
    else
        printf '%s\n' "${changed}" | sed 's/^/  /'
    fi
    printf '\n'

    local failures=0 path
    while IFS= read -r path; do
        test -n "${path}" || continue
        if ! is_allowlisted "${path}"; then
            printf 'FAIL: %s is not in the %s overlay allowlist\n' "${path}" "${ALLOWLIST_DOC}" >&2
            failures=$((failures + 1))
        fi
        if is_forbidden "${path}"; then
            printf 'FAIL: %s is a generator path and must never be in the overlay\n' "${path}" >&2
            failures=$((failures + 1))
        fi
    done <<EOF
${changed}
EOF

    # Independent restatement of contract decision 3, straight from git.
    local generator_diff
    generator_diff="$(git -C "${work}" diff --cached --name-only HEAD -- src/typeschema src/api/writer-generator)"
    if test -n "${generator_diff}"; then
        printf 'FAIL: generator sources changed:\n%s\n' "${generator_diff}" >&2
        failures=$((failures + 1))
    fi

    if test "${failures}" -gt 0; then
        printf '\nVERIFY FAILED (%d violation(s))\n' "${failures}" >&2
        return 1
    fi

    printf 'OK: changed paths are a subset of the allowlist\n'
    printf 'OK: no src/typeschema/ or src/api/writer-generator/ path was touched\n'
    printf 'VERIFY PASSED\n'
    return 0
}

# --- entry point -----------------------------------------------------------

usage() {
    sed -n '3,16p' "${BASH_SOURCE[0]}" | sed 's|^# \{0,1\}||'
}

main() {
    local mode="apply" target="" base_ref="upstream/main"
    local tmp_root="${TMPDIR:-/tmp}"

    while test $# -gt 0; do
        case "$1" in
            --verify) mode="verify"; shift ;;
            --list) mode="list"; shift ;;
            --base-ref) base_ref="${2:-}"; shift 2 ;;
            --tmp-root) tmp_root="${2:-}"; shift 2 ;;
            -h|--help) usage; exit 0 ;;
            -*) die "unknown option: $1" ;;
            *) target="$1"; shift ;;
        esac
    done

    load_allowlist

    case "${mode}" in
        list)
            printf '%s\n' "${ALLOWLIST[@]}"
            ;;
        verify)
            verify_overlay "${base_ref}" "${tmp_root%/}"
            ;;
        apply)
            test -n "${target}" || die "missing target directory (see --help)"
            apply_overlay "${target}"
            printf 'Overlay applied to %s\n' "${target}"
            ;;
    esac
}

main "$@"
