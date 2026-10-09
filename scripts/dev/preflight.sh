#!/usr/bin/env bash
# Pre-push preflight for @cognovis/codegen.
#
# The managed global pre-push hook (~/.githooks/pre-push) runs this script when
# a repository ships one. It runs the Library toolchains check, which fails when
# a toolchain declaration outside the lockfile is older than the latest release.
# The checker's exit code is preserved; on failure its JSON result is printed.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
status=0
output=$(python3 .agents/standards/toolchains/scripts/check_toolchain_versions.py) || status=$?
if [ "$status" -ne 0 ]; then
  printf '%s\n' "$output"
  echo "preflight: toolchain check failed (exit $status)" >&2
  exit "$status"
fi
echo "preflight: toolchain check passed"
