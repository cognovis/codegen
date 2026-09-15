# Upstream synchronization — 2026-09-15

## Scope and source identities

This local candidate integrates `upstream/main` at `debec3246a07ec3e942e9beb3a038180143b2b8e` into the Cognovis fork at `d2ae11cd97ecd250fed3be57a43e336a94780107`. Their merge base is `12658b04175c19cf4f7468e2544e5a26a2b55a7f`. The candidate is intentionally local: it does not publish, release, land, or update a consumer pin.

The merge keeps the Cognovis distribution identity `@cognovis/codegen` at version `0.2.4`, its build/install/release workflow, and the project-local Library environment overlay. Upstream remains the source of the integrated generator architecture.

## Delta disposition

| Area | Disposition | Result |
| --- | --- | --- |
| Canonical Manager configuration and package repairs | Use upstream | `APIBuilder` accepts loader configuration in `canonicalManager`, applies upstream `builtinPatches`, exposes the input-fix report, accepts a configured `workingDir`, and retains deprecated flat loader options as compatibility aliases with warnings. The fork `skip-hack` implementation and exports are removed. |
| JSON `forceDependencies` | Use upstream mechanism, retain configuration isolation | Pins are Canonical Manager `packageJson` patches. A builder's `forceDependencies` replaces the global map for that builder, so each builder receives the intended patch configuration. Canonical Manager's shared on-disk cache can still reuse an earlier patched manifest as described below. Existing top-level configs remain valid. |
| Profile `resourceType` and family detection | Use upstream | The TypeSchema index resolves the final specialization and owns `isFamilyType`. The redundant fork `profile-resource-type` helper is removed. Resource profiles expose `resourceType`; Extension and datatype profiles do not. |
| Abstract reference validation | Use upstream PR #227 | Abstract family targets expand to concrete member resource types. The generated US Core Provenance surface and regression fixture are integrated. The tree-shaken family limitation described below remains. |
| In-memory generation and test package caching | Use upstream | In-memory writers neither clean nor write output directories, and static assets respect the same setting. The upstream serial-by-default test runner and isolated patch-test cache are integrated. |
| Multi-root package generation | Retain fork | One builder emits a flat shared output tree with collision-safe package directories and relative imports. Repeated identities deduplicate. Different exact versions of one requested root are rejected, resolved exact dependency drift is reported, and duplicate canonicals from concrete package versions fail instead of silently collapsing. |
| Virtual R4 `Base` | Retain fork | Logical nested elements whose R4 `Base` is virtual remain representable and resolvable while unrelated unknown types still fail. |
| Inherited nested tree shaking | Retain fork | Nested dependencies resolve through inherited fields while preserving their exact package-qualified identity. |
| Slice-match dependencies | Retain fork | Dependencies used only by slice match values remain in the shaken graph and resolve in the declaring package context. |
| Node ESM generated output | Use upstream option, retain the fork example selection | Upstream owns the `moduleSpecifierStyle` option. The Cognovis US Core example continues to select `node-esm`, so its regenerated indexes keep `.js` module specifiers while adding upstream's Provenance exports. |
| Existing profile factory and constraint behavior | Retain the fork baseline | The candidate keeps the factory input/default behavior already present at fork SHA `d2ae11cd` and the pre-PR-#221 array-wrapping constraint implementation. It does not import newer implementations from pending PR #228, pending PR #229, or the later PR #224 repair. |

## Compatibility changes

Loader settings now belong under `canonicalManager`. Existing `registry`, `dropCanonicalManagerCache`, `patches`, `preprocessPackage`, `packageIndex`, `ignorePackageIndex`, and `manager` constructor fields remain accepted as deprecated compatibility spellings where upstream provides an equivalent. Supplying both a grouped setting and its flat alias is rejected instead of choosing one silently. A caller that injects a prebuilt Canonical Manager or register continues to own its loader wiring.

The public `shouldSkipCanonical` and `skipList` exports are removed with the old `src/typeschema/skip-hack.ts` mechanism. Package defects are now expressed with Canonical Manager patches, including `excludeCanonical`, and the built-in patch set is the default for builders that construct their own manager.

Config-driven dependency pinning still accepts top-level `options.forceDependencies`. The fork-only per-builder field remains supported and replaces the global map for that builder. The patch maps are isolated in configuration, but Canonical Manager `0.0.26` does not include patches in its on-disk cache key. Successive builders with identical roots and the same `workingDir` can therefore reuse the first builder's processed, pinned manifest even when the next builder selects a different pin map. Use separate Canonical Manager working directories or reset the cache between differently pinned runs. This behavior was reproduced on both the pre-merge fork at `d2ae11cd` with Canonical Manager `0.0.24` preprocessors and the integration candidate with `0.0.26` package patches, so it is a pre-existing limitation rather than a new merge regression.

Generated resource-profile descriptors now derive `resourceType` through the TypeSchema specialization chain. Code that relied on the internal `profile-resource-type` helper must use the generated descriptor or TypeSchema index; that helper was redundant and is no longer part of the source tree.

## Comparative behavior

Pure upstream `debec324` passes its own baseline: `bun run typecheck`, `bun run lint`, and `bun test` complete with 472 tests passed, 0 failed, 940 assertions, and 108 snapshots. Lint reports the three existing Python warnings and the Biome configuration deprecation.

Running the fork's existing regression seams against pure upstream exposes behavior that the integrated candidate must retain:

- Multi-root and version checks: 5 of 8 selected cases pass and 3 fail. The upstream audit copy removed only the obsolete preprocessor-specific test/import and added the new `report()` method to Canonical Manager test doubles; the semantic checks were otherwise unchanged. Pure upstream does not reject competing exact requested root versions, does not warn when an exact declared dependency differs from the resolved closure, and silently selects version `1.0.0` when the same canonical appears in two concrete versions. Compatible ranges/tags, differing declarations that resolve once, compatible declarations without warnings, and the writer-level directory guard pass.
- Inherited tree-shake and slice dependencies: all 5 selected fork cases fail on pure upstream. An inherited `Questionnaire#item.enableWhen` dependency reaches an assertion, an inherited EPS slice loses `Patient`, and the other three checks fail their diagnostic or package-identity expectations.
- Virtual R4 `Base`: the unrelated unknown-type rejection passes, while the nested `DocumentWithNestedBase.extension` case fails to resolve its direct virtual `Base`.
- Abstract reference targets after upstream PR #227: without tree shaking, `Organization/example` is accepted and `NotAResource` is rejected. With tree shaking, both the default and `openResourceTypeSet: true` variants still reject `Organization/example` while allowing `Task/example`; the concrete family membership has been pruned from the TypeSchema index. This is a known upstream reference-projection limitation, not expanded into a fix by this synchronization.

## Downstream consumer evidence

FHIR Management still exercises the retained integration shape in `src/fhir_management/types_generator.py` around lines 925–953: it builds one config from `fromPackages`, `localTgzPackages`, and `localStructureDefinitions`, applies `treeShake`, and supplies `options.forceDependencies`. Its `tests/test_types_generator.py` cases around lines 544 and 1691 include the Praxis `0.101.6` conflict canary and depend on rejecting competing exact private root versions. The supported contract selects one concrete version per package name; it does not promise simultaneous generation of multiple versions of the same package.

This audit did not run a full FHIR Management consumer regeneration. The repository-local checks prove Codegen's seams and preserve the config shape, but they are not end-to-end consumer evidence.

## Pending upstream work and residual risk

PR #228 (`a58076f9e697bd3808c673360b867db018a5cadf`) and PR #229 (`755f5bca1d640ce5fef93e5c93492ef0afaf5e7a`) are open maintainer branches, not part of `upstream/main` at `debec324`. They were tested separately: PR #228 passes 23 targeted profile-constraint tests and PR #229 passes 6 targeted complex-extension tests. Neither branch is merged into this baseline.

The candidate therefore retains the fork's older repeating-value array wrapping and factory/flat-input behavior. These remain real residual differences. PR #229 intentionally types the complex-extension flat getter as an extraction shape using `Partial<Pick<...>>`, so the `setFlat(getFlat()!)` compatibility changes and may break by design; raw/camelCase work is deferred. Its bare collision throw remains in #229 and is handled by the later PR #224 repair rather than by this merge. Those newer changes must be reviewed and integrated through their own upstream or fork delivery rather than being hidden inside this candidate. Upstream PR #221 was closed on 2026-09-15 after its tested replacement was verified in still-open PR #228; that administrative change does not make #228 part of this candidate.

The PR #227 family expansion is effective only while the required family membership remains in the TypeSchema index. Tree shaking can remove members and narrow the emitted runtime validation list. This audit records the limitation without changing reference-projection semantics.

## Candidate verification

The integration uses the existing regression tests as its RED evidence: the failures above reproduce on pure upstream before the fork implementations are retained. No new behavioral test is required for conflict resolution that only ports those established contracts to the upstream APIs.

- `bun run typecheck`: passed.
- `bun run lint`: passed with the three existing Python warnings and the Biome configuration deprecation.
- `bun test`: 530 passed, 0 failed, 108 snapshots, 1103 assertions.
- Focused retained behavior: virtual R4 `Base` 10 passed; inherited tree shaking 39 passed; multi-root and flat output 14 passed; profile/reference/factory 39 passed; Canonical Manager/config/builtin patches 51 passed.
- US Core regeneration, generated-project typecheck, and example suite: 80 passed, 0 failed. The only regenerated delta beyond upstream's new files was the expected `.js` import style in the new Provenance modules.
- `scripts/apply-cognovis-overlay.sh --verify --base-ref upstream/main`: passed.
- Reviewer 1 independently ran 109 tests with 11 snapshots and 260 assertions, including actual Node ESM imports; all passed. The only requested change was correction of the shared-cache isolation claim above.
- The configured acceptance canary returned typed status `not_configured` with exit code 3, so acceptance evidence is N/A for this local library integration.

After the merge commit, `scripts/apply-cognovis-overlay.sh --audit --base-ref upstream/main` fails with 355 unclassified paths, dominated by the repository's pre-existing `.agents`, `.claude`, and `.codex` harness trees, plus `AGENTS.md` and `src/utils/log.ts`. The successful overlay verification proves that applying the declared distribution overlay touches only its 14 allowlisted paths. This synchronization does not broadly allowlist the unrelated audit paths.
