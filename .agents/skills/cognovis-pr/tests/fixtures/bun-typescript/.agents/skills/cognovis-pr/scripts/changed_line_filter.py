"""Filter reviewdog diagnostics to lines added by a pull request diff."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from collections import defaultdict, namedtuple
from pathlib import Path
from typing import TextIO

SAFE_PATH = r"[A-Za-z0-9_./-]+"
DIAGNOSTIC = re.compile(
    rf"^(?P<path>{SAFE_PATH}):(?P<line>[1-9][0-9]*):"
    r"(?P<column>[1-9][0-9]*): error "
    r"(?P<code>[A-Za-z0-9_-]+): (?P<message>[^\r\n]+)$"
)
DIFF_FILE = re.compile(rf"^\+\+\+ b/(?P<path>{SAFE_PATH})$")
DIFF_HUNK = re.compile(
    r"^@@ -[0-9]+(?:,(?P<old_count>[0-9]+))? "
    r"\+(?P<start>[0-9]+)(?:,(?P<count>[0-9]+))? @@"
)
COMMIT = re.compile(r"^[0-9a-fA-F]{40,64}$")


FilterCounts = namedtuple("FilterCounts", ("emitted", "skipped"), defaults=(0, 0))


def _safe_path(value: str) -> bool:
    path = Path(value)
    return (
        bool(value)
        and not path.is_absolute()
        and ".." not in path.parts
        and value == path.as_posix()
    )


def added_line_ranges(diff: str) -> dict[str, list[tuple[int, int]]]:
    """Parse zero-context unified diff output into inclusive added-line ranges."""
    ranges: dict[str, list[tuple[int, int]]] = defaultdict(list)
    current_path: str | None = None
    inside_file_diff = False
    awaiting_new_header = False
    old_remaining = 0
    new_remaining = 0
    for raw_line in diff.splitlines():
        if old_remaining or new_remaining:
            if raw_line == r"\ No newline at end of file":
                continue
            prefix = raw_line[:1]
            if prefix == "+" and new_remaining:
                new_remaining -= 1
            elif prefix == "-" and old_remaining:
                old_remaining -= 1
            elif prefix == " " and old_remaining and new_remaining:
                old_remaining -= 1
                new_remaining -= 1
            continue

        if raw_line.startswith("diff --git "):
            inside_file_diff = True
            awaiting_new_header = False
            current_path = None
            continue

        if inside_file_diff and raw_line.startswith("--- "):
            awaiting_new_header = True
            current_path = None
            continue

        if awaiting_new_header:
            file_match = DIFF_FILE.fullmatch(raw_line)
            if file_match:
                candidate = file_match.group("path")
                current_path = candidate if _safe_path(candidate) else None
            awaiting_new_header = False
            continue

        hunk_match = DIFF_HUNK.match(raw_line)
        if not hunk_match:
            continue
        start = int(hunk_match.group("start"))
        count = int(hunk_match.group("count") or "1")
        old_remaining = int(hunk_match.group("old_count") or "1")
        new_remaining = count
        if current_path is not None and count > 0:
            ranges[current_path].append((start, start + count - 1))
    return dict(ranges)


def collect_added_line_ranges(
    base_sha: str, head_sha: str, repo_root: Path
) -> dict[str, list[tuple[int, int]]]:
    """Run a non-extensible git diff and return its added-line ranges."""
    if not COMMIT.fullmatch(base_sha) or not COMMIT.fullmatch(head_sha):
        raise ValueError("Base and head revisions must be full commit hashes")
    environment = {
        key: os.environ[key]
        for key in ("HOME", "PATH", "TMPDIR")
        if key in os.environ
    }
    result = subprocess.run(
        [
            "git",
            "diff",
            "--unified=0",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            f"{base_sha}...{head_sha}",
            "--",
        ],
        cwd=repo_root,
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("Cannot derive pull request added-line ranges")
    return added_line_ranges(result.stdout)


def filter_diagnostics(
    source: TextIO,
    destination: TextIO,
    ranges: dict[str, list[tuple[int, int]]],
) -> FilterCounts:
    """Write safe added-line diagnostics and count nonconforming omissions."""
    emitted = 0
    skipped = 0
    for raw_line in source:
        line = raw_line.removesuffix("\n")
        match = DIAGNOSTIC.fullmatch(line)
        if not match or not _safe_path(match.group("path")):
            skipped += 1
            continue
        line_number = int(match.group("line"))
        if any(start <= line_number <= end for start, end in ranges.get(match.group("path"), [])):
            destination.write(line + "\n")
            emitted += 1
    return FilterCounts(emitted=emitted, skipped=skipped)


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--head-sha", required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args(arguments)
    try:
        ranges = collect_added_line_ranges(args.base_sha, args.head_sha, args.repo_root)
        with args.input.open(encoding="utf-8") as source:
            counts = filter_diagnostics(source, sys.stdout, ranges)
        if counts.skipped:
            print(
                f"changed_line_filter: skipped {counts.skipped} nonconforming diagnostics",
                file=sys.stderr,
            )
    except (OSError, RuntimeError, ValueError) as error:
        print(f"changed_line_filter: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
