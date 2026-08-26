# Cognovis codegen fork

`main` is the sole Cognovis integration branch. It is based on the [atomic-ehr/codegen `main`](https://github.com/atomic-ehr/codegen/tree/main) baseline at `f724a661` (v0.0.18) and carries exactly two kinds of change, which are kept strictly separate:

- a **distribution overlay** — package identity, publish registry, Bun shebang, and changelog tooling. These are permanent fork properties that will never be sent upstream.
- **pending upstream contributions** — generator and CLI fixes that live on `main` only until atomic-ehr merges them. These are ordinary fork commits, never overlay paths.

Everything in this repository that differs from upstream is one or the other. A change that fits neither category does not belong on `main`.

## Branch topology

`main` is the only integration branch. It tracks the upstream baseline and is published as `origin/main`.

`cognovis/next` is **retired**. It carried the discarded canonical-resolver package, superseded open-choice work, and historical docs and tooling commits that were deliberately not retained when `main` was rebuilt on the upstream baseline. Its final head `854441ed` is preserved in the local safety ref `backup/cognovis-next-final`; the earlier `backup/cognovis-next-prerebase` ref (`ed38d129`) is kept as well. Do not branch from either — they are recovery refs, not integration branches.

Consumer snapshot branches, including `cognovis/consumer-dist`, remain independent historical branches and are outside this contract.

## The overlay contract

1. **Overlay paths are an allowlist.** Any path that differs from upstream is either on the allowlist below, or it is a pending upstream contribution. There is no third category.
2. **The apply script is the overlay.** `scripts/apply-cognovis-overlay.sh` is the executable form of this document. Hand-editing `package.json` after an upstream sync is not the overlay and will be lost.
3. **Generator sources are never overlay paths.** Nothing under `src/typeschema/` or `src/api/writer-generator/` may appear in the overlay. A generator change is by definition an upstream contribution, and the apply script refuses to write such a path.

### Overlay allowlist

This block is machine-readable and is the single source of truth. `scripts/apply-cognovis-overlay.sh` parses it directly, both to decide what it may write and to check itself; editing the prose around it changes nothing.

```overlay-allowlist
package.json
.gitignore
.github/workflows/ci.yml
.github/workflows/release.yml
scripts/release.sh
scripts/apply-cognovis-overlay.sh
scripts/sync-upstream.sh
cliff.toml
CHANGELOG.md
COGNOVIS.md
src/cli/index.ts
tsup.config.ts
```

### How each path is applied

| Path | Mode | What the overlay owns |
|---|---|---|
| `package.json` | patch | `name` (`@cognovis/codegen`), the `prepare` script, and `allowScripts` — and nothing else. Dependencies and version stay upstream's; the release script owns the version. Because the overlay deliberately does not own dependency ranges, the [`brace-expansion` security bump](#dependency-security-bump) is **reset to upstream's range by a fresh apply** until an upstream pull request carries it. There is deliberately **no `allowScripts` field** — see [npm 12 and git installs](#npm-12-and-git-installs) — and `--verify` asserts it stays absent here and in the applied tree. |
| `.gitignore` | patch | Appends `.intake/`. The `Library-managed project installs` block is not reapplied: although it is committed on `main` — the agent tooling writes it in place — it enumerates per-machine install paths, so a fresh apply deliberately drops it and `library` regenerates it on whatever machine next installs those files. |
| `.github/workflows/ci.yml` | patch | The consumer smoke-test import, `@atomic-ehr/codegen` to `@cognovis/codegen`. Upstream keeps ownership of the job matrix. |
| `.github/workflows/release.yml` | copy | The whole publish pipeline: `npm.cognovis.de`, the `@cognovis` scope, `COGNOVIS_NPM_TOKEN`, and the GitHub release step. Upstream edits to this file are intentionally discarded. |
| `scripts/release.sh` | copy | Version derivation and `git-cliff` changelog generation. Supersedes the upstream script. |
| `scripts/apply-cognovis-overlay.sh` | copy | The overlay applicator itself. It is an overlay path for the same reason as every other entry here: it differs from upstream, it will never be sent upstream, and contract decision 1 leaves no third category. Copying it means a fresh upstream checkout plus the overlay can reapply and re-verify itself without this repository. |
| `scripts/sync-upstream.sh` | copy | The upstream sync runbook in executable form (see [Syncing with upstream](#syncing-with-upstream)). Fork-only for the same reason as the applicator: upstream has no upstream to merge from. |
| `cliff.toml` | copy | Changelog configuration. Does not exist upstream. |
| `CHANGELOG.md` | generated | Allowlisted so it is never mistaken for an upstream file, but **not written by the apply script** — `git-cliff` regenerates it during a release. |
| `COGNOVIS.md` | copy | This contract. Does not exist upstream. |
| `src/cli/index.ts` | patch | **Line 1 only**: the `#!/usr/bin/env node` shebang becomes `#!/usr/bin/env bun`. This is the single `src/**` path in the overlay; it is permitted because the file's entire delta from upstream is that one line, and the Bun runtime choice is a distribution decision that upstream will not take. Contract decision 3 still holds — it is not a generator path, and the apply script writes nothing else in this file. |
| `tsup.config.ts` | patch | The shebang written into the bundled CLI, likewise `node` to `bun`. |

### npm 12 and git installs

`main` carried `"allowScripts": ["@atomic-ehr/codegen"]` from `18ffacf0` until codegen-81z, on the belief that npm 12 reads the field to admit this package's own `prepare` build during `npm install -g git+<url>#<ref>`. Measured against npm 12.0.2, it does not, in three independent ways:

- **Wrong consumer.** `lib/utils/resolve-allow-scripts.js` reads `allowScripts` from the *root project* at `npm.prefix`, and skips that layer outright when `npm.global` is set. A dependency manifest never authorizes its own scripts, and a `-g` install consults no project manifest at all.
- **Wrong shape.** The field is an object map of spec to boolean, `{"pkg": true}`. An array parses to `{"0": "pkg"}`, whose value is a string rather than `true`, so the matcher counts it as neither allow nor deny. In a project-scoped install of a dependency with a `postinstall`, the array form behaves exactly like having no field at all, while the object map is honoured.
- **Not the gate anyway.** For a git dependency, `prepare` is run by pacote's `DirFetcher`, which gates on `ignore-scripts` alone and never consults the policy. The build produces `dist` in the clone before the tarball is packed, with or without the field.

What actually blocks a git install on npm 12 is a different setting: `allow-git` now defaults to `none`, so the install fails with `EALLOWGIT` before any script question arises. The working command is

```bash
npm install -g --allow-git=root git+https://github.com/cognovis/codegen.git#main
```

Do **not** add `--allow-scripts` to it. In a global install the flag is accepted, but it is inherited by the project-scoped install pacote runs inside the clone to prepare the git dependency, and that install rejects it with `EALLOWSCRIPTS` — which is the error `18ffacf0` was reacting to. The field it added in response was inert; removing `--allow-scripts` is what makes the install work.

### Deliberately not in the overlay

These paths differ between `upstream/main` and `main`, and each one is excluded on purpose:

| Path | Why it is not overlay |
|---|---|
| `README.md` | Documents the terminology generator options — pending upstream contribution (#210). |
| `CLAUDE.md` | Documents sliced-choice validation and Node ESM import emission — pending upstream contribution (codegen-g5s, codegen-wgn, codegen-nud). |
| `tsconfig.json` | `resolveJsonModule` exists to support the CLI version fix that reads `package.json` — pending upstream contribution, not distribution identity. |
| `bun.lock` | Derived from `package.json`; regenerate with `bun install` after applying the overlay. |
| `.library.lock` | Machine-local agent tooling state. Never part of a distribution. |
| `.intake/` | Machine-local scratch directory; ignored, never committed. |
| `src/typeschema/**`, `src/api/writer-generator/**` | Forbidden by contract decision 3. |
| `src/api/generate-config.ts` | The generate-command and terminology configuration surface (commits `d0a133fa`, `7f84b9ea`, `895cd636`) — pending upstream contributions #210 and #211. Its terminology keys are explicitly not being sent upstream as configuration, but the file is still generator surface, not distribution identity. |
| `src/cli/commands/**`, `test/**`, `assets/**`, `examples/**` | Generator and CLI behavior plus its evidence — all pending upstream contributions. |

The table above is prose for humans. The block below is its machine-readable form: glob patterns for every path that may legitimately differ from upstream without being overlay. `--audit` classifies the real fork diff against the allowlist and these patterns together, and fails on any path matching neither — that is what makes "no third category" an executable rule rather than an assertion.

```non-overlay-patterns
CLAUDE.md
README.md
tsconfig.json
bun.lock
.library.lock
src/typeschema/*
src/api/writer-generator/*
src/api/generate-config.ts
src/cli/commands/*
test/*
assets/*
examples/*
```

## Pending upstream contributions

Fork commits on `main` that carry generator or CLI behavior. They are temporary: each one leaves `main` when upstream merges it. None of them may be added to the overlay allowlist.

### Open pull requests

| PR | Subject | Commits on `main` |
|---|---|---|
| [#208](https://github.com/atomic-ehr/codegen/pull/208) | Preserve profile inputs and slice accessors. Keeps a required `Coding` slice with only a fixed system from being treated as a fully fixed `CodeableConcept`. | `63e43b0a`, `51240167` |
| [#209](https://github.com/atomic-ehr/codegen/pull/209) | Support a virtual FHIR `Base` for logical models. | `fa823b92` |
| [#210](https://github.com/atomic-ehr/codegen/pull/210) | Opt-in per-package terminology surfaces: CodeSystem completeness rules, ValueSet expansion exclusion, package provenance. | `d0a133fa`, `7f84b9ea`, `9512e709`, `437c6612` |
| [#211](https://github.com/atomic-ehr/codegen/pull/211) | Config-driven `generate` command for the CLI. | `895cd636`, `9fd5c3f9`, `e21e0cd4` |

The earlier claim that no upstream pull request existed for `63e43b0a` is obsolete — that correction is #208.

### Not yet submitted

Delivered on `main` with no upstream pull request. This is a deliberate decision (2026-08-25) to let the open PRs land first, not an oversight. They are fork commits awaiting upstream PRs, and they are the reason `main` is not simply "upstream plus the overlay" today.

| Work | Subject | Commits on `main` |
|---|---|---|
| codegen-g5s | Validate sliced choice components with at-least-one semantics (TypeScript), including multi-variant choice groups. | `a0cdafbd`, `49e2ffb4`, `17080759` |
| codegen-wgn | Emit `.js` extensions on relative imports so generated output loads under Node ESM. | `acd2583c`, `cc1610a2` |
| codegen-nud | The same at-least-one sliced-choice validation for the Python generator. | `62ba36ba`, `d99accc8`, `ba38ce4a` |

### Dependency security bump

The `brace-expansion` bump to `^5.0.9` in both `dependencies` and `overrides` (`ebd6fb36` on `main`) is **already submitted**: every one of the four open pull requests carries it, so whichever lands first takes it upstream.

| PR | Commit carrying the bump |
|---|---|
| #208 | `028cc3a3` chore: update brace-expansion security fix |
| #209 | `ebd6fb36` — the same commit that is on `main` |
| #210 | `a2ed7ab2` chore: bump brace-expansion to 5.0.9 for bun audit |
| #211 | `7ca104c0` chore: bump brace-expansion to 5.0.9 for bun audit |

It is called out separately because it has a consequence the other contributions do not: the overlay deliberately does not own dependency ranges, so applying the overlay to a fresh `upstream/main` checkout returns `brace-expansion` to upstream's `^5.0.8`. Until one of those pull requests merges, reapply the bump after a resync and rerun `bun install`.

## Applying the overlay

Run from this repository against a clean checkout of the upstream baseline:

```bash
scripts/apply-cognovis-overlay.sh /path/to/upstream-checkout
bun install   # regenerate bun.lock from the patched package.json
```

To prove the overlay still holds — the script builds a pristine `upstream/main` tree in a temporary directory, applies itself, and asserts that the changed path set is a subset of the allowlist above and contains no generator path:

```bash
scripts/apply-cognovis-overlay.sh --verify
scripts/apply-cognovis-overlay.sh --audit   # classify this repository's real diff
scripts/apply-cognovis-overlay.sh --list    # print the parsed allowlist
```

The two checks prove different things and both fail closed:

- `--verify` proves the **applicator**. An unparseable allowlist block, a written path that is not allowlisted, a patch whose pattern no longer matches upstream, any change under `src/typeschema/` or `src/api/writer-generator/`, or an `allowScripts` field reappearing in this repository or in the tree the overlay just produced, exits non-zero.
- `--audit` proves **this repository**. It classifies every path of `git diff --name-only upstream/main HEAD` against the allowlist and the non-overlay patterns, and exits non-zero on any path that matches neither or both. This is the enforcement behind contract decision 1: when a future sync adds a file that nobody has classified, `--audit` fails, rather than this document quietly going out of date.

## Syncing with upstream

`main` is published and carries fork commits, so it is never fast-forwardable from `upstream/main`. A sync is therefore a **merge of `upstream/main` into `main`** — never a rebase of the published branch, and never a force push. `scripts/sync-upstream.sh` is that procedure in executable form; it contains no `rebase` and no `--force`.

Run it from a clean `main` checkout: `--merge` and `--push` refuse any other branch or a dirty working tree, while a dry run reports from anywhere.

```bash
scripts/sync-upstream.sh                 # 1. dry run (default): fetch and report only
scripts/sync-upstream.sh --merge         # 2. merge upstream/main, then run the gate
scripts/sync-upstream.sh --merge --push  # 3. ... and publish main once the gate passed
```

Each step is deliberately separate, and each is safe to stop after:

1. **Dry run.** Fetches `upstream` and reports the checkout, `HEAD`, `upstream/main`, how many commits `main` is ahead (the fork commits listed above) and behind, and whether a merge is needed. It changes nothing in the checkout, but the fetch itself is real: it moves the `upstream/*` remote-tracking refs, which every worktree of this repository shares. Pass `--no-fetch` to report against the refs already on disk — the safer form when reporting from a task worktree.
2. **`--merge`.** Merges `upstream/main` into the current `main` checkout, then runs the gate. The gate is, in order: `scripts/apply-cognovis-overlay.sh --audit`, the focused regression tests, and `bun run build`. It runs after every merge, including a no-op one, so a green run also certifies that the fork classification still holds. Any failing step exits non-zero and leaves the merge local and unpublished.
3. **`--push`.** Pushes `main` to `origin`, plainly. It is reachable only together with `--merge` and only after the gate passed in that same invocation; `--push` on its own is rejected. There is no path through this script that publishes an unverified merge.

The gate's regression surface is `test/unit/api/writer-generator/typescript/profile-slices.test.ts`, `test/unit/typeschema/field-builder.test.ts`, and `test/api/write-generator/typescript.test.ts` — the tests covering the pending upstream contributions most likely to be disturbed by an upstream merge. When one of them fails after a merge, the fork commit it belongs to is listed under [Pending upstream contributions](#pending-upstream-contributions); a failure there usually means upstream reworked the same code and the fork commit needs rebuilding on top, not that the test is wrong.

### When the merge conflicts

The script stops, prints the conflicted paths, and leaves the merge in progress. Nothing has been pushed. Two ways out:

```bash
git merge --abort                 # roll back; main is untouched
# ... or resolve, then:
git add <path>... && git commit
scripts/sync-upstream.sh --merge  # rerun: sees nothing to merge and runs the gate
```

Resolve by category, using the tables above:

- **Overlay paths** (`package.json`, `.github/workflows/release.yml`, …) — resolve in favour of the Cognovis side, or take upstream's and reapply with `scripts/apply-cognovis-overlay.sh`. The apply script is the authority; a hand-merged overlay path is a guess.
- **Pending upstream contributions** (generator and CLI sources, tests, examples) — resolve in favour of the fork commit unless upstream has merged that contribution, in which case take upstream's and drop the fork commit from the table above.
- **A new, unclassified path** — the overlay audit in the gate will fail on it. Classify it in this document first: allowlist it, or record it as a non-overlay pattern. Do not silence the audit.

After a sync that changes `package.json`, rerun `bun install`, and reapply the [`brace-expansion` bump](#dependency-security-bump) until one of the open pull requests carries it upstream.
