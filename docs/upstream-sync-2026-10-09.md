# Upstream synchronization — 2026-10-09

## Scope and source identities

At the start of this synchronization, fork `main` was `8fd1a7888769934e596b9ffd2e9c6265d70c3425`. The integration target is the upstream release tag `v0.0.21`, which resolves to `5de74e15bdc216aead6f33550f3193e20546734a`; the merge is `2d0363fc324fd05e4bfe71decb41090de0382534`. The merge base is upstream `c7f95a4dcc9193a6234e95fdd266c66313fe4d6d`, which is where the previous synchronization left the integration, and the delta is exactly 35 commits (`git rev-list --count c7f95a4d..5de74e15` = 35).

The tag commit, not `upstream/main`, is the integrated baseline. `upstream/main` was `b16a0952f1d27c6f2127a0f8d63c8d27b8d49f07` at the time of this synchronization, which is ahead of `v0.0.21`; commits after the tag are deliberately out of scope here. After the merge both `git merge-base --is-ancestor 5de74e15 HEAD` and `git merge-base --is-ancestor a3b4e3c9 HEAD` succeed.

The merge keeps the Cognovis distribution identity `@cognovis/codegen` at version `0.2.4`, the npm.cognovis.de publish pipeline, the Bun CLI shebang, and the `git-cliff` changelog tooling. This synchronization does not publish and does not change the package version or the `CHANGELOG.md` release metadata; a release is a separate step with its own evidence.

## What the delta contains

| Area | Upstream commits | Disposition |
| --- | --- | --- |
| Virtual R4 `Base` nested elements (PR #236) | `a3b4e3c9`, merged as `ce277371`, refined by `f6a9fb7c`, `ab564be3`, `eacc4591` | Use upstream. The fork delta is retired; see the reconciliation section. |
| `@atomic-ehr/fhir-canonical-manager` 0.0.27 → 0.0.28 | `026b5121` | Use upstream. `bun.lock` resolves `0.0.28` with integrity `sha512-kWGhl/9kvp5Dpemc5FRSQu+dP8XCeOxwYfrWXIhY0YnqEfSLH46hMJpWgyeH3u2/VE6uDyE0Le1u+LLTTGP3ag==`. |
| Python rootless pydantic model root | `aeeb42d2`, `9d899084` | Use upstream. No fork counterpart. |
| Python complex-extension `vflat` getter | `f75f3fe7`, `19c07d65`, `303a58c5` | Use upstream. The fork's own complex-extension overrides were already dropped at the previous synchronization in favour of #229/#231. |
| Python colliding accessor names | `b42b592f`, `292bfe0e` | Use upstream. Unrelated to the fork's deterministic *TypeScript* profile names, which group module and class names per package rather than accessor names within one profile. |
| Python package barrels | `ddcd99db`, `5805c402`, `cc2ba4b4`, `6e46be4b` | Use upstream. No fork counterpart. |
| Python nested backbone element typing | `fa19df65`, `60de24ba`, `9fd9dfab` | Use upstream. It consumes the nested TypeSchema index, which the fork's specialization-owned nested base types still own; the combination is exercised by the regenerated Python example and its mypy run. |
| Python reference-family comment | `4d7eaa4e`, `2c3920da`; `97c8a1e8` drops the TypeScript imports from the Python generator | Use upstream. No fork counterpart. |
| TypeScript and Python repeating-reference checking | `3ddd6b7d`, `b7ec6cde`, `97be33de`, `2f8050f9` | Use upstream. The fork's only remaining delta in `src/api/writer-generator/typescript/profile-validation.ts` is the `tsProfileClassName(tsIndex, …)` signature of the retained deterministic-name work, so there is no semantic overlap. |
| Version bump to 0.0.21 | `5de74e15` | Discarded for the `version` field only; the Cognovis release lineage owns it. |

## Conflict resolution

The merge produced exactly one conflicted path.

| Path | Category | Resolution |
| --- | --- | --- |
| `package.json` | Overlay path (`overlay-allowlist`) | Resolved in favour of the Cognovis side for the two fields the overlay owns — `name` stays `@cognovis/codegen` and `version` stays `0.2.4` — while everything else stays upstream's. The `dependencies` hunk merged cleanly and keeps upstream's `@atomic-ehr/fhir-canonical-manager: 0.0.28`. The resolved file's entire delta from `5de74e15:package.json` is `name`, `version`, and the overlay's `prepare` script; there is no `allowScripts` field. |

Everything else merged without a conflict, including `src/typeschema/utils.ts`, where upstream's `effectiveResource` population and the fork's nested-owner ranking live side by side. No new unclassified path appeared: `scripts/apply-cognovis-overlay.sh --audit` classifies all 290 paths of the fork diff into exactly one category. The one new file this synchronization adds, this report, is classified as non-overlay in `COGNOVIS.md` — both in the prose table and in the `non-overlay-patterns` block.

## Virtual R4 `Base` reconciliation

The fork carried the nested virtual-`Base` behaviour as its own commit: an element type that is the virtual R4 `Base` is treated as having no resolvable structure, the nested type stays representable with `base: undefined`, the field-type warning is suppressed for it, and unrelated unknown types still fail. The real trigger is `de.cognovis.fhir.dental@0.53.0` failing with `Failed to resolve FHIR Schema: ...Base`.

Upstream merged that contribution as PR #236 (merge commit `ce277371b55355440b083f661d6d13a4c268406a`, 2026-09-25) carrying the fork's own commit `a3b4e3c99eefe639c706a5856f6260f69efdadbd` unchanged, then refined it with `f6a9fb7c` (a new write-generator test for what a `Base`-typed element generates), `ab564be3` (its snapshots) and `eacc4591` (trimmed test comments). `ce277371` is an ancestor of `v0.0.21` and was not an ancestor of the `c7f95a4d` merge base, so the behaviour arrives with this merge.

Equivalence was established before the merge, by comparing the fork head's files against `a3b4e3c9`'s versions of the same files:

- `src/typeschema/core/nested-types.ts`, `src/typeschema/ir/logic-promotion.ts` and `test/unit/typeschema/transformer/logical-base.test.ts` were byte-identical.
- `src/typeschema/core/field-builder.ts`, `src/typeschema/types.ts` and `src/typeschema/utils.ts` differed only by additions unrelated to `Base` — upstream's `effectiveResource`/`abstractResource` reference work, which landed between `2cd28e09` and `c7f95a4d`, and the fork's nested-owner ranking. Every line `a3b4e3c9` contributed was present verbatim; the diffs contained no removal of a `Base`-related line.

After the merge the result is stronger than equivalence: the files are identical to the upstream release. `git diff 5de74e15 HEAD -- <path>` is empty for `src/typeschema/core/field-builder.ts`, `src/typeschema/core/nested-types.ts`, `src/typeschema/ir/logic-promotion.ts`, `src/typeschema/types.ts`, `src/typeschema/register.ts`, `test/unit/typeschema/transformer/logical-base.test.ts`, `test/unit/typeschema/transformer/expected-values-logical-nested-base.json`, `test/api/write-generator/logical-base-element.test.ts` and its snapshot file. Nothing was removed by hand, because the merge left no fork-only copy to remove: the single helper is `isVirtualFhirBaseCanonical` in `src/typeschema/register.ts`, used by `nested-types.ts`, `field-builder.ts`, `transformer.ts` and `register.ts` itself, and `grep` finds exactly one definition.

The typed contract survives: `NestedTypeSchema.base` is still `base?: TypeIdentifier`, nested fields of a virtual-`Base` element stay representable, and the unrelated-unknown-type rejection is still asserted. `bun test test/unit/typeschema/transformer/logical-base.test.ts test/api/write-generator/logical-base-element.test.ts` reports 12 passed, 0 failed, 5 snapshots, 21 assertions — the upstream-refined comments and snapshots, not a weakened copy.

## Retained fork divergence after the merge

The whole remaining source delta against `5de74e15` is 12 files: `src/api/builder.ts`, `src/api/generate-config.ts`, `src/api/writer-generator/typescript/{name,profile,profile-slices,profile-extensions,profile-validation,writer}.ts`, `src/cli/index.ts`, `src/typeschema/index.ts`, `src/typeschema/utils.ts` and `src/utils/log.ts`. `src/api/writer-generator/python/**` and `assets/**` carry no fork delta at all.

| Divergence | Disposition | Where |
| --- | --- | --- |
| Builder-scoped dependency pins | Retain | `src/api/generate-config.ts` — a builder's `forceDependencies` replaces the global map for that builder. |
| One-version-per-package multi-root generation | Retain | `src/api/builder.ts` (root conflicts, resolved-dependency drift) and `src/typeschema/index.ts` (duplicate canonicals across concrete package versions fail). |
| `#packageVersionMismatch` diagnostic tag | Retain | `src/utils/log.ts`. |
| Deterministic TypeScript profile names | Retain | `src/api/writer-generator/typescript/name.ts` plus the `tsProfileClassName(tsIndex, …)` threading through `profile.ts`, `profile-slices.ts`, `profile-extensions.ts`, `profile-validation.ts` and the collision report in `writer.ts`. |
| Specialization-owned nested base types | Retain | `src/typeschema/utils.ts` nested-owner ranking, on top of upstream's `collision-order.ts`, which is now an upstream file. |
| Profile factories and constraints | Retain the integrated baseline | No separate implementation; upstream #228/#229/#231 own the current behaviour. |
| Bun CLI shebang | Overlay, retain | `src/cli/index.ts` line 1, reapplied by the overlay script. |
| Tree-shaken nested and slice-match reference targets | Retired as a fork delta | Upstream merged PR #234 as `5e6c820bccd908246bb6e85e5c49dc1db912ed4b` on 2026-09-24, already an ancestor of the `c7f95a4d` merge base. `src/typeschema/ir/tree-shake.ts` has no fork delta. `COGNOVIS.md` listed it as retained and open; that was stale from the previous synchronization and is corrected. |
| Virtual R4 `Base` nested elements | Retired as a fork delta | Upstream PR #236, as described above. |

Upstream PR #207 is closed without merging, so the maintainer slice-fact refactor is not part of `v0.0.21` and nothing in the fork depends on it.

## Checks

Run in the delivery worktree on the merge result, in this order. Test runs go through the host's `fleet-test-run` resource boundary.

- `bun install`: 133 packages installed; `bun.lock` was already consistent with the merged `package.json` and needed no change. The lock resolves `@atomic-ehr/fhir-canonical-manager@0.0.28`.
- `scripts/apply-cognovis-overlay.sh --audit`: AUDIT PASSED. 290 paths classified — 18 overlay, 272 pending-upstream or machine-local — with no path matching neither or both category.
- `scripts/apply-cognovis-overlay.sh --verify`: VERIFY PASSED. The changed path set after a fresh apply is a subset of the allowlist, no `src/typeschema/` or `src/api/writer-generator/` path is touched, and no `allowScripts` field appears here or in the applied tree.
- Sync-gate regression surface (`test/unit/api/writer-generator/typescript/profile-slices.test.ts`, `test/unit/typeschema/field-builder.test.ts`, `test/api/write-generator/typescript.test.ts`): 44 passed, 0 failed, 17 snapshots, 256 assertions.
- `bun run typecheck`: passed.
- `bun run lint`: passed. 165 files checked, no fixes applied and no warnings — the three Python warnings and the Biome configuration deprecation recorded in the previous report are gone.
- `bun test`: 599 passed, 0 failed, 119 snapshots, 3961 assertions across 67 files.
- `bun run build`: passed. `dist/cli/index.js` is 198.59 KB and starts with `#!/usr/bin/env bun`; `dist/index.js` is 368.96 KB and `dist/index.d.ts` is 45.22 KB. The bundled CLI reports version `0.2.4`.
- `make all` (`test`, `test-multi-package`, `test-typescript-r4-us-core-example`, `test-typescript-custom-packages-example`, `lint-unsafe`, `test-all-example-generation`): exit 0, 743 passed and 0 failed in total. `biome check --write --unsafe` applied no fixes over 166 files.
- Focused retained-behaviour surface: `nested-owner-order`, `collision-order`, TypeScript `name`, `generate-config` and `profile-nested-choice-base` together report 61 passed, 0 failed; the multi-root pair reports 14 passed, 0 failed.

The most informative result is what `make all` did *not* produce: after regenerating every example pipeline — TypeScript R4 US Core, TypeScript custom packages, the four on-the-fly examples including CCDA, C#, Mustache and Python R4 US Core — plus SQL-on-FHIR through `test-multi-package`, the working tree held no generated-file change at all. The Python example churn this delta was expected to cause arrived inside the merge as upstream's own regenerated output, and the landed generators reproduce it byte-for-byte. Every snapshot change in the diff of this synchronization therefore comes from an upstream commit that also changed the generator that produces it, which is what makes accepting them a review rather than a rubber stamp.

## Residual risk

The Canonical Manager shared-cache caveat is carried forward unchanged and was **not** re-measured against `0.0.28`. Builders with isolated `forceDependencies` maps still share Canonical Manager's on-disk cache, whose key did not include patches at `0.0.26`; successive builders with identical roots and the same working directory can reuse the first patched manifest. The published `0.0.28` package ships no changelog, so no claim is made either way. Callers that change pin maps between runs still need separate working directories or a cache reset.

The reference-projection limitation recorded for PR #227 is unchanged: family expansion is effective only while the required family membership remains in the TypeSchema index, and tree shaking can narrow the emitted runtime validation list. Upstream's new repeating-reference check validates every entry of a repeating reference element against that same list, so it inherits the limitation rather than repairing it.

Two further things are deliberately not covered here. The registry artifact and the real cognovis-fhir consumer generation — acceptance criteria 3 and 4 of the work order — are a separate release step; this report covers the integration only, and the published `latest` dist-tag and all consumer pins are untouched. And `upstream/main` is ahead of `v0.0.21`: integrating the released tag means the commits after it, whatever they are, remain a later synchronization's subject.
