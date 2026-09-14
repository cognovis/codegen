#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Validate and safely audit a repository's Cognovis PR review channel."""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import yaml

WEBHOOK_TARGET = "https://pr-agent.cognovis.de/api/v1/gitea_webhooks"
WEBHOOK_EVENTS = ["pull_request", "pull_request_sync", "issue_comment"]
PERSISTENT_SCOPES = ["read:user", "write:repository", "write:issue"]
REVIEWDOG_SCOPES = ["write:repository", "write:issue"]
WORKFLOW_EVENTS = ["opened", "reopened", "synchronize", "edited"]
TRUSTED_BASE_SHA = "${{ github.event.pull_request.base.sha }}"
CHECKOUT_ACTION = "https://github.com/actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
SETUP_UV_ACTION = "https://github.com/astral-sh/setup-uv@d0cc045d04ccac9d8b7881df0226f9e82c39688e"
REVIEWDOG_ACTION = "https://github.com/reviewdog/action-setup@d8a7baabd7f3e8544ee4dbde3ee41d0011c3a93f"
SETUP_BUN_ACTION = "https://github.com/oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6"
UPLOAD_ARTIFACT_ACTION = "https://data.forgejo.org/actions/upload-artifact@ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5"
DOWNLOAD_ARTIFACT_ACTION = "https://data.forgejo.org/actions/download-artifact@9bc31d5ccc31df68ecc42ccf4149144866c47d8a"
PYTHON_ADAPTER_RESOURCE = "skill://cognovis-pr/scripts/python_diagnostics.py"
CHANGED_LINE_FILTER_RESOURCE = "skill://cognovis-pr/scripts/changed_line_filter.py"
PYTHON_LINT_COMMAND = "uvx --from ruff==0.16.5 ruff check --select E9,F --output-format json <changed-python-files>"
REPORTER_ENV = {
    "GITEA_ADDRESS": "${{ github.server_url }}",
    "CI_PULL_REQUEST": "${{ github.event.pull_request.number }}",
    "CI_COMMIT": "${{ github.event.pull_request.head.sha }}",
    "CI_REPO_OWNER": "${{ github.repository_owner }}",
    "CI_REPO_NAME": "${{ github.event.repository.name }}",
}
GIT_ISOLATION_ENV = {
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": "/dev/null",
}
VALIDATE_DIAGNOSTICS_SCRIPT = r'''diagnostic_size="$(wc -c < lint-reviewdog.txt)"
if test "$diagnostic_size" -gt 262144; then
  echo "Diagnostic artifact exceeds 262144 bytes" >&2
  exit 2
fi
awk '
  length($0) > 4096 { exit 1 }
  $0 !~ /^[A-Za-z0-9_.\/-]+:[1-9][0-9]*:[1-9][0-9]*: error [A-Za-z0-9_-]+: [[:print:]]+$/ { exit 1 }
  {
    split($0, fields, ":")
    if (fields[1] ~ /^\// || fields[1] ~ /(^|\/)\.\.(\/|$)/) exit 1
  }
' lint-reviewdog.txt || {
  echo "Diagnostic artifact has an unsafe line" >&2
  exit 2
}'''
INIT_METADATA_REPO_SCRIPT = '''metadata_home="$RUNNER_TEMP/reviewdog-empty-home"
mkdir -p "$metadata_home"
HOME="$metadata_home" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \\
  git -c init.templateDir= init --quiet .
tracked_paths="$(HOME="$metadata_home" GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git ls-files)"
if test -n "$tracked_paths"; then
  echo "Reviewdog metadata repository must not contain tracked files" >&2
  exit 2
fi'''
LOCATE_REVIEWDOG_SCRIPT = '''reviewdog_path="$RUNNER_TEMP/reviewdog/bin/reviewdog"
if ! test -x "$reviewdog_path"; then
  echo "The action-installed reviewdog executable is unavailable" >&2
  exit 2
fi
printf 'path=%s\\n' "$reviewdog_path" >> "$GITHUB_OUTPUT"'''
PUBLISH_SCRIPT = """test -n "$REVIEWDOG_GITEA_API_TOKEN"
"${{ steps.reviewdog.outputs.path }}" \\
  -efm='%f:%l:%c: %t%*[^:]: %m' \\
  -reporter=gitea-pr-review \\
  -filter-mode=nofilter \\
  -fail-level=error \\
  < lint-reviewdog.txt"""
FORBIDDEN_CREDENTIAL_KEYS = {
    "secret_values",
    "secret",
    "secret_token",
    "webhook_secret",
    "token",
    "access_token",
    "pat",
    "api_key",
    "password",
    "passphrase",
    "private_key",
    "signing_secret",
    "credential",
    "credentials",
}


class ContractError(ValueError):
    """A repository does not satisfy the portable review-channel contract."""


def _nested_items(value: Any, path: str = "config") -> Iterator[tuple[str, Any]]:
    if isinstance(value, dict):
        for key, nested in value.items():
            rendered = f"{path}.{key}"
            yield rendered, nested
            yield from _nested_items(nested, rendered)
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            yield from _nested_items(nested, f"{path}[{index}]")


def _reject_credential_values(payload: dict[str, Any]) -> None:
    for path, _value in _nested_items(payload):
        key = path.rsplit(".", 1)[-1].casefold()
        if key in FORBIDDEN_CREDENTIAL_KEYS:
            raise ContractError(
                f"Config must contain credential names, never credential values: {path}"
            )


def _load_config(path: Path) -> dict[str, Any]:
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ContractError("Cannot read config") from error
    except yaml.YAMLError as error:
        raise ContractError("Config is not valid YAML") from error
    if not isinstance(payload, dict):
        raise ContractError("Config must be a mapping")
    _reject_credential_values(payload)
    return payload


def _load_json_mapping(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ContractError("Cannot read restored webhook state") from error
    except json.JSONDecodeError as error:
        raise ContractError("Restored webhook state is not valid JSON") from error
    if not isinstance(payload, dict):
        raise ContractError("Restored webhook state must be a mapping")
    return payload


def _mapping(parent: dict[str, Any], key: str) -> dict[str, Any]:
    value = parent.get(key)
    if not isinstance(value, dict):
        raise ContractError(f"{key} must be a mapping")
    return value


def _expect_keys(mapping: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(mapping)
    if actual != expected:
        raise ContractError(f"{label} keys do not match the required allowlist")


def _required_string(parent: dict[str, Any], key: str, label: str) -> str:
    value = parent.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{label} must be a non-empty string")
    return value


def _expect(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        raise ContractError(f"{label} does not match the required value")


def _require_text(source: str, expected: str, label: str) -> None:
    if expected not in source:
        raise ContractError(f"{label} must contain {expected!r}")


def _candidate_skill_roots(repo_root: Path) -> list[Path]:
    home = Path.home()
    candidates = [
        repo_root / ".agents/skills/cognovis-pr",
        repo_root / ".claude/skills/cognovis-pr",
        repo_root / "skills/cognovis-pr",
        home / ".agents/skills/cognovis-pr",
        home / ".claude/skills/cognovis-pr",
    ]
    unique: list[Path] = []
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved not in unique:
            unique.append(resolved)
    return unique


def resolve_skill_resource(resource: str, repo_root: Path) -> Path:
    prefix = "skill://cognovis-pr/"
    if not resource.startswith(prefix):
        raise ContractError("Unsupported skill resource")
    relative = Path(resource.removeprefix(prefix))
    if relative.is_absolute() or ".." in relative.parts:
        raise ContractError("Skill resource must be a safe relative path")
    probed: list[str] = []
    for root in _candidate_skill_roots(repo_root):
        candidate = root / relative
        probed.append(str(candidate))
        if candidate.is_file():
            return candidate
    raise ContractError(f"Skill resource is unavailable; probed: {', '.join(probed)}")


def _validate_config(config: dict[str, Any], repo_root: Path) -> str:
    _expect_keys(
        config,
        {
            "schema_version",
            "repository",
            "visibility",
            "trusted_contributors",
            "persistent_review",
            "reviewdog",
            "language_adapter",
            "disablement",
        },
        "config",
    )
    _expect(config.get("schema_version"), 1, "schema_version")
    repository = config.get("repository")
    if not isinstance(repository, str) or repository.count("/") != 1:
        raise ContractError("repository must use owner/name")
    _expect(config.get("visibility"), "private", "visibility")
    _required_string(config, "trusted_contributors", "trusted_contributors")

    persistent = _mapping(config, "persistent_review")
    _expect_keys(
        persistent,
        {
            "identity",
            "repository_role",
            "token_scopes",
            "site_admin",
            "webhook",
            "automatic_commands",
            "review_on_synchronize",
            "interactive_commands",
        },
        "persistent_review",
    )
    _expect(persistent.get("identity"), "cognovis-pr-agent", "persistent identity")
    _expect(persistent.get("repository_role"), "Admin", "persistent role")
    _expect(persistent.get("token_scopes"), PERSISTENT_SCOPES, "persistent scopes")
    _expect(persistent.get("site_admin"), False, "site_admin")
    webhook = _mapping(persistent, "webhook")
    _expect_keys(webhook, {"target", "signed", "events"}, "persistent_review.webhook")
    _expect(webhook.get("target"), WEBHOOK_TARGET, "webhook target")
    _expect(webhook.get("signed"), True, "webhook signed")
    _expect(webhook.get("events"), WEBHOOK_EVENTS, "webhook events")
    _expect(persistent.get("automatic_commands"), ["/describe", "/review"], "automatic commands")
    _expect(persistent.get("review_on_synchronize"), True, "synchronized review")
    _expect(persistent.get("interactive_commands"), ["/review", "/improve"], "interactive commands")

    reviewdog = _mapping(config, "reviewdog")
    _expect_keys(
        reviewdog,
        {
            "identity",
            "repository_role",
            "token_scopes",
            "secret_names",
            "runner",
            "workflow",
        },
        "reviewdog",
    )
    _required_string(reviewdog, "identity", "reviewdog identity")
    _expect(reviewdog.get("repository_role"), "Write", "reviewdog role")
    _expect(reviewdog.get("token_scopes"), REVIEWDOG_SCOPES, "reviewdog scopes")
    _required_string(reviewdog, "runner", "runner")
    secret_names = reviewdog.get("secret_names")
    if not isinstance(secret_names, list) or "REVIEWDOG_TOKEN" not in secret_names:
        raise ContractError("reviewdog secret_names must include REVIEWDOG_TOKEN")
    if any(not isinstance(name, str) or not name.isupper() for name in secret_names):
        raise ContractError("secret_names must be uppercase names")

    adapter = _mapping(config, "language_adapter")
    kind = adapter.get("kind")
    if kind not in {"python", "bun-typescript"}:
        raise ContractError("language_adapter.kind must be python or bun-typescript")
    if kind == "python":
        _expect_keys(
            adapter,
            {"kind", "lint_command", "diagnostic_adapter"},
            "language_adapter",
        )
        _expect(adapter.get("diagnostic_adapter"), PYTHON_ADAPTER_RESOURCE, "Python diagnostic adapter")
        resolve_skill_resource(PYTHON_ADAPTER_RESOURCE, repo_root)
        _expect(adapter.get("lint_command"), PYTHON_LINT_COMMAND, "Python lint command")
    else:
        _expect_keys(
            adapter,
            {"kind", "lint_command", "diagnostic_format"},
            "language_adapter",
        )
        _expect(adapter.get("diagnostic_format"), "file:line:column: error: message", "Bun diagnostic format")
        _require_text(str(adapter.get("lint_command", "")), "bun run lint", "Bun lint command")
    resolve_skill_resource(CHANGED_LINE_FILTER_RESOURCE, repo_root)

    disablement = _mapping(config, "disablement")
    _expect_keys(disablement, {"normal", "emergency"}, "disablement")
    normal_disablement = str(disablement.get("normal", ""))
    for expected in (
        "remove repository webhook",
        "restore full signed state",
        "audit exact events",
    ):
        _require_text(normal_disablement, expected, "normal disablement")
    _require_text(str(disablement.get("emergency", "")), "CONFIG__IGNORE_REPOSITORIES", "emergency disablement")
    return kind


def _load_workflow(path: Path) -> dict[str, Any]:
    try:
        payload = yaml.load(path.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)
    except OSError as error:
        raise ContractError("Cannot read workflow") from error
    except yaml.YAMLError as error:
        raise ContractError("Workflow is not valid YAML") from error
    if not isinstance(payload, dict):
        raise ContractError("Workflow must be a YAML mapping")
    return payload


def _job_steps(jobs: dict[str, Any], job_name: str) -> list[dict[str, Any]]:
    job = _mapping(jobs, job_name)
    steps = job.get("steps")
    if not isinstance(steps, list) or not all(isinstance(step, dict) for step in steps):
        raise ContractError(f"jobs.{job_name}.steps must be a list of mappings")
    return steps


def _step_with_action(steps: list[dict[str, Any]], action: str) -> dict[str, Any]:
    matches = [step for step in steps if step.get("uses") == action]
    if len(matches) != 1:
        raise ContractError(f"Workflow must use {action!r} exactly once")
    return matches[0]


def _secret_bindings(value: Any, path: str = "step") -> list[tuple[str, str]]:
    bindings: list[tuple[str, str]] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            bindings.extend(_secret_bindings(nested, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            bindings.extend(_secret_bindings(nested, f"{path}[{index}]"))
    elif isinstance(value, str):
        for expression in re.findall(r"\$\{\{(.*?)\}\}", value, flags=re.DOTALL):
            if not re.search(r"\bsecrets\b", expression, flags=re.IGNORECASE):
                continue
            matches = list(
                re.finditer(
                    r"\bsecrets\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|"
                    r"\[\s*(['\"])([A-Za-z_][A-Za-z0-9_]*)\2\s*\])",
                    expression,
                    flags=re.IGNORECASE,
                )
            )
            if not matches:
                bindings.append((path, "INVALID_SECRET_EXPRESSION"))
                continue
            for match in matches:
                bindings.append((path, match.group(1) or match.group(3)))
    return bindings


def _expect_token_cleared(step: dict[str, Any], label: str) -> None:
    env = _mapping(step, "env")
    _expect(env.get("GITHUB_TOKEN"), "", f"{label} GITHUB_TOKEN isolation")
    _expect(env.get("GITEA_TOKEN"), "", f"{label} GITEA_TOKEN isolation")


def _validate_workflow(config: dict[str, Any], repo_root: Path, kind: str) -> None:
    reviewdog = _mapping(config, "reviewdog")
    relative = reviewdog.get("workflow")
    if not isinstance(relative, str) or Path(relative).is_absolute() or ".." in Path(relative).parts:
        raise ContractError("reviewdog.workflow must be a repository-relative path")
    workflow = _load_workflow(repo_root / relative)
    _expect_keys(workflow, {"name", "on", "permissions", "jobs"}, "workflow")
    trigger = _mapping(_mapping(workflow, "on"), "pull_request")
    _expect(trigger.get("types"), WORKFLOW_EVENTS, "pull_request event types")
    _expect(_mapping(workflow, "permissions"), {"contents": "read"}, "workflow permissions")

    jobs = _mapping(workflow, "jobs")
    expected_jobs = {"diagnostics", "publish"}
    if kind == "bun-typescript":
        expected_jobs.add("dependencies")
    _expect_keys(jobs, expected_jobs, "workflow jobs")
    diagnostics = _mapping(jobs, "diagnostics")
    publish_job = _mapping(jobs, "publish")
    diagnostic_keys = {"if", "runs-on", "steps"}
    if kind == "bun-typescript":
        diagnostic_keys.add("needs")
    _expect_keys(diagnostics, diagnostic_keys, "diagnostics job")
    _expect_keys(publish_job, {"needs", "runs-on", "steps"}, "publish job")
    _expect(diagnostics.get("runs-on"), reviewdog["runner"], "diagnostics runner")
    _expect(publish_job.get("runs-on"), reviewdog["runner"], "publish runner")
    _expect(publish_job.get("needs"), "diagnostics", "publish dependency")
    _require_text(str(diagnostics.get("if", "")), "github.event.pull_request.draft", "draft guard")
    diagnostics_steps = _job_steps(jobs, "diagnostics")
    publish_steps = _job_steps(jobs, "publish")

    checkout = _step_with_action(diagnostics_steps, CHECKOUT_ACTION)
    checkout_with = _mapping(checkout, "with")
    _expect(checkout_with.get("ref"), "${{ github.event.pull_request.head.sha }}", "checkout ref")
    _expect(checkout_with.get("persist-credentials"), "false", "checkout credentials")
    _expect(checkout_with.get("fetch-depth"), "0", "checkout depth")
    upload = _step_with_action(diagnostics_steps, UPLOAD_ARTIFACT_ACTION)
    _expect(
        _mapping(upload, "with"),
        {
            "name": "reviewdog-diagnostics",
            "path": "lint-reviewdog.txt",
            "if-no-files-found": "error",
            "retention-days": "1",
        },
        "diagnostic artifact upload",
    )

    if len(publish_steps) != 6:
        raise ContractError("Publish job must contain only the six allowlisted steps")
    download = publish_steps[0]
    _expect(download.get("uses"), DOWNLOAD_ARTIFACT_ACTION, "diagnostic artifact download action")
    _expect(_mapping(download, "with"), {"name": "reviewdog-diagnostics"}, "diagnostic artifact download")
    artifact_guard = publish_steps[1]
    _expect(str(artifact_guard.get("run", "")).strip(), VALIDATE_DIAGNOSTICS_SCRIPT, "diagnostic artifact guard")
    metadata_init = publish_steps[2]
    _expect(
        str(metadata_init.get("run", "")).strip(),
        INIT_METADATA_REPO_SCRIPT,
        "empty reviewdog metadata initialization",
    )
    reviewdog_setup = publish_steps[3]
    _expect(reviewdog_setup.get("uses"), REVIEWDOG_ACTION, "reviewdog setup action")
    _expect(_mapping(reviewdog_setup, "with").get("reviewdog_version"), "v0.21.0", "reviewdog version")
    locate = publish_steps[4]
    _expect(locate.get("id"), "reviewdog", "reviewdog path step id")
    _expect(str(locate.get("run", "")).strip(), LOCATE_REVIEWDOG_SCRIPT, "reviewdog path script")
    publish = publish_steps[5]
    publish_env = _mapping(publish, "env")
    _expect_keys(
        publish_env,
        {"REVIEWDOG_GITEA_API_TOKEN", *REPORTER_ENV, *GIT_ISOLATION_ENV},
        "reviewdog publish environment",
    )
    _expect(publish_env.get("REVIEWDOG_GITEA_API_TOKEN"), "${{ secrets.REVIEWDOG_TOKEN }}", "reviewdog token binding")
    for name, expected in REPORTER_ENV.items():
        _expect(publish_env.get(name), expected, f"reviewdog reporter environment {name}")
    for name, expected in GIT_ISOLATION_ENV.items():
        _expect(publish_env.get(name), expected, f"reviewdog git isolation environment {name}")
    _expect(str(publish.get("run", "")).strip(), PUBLISH_SCRIPT, "reviewdog publish script")

    allowed_secret_steps: dict[int, set[str]] = {id(publish): {"REVIEWDOG_TOKEN"}}
    dependency_steps: list[dict[str, Any]] = []
    if kind == "bun-typescript":
        dependencies = _mapping(jobs, "dependencies")
        _expect_keys(dependencies, {"if", "runs-on", "steps"}, "dependencies job")
        _expect(dependencies.get("runs-on"), reviewdog["runner"], "dependencies runner")
        _require_text(str(dependencies.get("if", "")), "github.event.pull_request.draft", "dependencies draft guard")
        _expect(diagnostics.get("needs"), "dependencies", "diagnostics dependency")
        dependency_steps = _job_steps(jobs, "dependencies")
        if len(dependency_steps) != 4:
            raise ContractError("Dependencies job must contain only the four allowlisted steps")
        dependency_checkout = dependency_steps[0]
        _expect(dependency_checkout.get("uses"), CHECKOUT_ACTION, "dependencies checkout action")
        dependency_checkout_with = _mapping(dependency_checkout, "with")
        _expect(
            dependency_checkout_with.get("ref"),
            TRUSTED_BASE_SHA,
            "dependencies checkout must use the trusted base SHA",
        )
        _expect(dependency_checkout_with.get("persist-credentials"), "false", "dependencies checkout credentials")
        _expect(dependency_checkout_with.get("fetch-depth"), "0", "dependencies checkout depth")
        _expect(dependency_steps[1].get("uses"), SETUP_BUN_ACTION, "dependencies Bun setup")
        install = dependency_steps[2]
        install_env = _mapping(install, "env")
        _expect_keys(install_env, {"NPM_TOKEN", "GITHUB_TOKEN", "GITEA_TOKEN"}, "Bun install environment")
        _expect(install_env.get("NPM_TOKEN"), "${{ secrets.NPM_TOKEN }}", "Bun registry token binding")
        _expect_token_cleared(install, "Bun install")
        _expect(str(install.get("run", "")).strip(), "bun install --frozen-lockfile --ignore-scripts", "Bun credentialed install")
        dependency_upload = dependency_steps[3]
        _expect(dependency_upload.get("uses"), UPLOAD_ARTIFACT_ACTION, "dependency artifact upload action")
        _expect(
            _mapping(dependency_upload, "with"),
            {
                "name": "bun-dependencies",
                "path": "node_modules",
                "if-no-files-found": "error",
                "retention-days": "1",
            },
            "dependency artifact upload",
        )
        allowed_secret_steps[id(install)] = {"NPM_TOKEN"}

    all_steps = dependency_steps + diagnostics_steps + publish_steps
    for step in all_steps:
        bindings = _secret_bindings(step)
        allowed = allowed_secret_steps.get(id(step), set())
        if {name for _path, name in bindings} != allowed or len(bindings) != len(allowed):
            raise ContractError("Workflow secret bindings do not match the isolated allowlist")

    for step in diagnostics_steps:
        if "run" in step:
            _expect_token_cleared(step, "diagnostic")
    non_secret_runs = "\n".join(str(step.get("run", "")) for step in diagnostics_steps)
    for expected in (
        ".agents/skills/cognovis-pr/scripts/changed_line_filter.py",
        ".claude/skills/cognovis-pr/scripts/changed_line_filter.py",
        "skills/cognovis-pr/scripts/changed_line_filter.py",
        "uv run --no-project python \"$filter_path\"",
        "--base-sha \"${{ github.event.pull_request.base.sha }}\"",
        "--head-sha \"${{ github.event.pull_request.head.sha }}\"",
        "--input lint-reviewdog.unfiltered.txt",
        "> lint-reviewdog.txt",
    ):
        _require_text(non_secret_runs, expected, "changed-line filtering step")
    if kind == "python":
        if len(diagnostics_steps) != 4:
            raise ContractError("Python diagnostics job must contain only the four allowlisted steps")
        _expect(diagnostics_steps[1].get("uses"), SETUP_UV_ACTION, "Python uv setup")
        for expected in (
            "git diff --name-only -z --diff-filter=ACMR",
            ".agents/skills/cognovis-pr/scripts/python_diagnostics.py",
            ".claude/skills/cognovis-pr/scripts/python_diagnostics.py",
            "skills/cognovis-pr/scripts/python_diagnostics.py",
            "uv run --no-project python \"$adapter_path\" collect",
            "--changed-files changed-python-files",
            "--json-output lint-reviewdog.json",
            "--repo-root .",
            "--select E9,F",
        ):
            _require_text(non_secret_runs, expected, "Python diagnostic step")
        if "xargs" in non_secret_runs or 'exit "$ruff_status"' in non_secret_runs:
            raise ContractError("Python findings must reach reviewdog as one JSON document")
    else:
        if len(diagnostics_steps) != 6:
            raise ContractError("Bun diagnostics job must contain only the six allowlisted steps")
        _expect(diagnostics_steps[1].get("uses"), SETUP_BUN_ACTION, "diagnostic Bun setup")
        _expect(diagnostics_steps[2].get("uses"), SETUP_UV_ACTION, "diagnostic uv setup")
        dependency_download = diagnostics_steps[3]
        _expect(dependency_download.get("uses"), DOWNLOAD_ARTIFACT_ACTION, "dependency artifact download action")
        _expect(
            _mapping(dependency_download, "with"),
            {"name": "bun-dependencies", "path": "node_modules"},
            "dependency artifact download",
        )
        _require_text(non_secret_runs, "bun run lint", "Bun diagnostic step")
        _require_text(non_secret_runs, 'if test "$lint_status" -gt 1', "Bun tool failure guard")
        if "|| true" in non_secret_runs:
            raise ContractError("Bun diagnostics must not hide tool failures")


def validate_repository(config_path: Path, repo_root: Path) -> dict[str, Any]:
    config = _load_config(config_path)
    kind = _validate_config(config, repo_root)
    _validate_workflow(config, repo_root, kind)
    return {
        "status": "ok",
        "repository": config["repository"],
        "language_adapter": kind,
        "webhook_events": WEBHOOK_EVENTS,
    }


def audit_repository(config_path: Path, repo_root: Path) -> dict[str, Any]:
    validation = validate_repository(config_path, repo_root)
    config = _load_config(config_path)
    persistent = _mapping(config, "persistent_review")
    reviewdog = _mapping(config, "reviewdog")
    return {
        "status": validation["status"],
        "repository": config["repository"],
        "expected_membership": {
            "identity": persistent["identity"],
            "role": persistent["repository_role"],
            "site_admin": persistent["site_admin"],
            "scopes": persistent["token_scopes"],
        },
        "reviewdog_identity": {
            "identity": reviewdog["identity"],
            "role": reviewdog["repository_role"],
            "scopes": reviewdog["token_scopes"],
        },
        "webhook": {
            "target": persistent["webhook"]["target"],
            "signed": persistent["webhook"]["signed"],
            "events": persistent["webhook"]["events"],
        },
        "automatic_commands": persistent["automatic_commands"],
        "interactive_commands": persistent["interactive_commands"],
        "review_on_synchronize": persistent["review_on_synchronize"],
        "secret_names": reviewdog["secret_names"],
        "runner": reviewdog["runner"],
        "disablement": {
            "normal": config["disablement"]["normal"],
            "emergency": config["disablement"]["emergency"],
        },
    }


def audit_restored_webhook(state: dict[str, Any]) -> dict[str, Any]:
    """Validate a redacted post-restore projection without exposing credentials."""
    _expect_keys(state, {"active", "events", "config", "signature"}, "restored webhook state")
    _expect(state.get("active"), True, "restored webhook active state")
    restored_events = state.get("events")
    if (
        not isinstance(restored_events, list)
        or len(restored_events) != len(WEBHOOK_EVENTS)
        or not all(isinstance(event, str) for event in restored_events)
        or set(restored_events) != set(WEBHOOK_EVENTS)
    ):
        raise ContractError("restored webhook events do not match the required allowlist")
    config = _mapping(state, "config")
    _expect_keys(config, {"url", "content_type"}, "restored webhook config")
    _expect(config.get("url"), WEBHOOK_TARGET, "restored webhook target")
    _expect(config.get("content_type"), "json", "restored webhook content type")
    signature = _mapping(state, "signature")
    _expect_keys(
        signature,
        {"centrally_sourced", "hash_matched"},
        "restored webhook signature proof",
    )
    _expect(
        signature.get("centrally_sourced"),
        True,
        "restored webhook central signature source",
    )
    _expect(signature.get("hash_matched"), True, "restored webhook signature hash match")
    return {
        "status": "ok",
        "active": True,
        "events": WEBHOOK_EVENTS,
        "signed": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("validate", "audit", "restore-audit"))
    parser.add_argument("--config", type=Path)
    parser.add_argument("--repo-root", type=Path)
    parser.add_argument("--hook-state", type=Path)
    args = parser.parse_args()
    try:
        if args.mode == "restore-audit":
            if args.hook_state is None:
                raise ContractError("restore-audit requires --hook-state")
            payload = audit_restored_webhook(_load_json_mapping(args.hook_state))
        elif args.config is None or args.repo_root is None:
            raise ContractError("validate and audit require --config and --repo-root")
        elif args.mode == "validate":
            payload = validate_repository(args.config, args.repo_root)
        else:
            payload = audit_repository(args.config, args.repo_root)
    except ContractError as error:
        print(json.dumps({"status": "error", "errors": [str(error)]}, sort_keys=True))
        return 1
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
