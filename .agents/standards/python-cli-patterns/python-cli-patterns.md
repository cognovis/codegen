---
domain: python-cli-patterns
description: Python CLI tool conventions — project structure, versioning, release through the cognovis-release transport or public PyPI, config resolution, update hints, packaging.
---

# Python CLI Patterns

> **Scope**: Loaded by Python development and testing skills that build or
> maintain command-line tools published to a package index. Covers project
> layout, release route, runtime config resolution, distribution, and update UX.

## What This Standard Covers

| File | Topic |
|------|-------|
| [project-scaffold.md](project-scaffold.md) | Directory layout and `pyproject.toml` template |
| [versioning-release.md](versioning-release.md) | Generic CalVer, tag-driven GitHub Actions release and Trusted Publishing for public tools off the transport |
| [forgejo-registry.md](forgejo-registry.md) | Private distribution via the Forgejo PyPI registry — publication through the transport, install/upgrade on target machines |
| [config-resolution.md](config-resolution.md) | Platform config paths, `key_command`, lazy click context |
| [distribution-packaging.md](distribution-packaging.md) | Hatchling `force-include`, package vs import names, `install-skill` |
| [update-and-ux.md](update-and-ux.md) | Rich output layer, Click/Rich boundary, version self-check and update execution, shell completion, first-run wizard, output file conventions |
| [test-suite-upkeep.md](test-suite-upkeep.md) | Audit cadence for TDD-grown suites, pytest-xdist, home and git-config isolation, no `uv run` in tests, lint scope |

## When These Patterns Apply

A Python tool is a CLI under this standard when:

- It is invoked by users from a shell (entry point in `[project.scripts]`)
- It is distributed via PyPI (public tools) or the Forgejo registry (private
  tools, see [forgejo-registry.md](forgejo-registry.md)) and installed with
  `uv tool install <name>`
- It may require runtime configuration (API keys, server URLs)

For internal libraries without a CLI entry point, only `project-scaffold.md`
and the release route below apply; the other sub-topics are optional.

## Core Rules

- Use the `src/` layout — prevents accidental local imports during development.
- Release route: a repository whose `.cognovis/repo.toml` declares
  `[[release.package]]`, and every new Cognovis Python package, releases
  through the transport that `cli-versioning` describes. `ccore pr merge`
  lands the pull request and runs
  `cognovis-release landed --repository <checkout> --commit <landed SHA>`;
  the catch-up after a failed or skipped release is
  `cognovis-release <product>`. `cognovis-release` owns the version: a pull
  request bumps no `pyproject.toml` version, writes no CLI `CHANGELOG.md`
  entry and needs no release workflow, and nobody pushes a release tag by hand.
  This holds for a library declared in `[[release.package]]` (for example
  `cognovis-common`) as for a CLI: it carries its transport CalVer series, and
  the `sdk-versioning` pull-request guards `version-bumped` and
  `changelog-entry` do not apply to it. `sdk-versioning` stays authoritative
  for libraries off the transport and for machine-consumed contract versions.
- Pin rule: an exact pin on a sibling package must name a published version;
  the pin bump follows the sibling's release in its own pull request.
- Cognovis repositories without that declaration keep the marked tag-workflow
  contract of `cli-versioning` until they are onboarded. Public tools off the
  transport derive the version from a git tag and CI stamps `pyproject.toml`
  and `__version__`; no `VERSION` file or other source exists.
- Config resolution order: env var → `key_command` → explicit setup hint.
- Version checks are decentralized, update execution is centralized: every
  tool detects staleness and prints the exact
  `uv tool install <package> --force --refresh` line; no tool modifies its own
  installation during a normal command run. Customer-distributed tools on an
  entitlement-gated index are the documented exception.
- Bundle non-Python files explicitly via Hatchling `force-include`.
- Human-facing output goes through Rich; machine-consumable output stays plain
  and Rich-free. Rich does not bind agent- or hook-consumed helper scripts.
- Tests keep only invariants, run in parallel, and never touch the real home
  directory or global git config; review their value once per release train.
