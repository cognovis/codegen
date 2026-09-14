---
name: cognovis-pr
description: Author Cognovis PR descriptions or maintain the repository Forgejo review channel; ccore owns publication and merge.
requires_standards: [judge-layer]
compatibility: {}
metadata:
  library:
    plane: dev
    runtime_requirements:
      binaries: [git, uv]
    deterministic_script: bundled
action_boundary:
  risk_class: high-risk
  effect_type: credential
  proposal_schema: standard://judge-layer/proposals/action-proposal.v1
  judge: agent://judge-default
  requires_mandate: true
---

# Cognovis Pull Requests

Author clear pull requests and operate the complete repository review channel.

## Inputs

- Repository root, desired outcome, verified evidence, and known residuals.
- For review-channel work, an approved administrator mandate and repository config.

## Outputs

- An outcome-led pull request body or a redacted audit, adoption, verification, or disablement record.

## Workflow

1. Select authoring, audit/adoption, live verification, operation, or disablement and load the matching reference below.
2. For authoring, apply `references/authoring.md`; finish when every required section is evidence-backed and the Mermaid decision has been recorded.
3. For channel changes, require the judge-approved administrator mandate before any credential, membership, secret, or webhook mutation; finish admission only when the exact repository, writes, and rollback are authorized.
4. Resolve this skill local-first (`.agents`, `.claude`, Library source, then global installs), run `uv run --script <resolved-skill>/scripts/review_channel.py validate --config <path> --repo-root <root>`, and resolve every error before adoption or live verification. The script's PEP 723 metadata provisions PyYAML outside a project environment.
5. Run the same resolved helper in `audit` mode and record only its redacted output plus live identifiers and verdicts described in `references/operations.md`. After webhook restoration, also run `restore-audit` on the allowlisted redacted hook-state projection; never accept an `active`-only restore.
6. Delegate pull request creation to `ccore pr ensure` and all merge, terminal lifecycle, push, and cleanup actions to canonical Ccore Session Close.

## Do NOT

- Print or commit secret values, prompts, diffs, customer data, or portable pilot evidence identifiers.
- Add a per-pull-request AI workflow beside the persistent webhook or claim automatic fixes or merges.
- Treat an authoring diagram as mandatory when prose is clearer.

## Resources

| File | Purpose |
|---|---|
| `references/authoring.md` | Pull request title, body, evidence, and Mermaid contract. |
| `references/review-channel.md` | Portable Bun/TypeScript and Python adoption contract. |
| `references/operations.md` | Verification, operation, disablement, and evidence rules. |
| `scripts/review_channel.py` | Deterministic repository validator and redacted auditor. |
| `scripts/python_diagnostics.py` | Ruff JSON to reviewdog diagnostic adapter. |
| `scripts/changed_line_filter.py` | Git-aware added-line filter for credential-free diagnostics jobs. |
