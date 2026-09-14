"""Convert Ruff JSON findings to reviewdog-compatible diagnostics."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


def _relative_filename(filename: str, repo_root: Path) -> str:
    path = Path(filename)
    root = repo_root.resolve()
    if not path.is_absolute():
        return path.as_posix()
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError as error:
        raise ValueError(f"Ruff finding is outside repository root: {filename}") from error


def convert(findings: list[dict[str, Any]], repo_root: Path | None = None) -> list[str]:
    root = repo_root or Path.cwd()
    diagnostics: list[str] = []
    for finding in findings:
        filename = str(finding.get("filename", "")).strip()
        location = finding.get("location")
        if not filename or not isinstance(location, dict):
            raise ValueError("Each Ruff finding needs filename and location")
        row = int(location.get("row", 0))
        column = int(location.get("column", 0))
        if row < 1 or column < 1:
            raise ValueError("Ruff locations must be positive")
        code = str(finding.get("code") or "RUFF").replace("\n", " ").strip()
        message = " ".join(str(finding.get("message") or "lint failure").split())
        relative = _relative_filename(filename, root)
        diagnostics.append(f"{relative}:{row}:{column}: error {code}: {message}")
    return diagnostics


def collect(
    changed_files_path: Path,
    json_output: Path,
    *,
    repo_root: Path | None = None,
    select: str | None = None,
) -> int:
    """Run one Ruff process and preserve its single valid JSON document."""
    try:
        raw_paths = changed_files_path.read_bytes()
    except OSError as error:
        print(f"python_diagnostics: {error}", file=sys.stderr)
        return 2
    paths = [os.fsdecode(entry) for entry in raw_paths.split(b"\0") if entry]
    if not paths:
        json_output.write_text("[]\n", encoding="utf-8")
        return 0
    command = [
        "uvx",
        "--from",
        "ruff==0.16.5",
        "ruff",
        "check",
        "--output-format",
        "json",
    ]
    if select:
        command.extend(("--select", select))
    command.extend(("--", *paths))
    environment = {
        key: os.environ[key]
        for key in (
            "HOME",
            "PATH",
            "TMPDIR",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "UV_CACHE_DIR",
            "UV_PYTHON_INSTALL_DIR",
            "XDG_CACHE_HOME",
        )
        if key in os.environ
    }
    result = subprocess.run(
        command,
        cwd=repo_root or Path.cwd(),
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode not in {0, 1}:
        print(result.stderr.rstrip(), file=sys.stderr)
        return result.returncode or 2
    try:
        payload = json.loads(result.stdout)
        if not isinstance(payload, list):
            raise TypeError("Ruff JSON must be an array")
        json_output.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    except (OSError, TypeError, json.JSONDecodeError) as error:
        print(f"python_diagnostics: {error}", file=sys.stderr)
        return 2
    return 0


def _convert_main(arguments: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", help="Ruff JSON file; stdin when omitted")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    args = parser.parse_args(arguments)
    try:
        if args.path:
            with open(args.path, encoding="utf-8") as handle:
                payload = json.load(handle)
        else:
            payload = json.load(sys.stdin)
        if not isinstance(payload, list):
            raise TypeError("Ruff JSON must be an array")
        for diagnostic in convert(payload, args.repo_root):
            print(diagnostic)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        print(f"python_diagnostics: {error}", file=sys.stderr)
        return 2
    return 0


def _collect_main(arguments: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Collect one Ruff JSON document")
    parser.add_argument("--changed-files", type=Path, required=True)
    parser.add_argument("--json-output", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--select")
    args = parser.parse_args(arguments)
    return collect(
        args.changed_files,
        args.json_output,
        repo_root=args.repo_root,
        select=args.select,
    )


def main() -> int:
    if sys.argv[1:2] == ["collect"]:
        return _collect_main(sys.argv[2:])
    return _convert_main(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
