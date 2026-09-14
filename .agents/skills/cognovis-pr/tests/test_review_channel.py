from __future__ import annotations

import importlib.util
import io
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = SKILL_ROOT / "scripts" / "review_channel.py"
DIAGNOSTICS = SKILL_ROOT / "scripts" / "python_diagnostics.py"
CHANGED_LINE_FILTER = SKILL_ROOT / "scripts" / "changed_line_filter.py"
FIXTURES = Path(__file__).parent / "fixtures"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("language", ["python", "bun-typescript"])
def test_portable_fixture_validates_complete_review_channel(language: str) -> None:
    module = _load(SCRIPT, f"review_channel_{language.replace('-', '_')}")
    root = FIXTURES / language

    result = module.validate_repository(root / ".cognovis/pr-review.yaml", root)

    assert result["status"] == "ok"
    assert result["language_adapter"] == language
    assert result["webhook_events"] == [
        "pull_request",
        "pull_request_sync",
        "issue_comment",
    ]


def test_audit_is_redacted_and_reports_disablement() -> None:
    module = _load(SCRIPT, "review_channel_audit")
    root = FIXTURES / "python"

    audit = module.audit_repository(root / ".cognovis/pr-review.yaml", root)
    serialized = json.dumps(audit)

    assert audit["expected_membership"]["identity"] == "cognovis-pr-agent"
    assert audit["secret_names"] == ["REVIEWDOG_TOKEN"]
    assert audit["runner"] == "atlas"
    assert audit["webhook"]["events"] == [
        "pull_request",
        "pull_request_sync",
        "issue_comment",
    ]
    assert "push" not in audit["webhook"]["events"]
    assert "remove repository webhook" in audit["disablement"]["normal"]
    assert "secret_values" not in serialized


def test_python_diagnostics_converts_real_absolute_ruff_json(tmp_path: Path) -> None:
    module = _load(DIAGNOSTICS, "python_diagnostics")
    source = tmp_path / "src/example.py"
    source.parent.mkdir()
    source.write_text("import os\n", encoding="utf-8")
    changed_files = tmp_path / "changed-files"
    changed_files.write_bytes(b"src/example.py\0")
    output = tmp_path / "ruff.json"

    status = module.collect(changed_files, output, repo_root=tmp_path, select="F401")

    assert status == 0
    findings = json.loads(output.read_text())
    assert Path(findings[0]["filename"]).is_absolute()

    converted = module.convert(findings, tmp_path)

    assert len(converted) == 1
    assert converted[0].startswith("src/example.py:1:8: error F401:")


def test_python_diagnostics_hard_fails_real_ruff_tool_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = _load(DIAGNOSTICS, "python_diagnostics_tool_error")
    changed_files = tmp_path / "changed-files"
    changed_files.write_bytes(b"src/example.py\0")
    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 2, "", "boom"),
    )

    status = module.collect(changed_files, tmp_path / "ruff.json")

    assert status == 2
    assert not (tmp_path / "ruff.json").exists()


def test_python_fixture_adapter_is_executable(tmp_path: Path) -> None:
    fixture_adapter = (
        FIXTURES
        / "python/.agents/skills/cognovis-pr/scripts/python_diagnostics.py"
    )
    source = tmp_path / "example.py"
    source.write_text("import os\n", encoding="utf-8")
    changed_files = tmp_path / "changed-files"
    changed_files.write_bytes(b"example.py\0")
    output = tmp_path / "ruff.json"

    result = subprocess.run(
        [
            "uv",
            "run",
            "--no-project",
            "python",
            str(fixture_adapter),
            "collect",
            "--changed-files",
            str(changed_files),
            "--json-output",
            str(output),
            "--repo-root",
            str(tmp_path),
            "--select",
            "F401",
        ],
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert len(json.loads(output.read_text())) == 1


def test_python_collector_does_not_forward_ambient_secrets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = _load(DIAGNOSTICS, "python_diagnostics_environment")
    changed_files = tmp_path / "changed-files"
    changed_files.write_bytes(b"example.py\0")
    captured: dict[str, str] = {}

    def fake_run(*args, **kwargs):
        captured.update(kwargs["env"])
        return subprocess.CompletedProcess(args[0], 0, "[]", "")

    monkeypatch.setenv("LIVE_SECRET_SENTINEL", "must-not-forward")
    monkeypatch.setattr(module.subprocess, "run", fake_run)

    assert module.collect(changed_files, tmp_path / "ruff.json") == 0
    assert "LIVE_SECRET_SENTINEL" not in captured


def test_changed_line_filter_keeps_added_violation_and_excludes_legacy_line(
    tmp_path: Path,
) -> None:
    module = _load(CHANGED_LINE_FILTER, "changed_line_filter_added")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=tmp_path, check=True)
    source = tmp_path / "example.py"
    source.write_text("legacy_violation = True\n")
    subprocess.run(["git", "add", "example.py"], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=tmp_path, check=True)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()
    source.write_text("legacy_violation = True\nadded_violation = True\n")
    subprocess.run(["git", "add", "example.py"], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "-qm", "head"], cwd=tmp_path, check=True)
    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()
    diagnostics = io.StringIO(
        "example.py:1:1: error F001: legacy violation\n"
        "example.py:2:1: error F002: added violation\n"
    )
    filtered = io.StringIO()

    ranges = module.collect_added_line_ranges(base_sha, head_sha, tmp_path)
    counts = module.filter_diagnostics(diagnostics, filtered, ranges)

    assert counts == module.FilterCounts(emitted=1, skipped=0)
    assert filtered.getvalue() == "example.py:2:1: error F002: added violation\n"


def test_portable_changed_line_filter_fixtures_match_runtime() -> None:
    expected = CHANGED_LINE_FILTER.read_text()

    for language in ("python", "bun-typescript"):
        fixture = (
            FIXTURES
            / language
            / ".agents/skills/cognovis-pr/scripts/changed_line_filter.py"
        )
        assert fixture.read_text() == expected


@pytest.mark.parametrize(
    "helper",
    [
        CHANGED_LINE_FILTER,
        FIXTURES
        / "python/.agents/skills/cognovis-pr/scripts/changed_line_filter.py",
        FIXTURES
        / "bun-typescript/.agents/skills/cognovis-pr/scripts/changed_line_filter.py",
    ],
)
def test_changed_line_filter_does_not_treat_added_content_as_file_header(
    helper: Path,
) -> None:
    module = _load(helper, f"changed_line_filter_header_{helper.parent.parent.name}")
    diff = """diff --git a/example.py b/example.py
index 0000000..1111111 100644
--- a/example.py
+++ b/example.py
@@ -0,0 +1,2 @@
+++ b/other.py
+undefined_name
"""

    ranges = module.added_line_ranges(diff)
    destination = io.StringIO()
    counts = module.filter_diagnostics(
        io.StringIO(
            "example.py:2:1: error F821: added violation\n"
            "other.py:2:1: error F821: untouched violation\n"
        ),
        destination,
        ranges,
    )

    assert ranges == {"example.py": [(1, 2)]}
    assert counts == module.FilterCounts(emitted=1, skipped=0)
    assert destination.getvalue() == "example.py:2:1: error F821: added violation\n"


@pytest.mark.parametrize(
    "helper",
    [
        CHANGED_LINE_FILTER,
        FIXTURES
        / "python/.agents/skills/cognovis-pr/scripts/changed_line_filter.py",
        FIXTURES
        / "bun-typescript/.agents/skills/cognovis-pr/scripts/changed_line_filter.py",
    ],
)
def test_changed_line_filter_consumes_unsafe_file_hunks_before_parsing_headers(
    helper: Path,
    tmp_path: Path,
) -> None:
    module = _load(helper, f"changed_line_filter_unsafe_{helper.parent.parent.name}")
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "config", "user.email", "test@example.invalid"],
        cwd=tmp_path,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"], cwd=tmp_path, check=True
    )
    source = tmp_path / "unsafe+name.py"
    source.write_text("-- a/victim.py\nkeep one\nkeep two\nold tail\n")
    subprocess.run(["git", "add", "unsafe+name.py"], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=tmp_path, check=True)
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()
    source.write_text("++ b/victim.py\nkeep one\nkeep two\nnew tail\n")
    subprocess.run(["git", "add", "unsafe+name.py"], cwd=tmp_path, check=True)
    subprocess.run(["git", "commit", "-qm", "head"], cwd=tmp_path, check=True)
    head_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()
    actual_diff = subprocess.run(
        ["git", "diff", "--unified=0", f"{base_sha}...{head_sha}", "--"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=True,
    ).stdout

    assert "--- a/victim.py\n+++ b/victim.py" in actual_diff
    assert actual_diff.count("@@") == 4
    assert module.collect_added_line_ranges(base_sha, head_sha, tmp_path) == {}


def test_changed_line_filter_skips_nonportable_paths_without_dropping_safe_findings() -> None:
    module = _load(CHANGED_LINE_FILTER, "changed_line_filter_mixed_paths")
    diagnostics = io.StringIO(
        "safe.py:1:1: error F821: safe finding\n"
        "space name.py:1:1: error F821: spaced path\n"
        "plus+name.py:1:1: error F821: plus path\n"
        "unicodé.py:1:1: error F821: unicode path\n"
        "../escape.py:1:1: error F821: traversal path\n"
    )
    destination = io.StringIO()

    counts = module.filter_diagnostics(
        diagnostics,
        destination,
        {"safe.py": [(1, 1)]},
    )

    assert counts == module.FilterCounts(emitted=1, skipped=4)
    assert destination.getvalue() == "safe.py:1:1: error F821: safe finding\n"


def test_python_diagnostic_fixture_matches_runtime_byte_for_byte() -> None:
    fixture = (
        FIXTURES
        / "python/.agents/skills/cognovis-pr/scripts/python_diagnostics.py"
    )

    assert fixture.read_bytes() == DIAGNOSTICS.read_bytes()


def test_review_channel_script_resolves_pyyaml_from_pep723_metadata(
    tmp_path: Path,
) -> None:
    result = subprocess.run(
        [
            "uv",
            "run",
            "--script",
            str(SCRIPT),
            "validate",
            "--config",
            str(FIXTURES / "python/.cognovis/pr-review.yaml"),
            "--repo-root",
            str(FIXTURES / "python"),
        ],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["status"] == "ok"


def test_validator_rejects_secret_values(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_secrets")
    source = (FIXTURES / "python" / ".cognovis/pr-review.yaml").read_text()
    config = tmp_path / "pr-review.yaml"
    config.write_text(source + "secret_values:\n  REVIEWDOG_TOKEN: forbidden\n")

    with pytest.raises(module.ContractError, match="credential values"):
        module.validate_repository(config, FIXTURES / "python")


def test_validator_rejects_nested_secret_values(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_nested_secrets")
    source = (FIXTURES / "python" / ".cognovis/pr-review.yaml").read_text()
    config = tmp_path / "pr-review.yaml"
    config.write_text(source.replace("  identity: cognovis-pr-agent", "  identity: cognovis-pr-agent\n  webhook_secret: forbidden"))

    with pytest.raises(module.ContractError, match="persistent_review.webhook_secret"):
        module.validate_repository(config, FIXTURES / "python")


@pytest.mark.parametrize("key", ["secret", "pat", "access_token", "unexpected"])
def test_audit_rejects_unknown_or_secret_webhook_fields(
    tmp_path: Path, key: str
) -> None:
    module = _load(SCRIPT, f"review_channel_unknown_{key}")
    source = (FIXTURES / "python" / ".cognovis/pr-review.yaml").read_text()
    config = tmp_path / "pr-review.yaml"
    config.write_text(source.replace("    signed: true", f"    signed: true\n    {key}: forbidden"))

    with pytest.raises(module.ContractError):
        module.audit_repository(config, FIXTURES / "python")

    result = subprocess.run(
        [
            "uv",
            "run",
            "python",
            str(SCRIPT),
            "audit",
            "--config",
            str(config),
            "--repo-root",
            str(FIXTURES / "python"),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert "forbidden" not in result.stdout + result.stderr


@pytest.mark.parametrize(
    "events",
    [
        "[pull_request, issue_comment]",
        "[pull_request, pull_request_sync, pull_request_comment]",
        "[pull_request, pull_request_sync, issue_comment, push]",
    ],
)
def test_webhook_requires_sync_and_rejects_bare_push(
    tmp_path: Path, events: str
) -> None:
    module = _load(SCRIPT, f"review_channel_webhook_{len(events)}")
    source = (FIXTURES / "python" / ".cognovis/pr-review.yaml").read_text()
    config = tmp_path / "pr-review.yaml"
    config.write_text(
        source.replace(
            "[pull_request, pull_request_sync, issue_comment]",
            events,
        )
    )

    with pytest.raises(module.ContractError, match="webhook events"):
        module.validate_repository(config, FIXTURES / "python")


def _restored_webhook_state() -> dict[str, object]:
    return {
        "active": True,
        "events": ["pull_request", "pull_request_sync", "issue_comment"],
        "config": {
            "url": "https://pr-agent.cognovis.de/api/v1/gitea_webhooks",
            "content_type": "json",
        },
        "signature": {"centrally_sourced": True, "hash_matched": True},
    }


def test_restore_audit_accepts_only_complete_signed_hook_state() -> None:
    module = _load(SCRIPT, "review_channel_restore_complete")

    result = module.audit_restored_webhook(_restored_webhook_state())

    assert result == {
        "status": "ok",
        "active": True,
        "events": ["pull_request", "pull_request_sync", "issue_comment"],
        "signed": True,
    }


@pytest.mark.parametrize(
    "state",
    [
        {"active": True},
        {
            **_restored_webhook_state(),
            "events": ["push"],
        },
    ],
)
def test_restore_audit_rejects_active_only_and_default_push_drift(
    state: dict[str, object],
) -> None:
    module = _load(SCRIPT, "review_channel_restore_drift")

    with pytest.raises(module.ContractError):
        module.audit_restored_webhook(state)


def test_restore_audit_cli_never_echoes_secret_values(tmp_path: Path) -> None:
    state = _restored_webhook_state()
    sentinel = "gto_RESTORESECRET1234567890abcdef"
    state["config"] = {
        **state["config"],
        "secret": sentinel,
    }
    hook_state = tmp_path / "hook-state.json"
    hook_state.write_text(json.dumps(state))

    result = subprocess.run(
        [
            "uv",
            "run",
            "python",
            str(SCRIPT),
            "restore-audit",
            "--hook-state",
            str(hook_state),
        ],
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 1
    assert sentinel not in result.stdout + result.stderr


def test_config_rejects_active_only_restore_contract(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_restore_contract")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    config = root / ".cognovis/pr-review.yaml"
    config.write_text(
        config.read_text().replace(
            "remove repository webhook; restore full signed state and audit exact events",
            "remove repository webhook; restore active state",
        )
    )

    with pytest.raises(module.ContractError, match="normal disablement"):
        module.validate_repository(config, root)


def test_audit_rejects_missing_reviewdog_identity_without_key_error(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_missing_identity")
    source = (FIXTURES / "python" / ".cognovis/pr-review.yaml").read_text()
    config = tmp_path / "pr-review.yaml"
    config.write_text(source.replace("  identity: example-python-reviewdog\n", ""))

    with pytest.raises(module.ContractError, match="reviewdog"):
        module.audit_repository(config, FIXTURES / "python")

    result = subprocess.run(
        [
            "uv",
            "run",
            "python",
            str(SCRIPT),
            "audit",
            "--config",
            str(config),
            "--repo-root",
            str(FIXTURES / "python"),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 1
    assert json.loads(result.stdout)["status"] == "error"
    assert "Traceback" not in result.stderr


def test_workflow_events_are_validated_structurally(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_events")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            "types: [opened, reopened, synchronize, edited]",
            "types: [reopened] # opened synchronize edited",
        )
    )

    with pytest.raises(module.ContractError, match="pull_request event types"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


def test_portable_resource_resolution_prefers_project_local_skill(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_resolution")
    adapter = tmp_path / ".agents/skills/cognovis-pr/scripts/python_diagnostics.py"
    adapter.parent.mkdir(parents=True)
    adapter.write_text("# local fixture\n", encoding="utf-8")

    resolved = module.resolve_skill_resource(
        "skill://cognovis-pr/scripts/python_diagnostics.py", tmp_path
    )

    assert resolved == adapter.resolve()


def test_python_workflow_publishes_prefiltered_diagnostics_without_git() -> None:
    workflow = (FIXTURES / "python" / ".github/workflows/pr-lint.yml").read_text()

    assert '-filter-mode=nofilter' in workflow
    assert 'changed_line_filter.py' in workflow
    assert '-fail-level=error' in workflow
    assert 'exit "$lint_status"' not in workflow


def test_validator_rejects_xargs_ruff_batching(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_xargs")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            '          uv run --no-project python "$adapter_path" collect',
            '          xargs -0 echo\n          uv run --no-project python "$adapter_path" collect',
        )
    )

    with pytest.raises(module.ContractError, match="one JSON document"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


def test_validator_requires_complete_reviewdog_reporter_environment(
    tmp_path: Path,
) -> None:
    module = _load(SCRIPT, "review_channel_reporter_environment")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            "          CI_REPO_OWNER: ${{ github.repository_owner }}\n",
            "",
        )
    )

    with pytest.raises(
        module.ContractError,
        match="reviewdog publish environment",
    ):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


def test_validator_rejects_any_extra_token_step_command(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_publish_allowlist")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            '          test -n "$REVIEWDOG_GITEA_API_TOKEN"',
            '          python3 adapter.py\n          test -n "$REVIEWDOG_GITEA_API_TOKEN"',
        )
    )

    with pytest.raises(module.ContractError, match="reviewdog publish script"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


def test_validator_requires_bun_ignore_scripts(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_bun_scripts")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "bun-typescript", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(workflow.read_text().replace(" --ignore-scripts", ""))

    with pytest.raises(module.ContractError, match="Bun credentialed install"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


@pytest.mark.parametrize("placement", ["run", "uses"])
def test_validator_rejects_diagnostic_secret_bindings(
    tmp_path: Path, placement: str
) -> None:
    module = _load(SCRIPT, f"review_channel_diagnostic_secret_{placement}")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    source = workflow.read_text()
    if placement == "run":
        source = source.replace(
            '          GITEA_TOKEN: ""',
            '          GITEA_TOKEN: ""\n          STOLEN: ${{ secrets.REVIEWDOG_TOKEN }}',
            1,
        )
    else:
        source = source.replace(
            "      - uses: https://github.com/astral-sh/setup-uv@",
            "      - env:\n          STOLEN: ${{ secrets.REVIEWDOG_TOKEN }}\n        uses: https://github.com/astral-sh/setup-uv@",
            1,
        )
    workflow.write_text(source)

    with pytest.raises(module.ContractError, match="secret bindings"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


@pytest.mark.parametrize(
    "secret_expression",
    [
        "${{ secrets['REVIEWDOG_TOKEN'] }}",
        '${{ secrets["REVIEWDOG_TOKEN"] }}',
        "${{ SECRETS.REVIEWDOG_TOKEN }}",
        "${{ SeCrEtS [ 'REVIEWDOG_TOKEN' ] }}",
        "${{ secrets[env.SECRET_NAME] }}",
    ],
)
def test_validator_rejects_equivalent_diagnostic_secret_expressions(
    tmp_path: Path, secret_expression: str
) -> None:
    module = _load(SCRIPT, "review_channel_secret_expression")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            '          GITEA_TOKEN: ""',
            f'          GITEA_TOKEN: ""\n          STOLEN: {secret_expression}',
            1,
        )
    )

    with pytest.raises(module.ContractError, match="secret bindings"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


def test_validation_error_redacts_hardcoded_token_value(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    sentinel = "gto_LIVESECRET1234567890abcdef"
    workflow.write_text(
        workflow.read_text().replace("${{ secrets.REVIEWDOG_TOKEN }}", sentinel)
    )

    result = subprocess.run(
        [
            "uv",
            "run",
            "python",
            str(SCRIPT),
            "validate",
            "--config",
            str(root / ".cognovis/pr-review.yaml"),
            "--repo-root",
            str(root),
        ],
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 1
    assert sentinel not in result.stdout + result.stderr


def test_validator_forbids_publish_checkout(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_publish_checkout")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            "    steps:\n      - uses: https://data.forgejo.org/actions/download-artifact@",
            "    steps:\n      - uses: https://github.com/actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n      - uses: https://data.forgejo.org/actions/download-artifact@",
            1,
        )
    )

    with pytest.raises(module.ContractError, match="six allowlisted steps"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


def test_publish_initializes_only_empty_git_metadata(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_empty_metadata")
    workflow = module._load_workflow(
        FIXTURES / "python/.github/workflows/pr-lint.yml"
    )
    script = workflow["jobs"]["publish"]["steps"][2]["run"]
    artifact = tmp_path / "lint-reviewdog.txt"
    artifact.write_text("example.py:2:1: error F002: added violation\n")
    runner_temp = tmp_path / "runner-temp"
    runner_temp.mkdir()

    result = subprocess.run(
        ["bash", "-e"],
        cwd=tmp_path,
        input=script,
        text=True,
        capture_output=True,
        env={"PATH": os.environ["PATH"], "RUNNER_TEMP": str(runner_temp)},
        check=False,
    )
    tracked = subprocess.run(
        ["git", "ls-files"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=True,
    )

    assert result.returncode == 0, result.stderr
    assert (tmp_path / ".git/HEAD").is_file()
    assert tracked.stdout == ""
    assert artifact.is_file()


def test_validator_rejects_tracking_artifact_in_publish_metadata(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_tracked_metadata")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            "git -c init.templateDir= init --quiet .",
            "git -c init.templateDir= init --quiet .\n          git add lint-reviewdog.txt",
        )
    )

    with pytest.raises(
        module.ContractError, match="empty reviewdog metadata initialization"
    ):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


def test_publish_uses_nofilter_without_git_checkout(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_publish_nofilter")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace("-filter-mode=nofilter", "-filter-mode=added")
    )

    with pytest.raises(module.ContractError, match="reviewdog publish script"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


def test_downloaded_diagnostic_guard_rejects_unsafe_paths(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_artifact_guard")
    root = FIXTURES / "python"
    workflow = module._load_workflow(root / ".github/workflows/pr-lint.yml")
    script = workflow["jobs"]["publish"]["steps"][1]["run"]
    diagnostics = tmp_path / "lint-reviewdog.txt"
    diagnostics.write_text("src/example.py:1:1: error F401: unused import\n")

    safe = subprocess.run(
        ["bash", "-e"], cwd=tmp_path, input=script, text=True, check=False
    )
    diagnostics.write_text("../secret.txt:1:1: error X1: unsafe path\n")
    unsafe = subprocess.run(
        ["bash", "-e"], cwd=tmp_path, input=script, text=True, check=False
    )
    diagnostics.write_text("x" * 262145)
    oversized = subprocess.run(
        ["bash", "-e"],
        cwd=tmp_path,
        input=script,
        text=True,
        capture_output=True,
        check=False,
    )

    assert safe.returncode == 0
    assert unsafe.returncode != 0
    assert oversized.returncode != 0
    assert "exceeds 262144 bytes" in oversized.stderr


def test_validator_requires_action_installed_reviewdog_path(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_reviewdog_path")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            'reviewdog_path="$RUNNER_TEMP/reviewdog/bin/reviewdog"',
            'reviewdog_path="$(command -v reviewdog)"',
        )
    )

    with pytest.raises(module.ContractError, match="reviewdog path script"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


def test_bun_registry_token_is_confined_to_dependency_job(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_bun_token_boundary")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "bun-typescript", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            '          GITEA_TOKEN: ""\n        run: |\n          lint_status=0',
            '          GITEA_TOKEN: ""\n          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n        run: |\n          lint_status=0',
        )
    )

    with pytest.raises(module.ContractError, match="secret bindings"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


def test_bun_dependency_job_rejects_pr_head_checkout(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_bun_pr_head_dependencies")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "bun-typescript", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            "ref: ${{ github.event.pull_request.base.sha }}",
            "ref: ${{ github.event.pull_request.head.sha }}",
            1,
        )
    )

    with pytest.raises(module.ContractError, match="trusted base SHA"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


def test_bun_dependency_artifact_is_restored_into_node_modules(tmp_path: Path) -> None:
    module = _load(SCRIPT, "review_channel_bun_dependency_path")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "bun-typescript", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            "      - uses: https://data.forgejo.org/actions/download-artifact@9bc31d5ccc31df68ecc42ccf4149144866c47d8a\n"
            "        with:\n"
            "          name: bun-dependencies\n"
            "          path: node_modules",
            "      - uses: https://data.forgejo.org/actions/download-artifact@9bc31d5ccc31df68ecc42ccf4149144866c47d8a\n"
            "        with:\n"
            "          name: bun-dependencies",
            1,
        )
    )

    with pytest.raises(module.ContractError, match="dependency artifact download"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)


@pytest.mark.parametrize(
    ("action", "v3_sha", "v4_ref"),
    [
        (
            "upload-artifact",
            "ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5",
            "https://data.forgejo.org/forgejo/upload-artifact@5d5d22a31266ced268874388b861e4b58bb5c2f3",
        ),
        (
            "download-artifact",
            "9bc31d5ccc31df68ecc42ccf4149144866c47d8a",
            "https://data.forgejo.org/forgejo/download-artifact@c850b930e6ba138125429b7e5c93fc707a7f8427",
        ),
    ],
)
def test_validator_rejects_v4_artifact_actions_for_instance_profile(
    tmp_path: Path, action: str, v3_sha: str, v4_ref: str
) -> None:
    module = _load(SCRIPT, f"review_channel_v4_{action}")
    root = tmp_path / "repo"
    shutil.copytree(FIXTURES / "python", root)
    workflow = root / ".github/workflows/pr-lint.yml"
    workflow.write_text(
        workflow.read_text().replace(
            f"https://data.forgejo.org/actions/{action}@{v3_sha}",
            v4_ref,
            1,
        )
    )

    with pytest.raises(module.ContractError, match="artifact"):
        module.validate_repository(root / ".cognovis/pr-review.yaml", root)
