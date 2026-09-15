# Upstream synchronization — 2026-09-15

## Scope and source identities

At the start of this synchronization, fork `main` was `d2ae11cd97ecd250fed3be57a43e336a94780107`. The verified integration contains `upstream/main` at `debec3246a07ec3e942e9beb3a038180143b2b8e`; their merge base is `12658b04175c19cf4f7468e2544e5a26a2b55a7f`, and the reviewed merge is `567c43aa27a07769cce4ebd481378d55b8558a44`. A canary of the integration was published from source commit `84da29b1786fccf09f2d53354e39dfd90044627a` as `@cognovis/codegen@0.2.4-canary.20260915075954.84da29b` so FHIR Management could verify immutable package bytes. The canary accompanies the verified integration selected for fork `main`. Later report and generated-example commits do not change the canary's source identity. The stable `latest` dist-tag remains `0.2.3`, and no consumer pin was updated.

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

The immutable canary has registry integrity `sha512-qDjEIYblL4pFMo3zJ0CVE3HB/h8W5Ien8OaUzmvFxrS8CbS4hsdXBHMAKvR88mvkxwQ2aOa9N58uZI2Kzlk9MA==` and registry `gitHead=84da29b1786fccf09f2d53354e39dfd90044627a`. FHIR Management consumed those exact bytes with a frozen 55-package closure in `fhir-management-graph-manifest.yaml`; the lock SHA-256 is `bd6816bda1b473f48e25ca7dde315c7d67e12e824df8dbc3cd931e3340d1d0f7`. All 16 declared generator inputs were observed without missing or ambiguous entries, and the closure used 63 local archives.

The initial cold and warm stable builds from unmodified FHIR Management both generated and compiled the package, but Node failed with `ERR_MODULE_NOT_FOUND` on an extensionless relative ESM import. FHIR Management publishes `@cognovis/fhir-release` with `"type": "module"` while its generator configuration emitted `typescript: {}`. The consumer repair at `f5bf51029ded1465b0797e842298ea39aff9a2b8` explicitly selects `typescript.moduleSpecifierStyle: "node-esm"`; the runbook plus clarification are committed through `99e6949fcc0a3c3fd13aefaa350f5e502b494cc6`. Codegen's pre-merge fork already supported this option with the same extensionless default, so the repair belongs to FHIR Management and does not change Codegen's default. The independent RED expected `{"moduleSpecifierStyle":"node-esm"}` but received `{}`; the focused GREEN test passed, the affected FHIR Management module passed 125 tests, and Ruff passed.

The repaired cold build can be reproduced with the command recorded in `fhir-management-consumer-verification.json`:

```bash
uv run cognovis-fhir types build --output /tmp/codegen-dru-consumer-84da29b/repaired-cold --codegen-workdir /tmp/codegen-dru-consumer-84da29b/repaired-codegen-workdir --mode stable --base-version 0.3.2 --lock /tmp/codegen-dru-consumer-84da29b/graph-manifest.yaml --pin-ledger /tmp/codegen-dru-consumer-84da29b/pin-ledger.json --codegen-version 0.2.4-canary.20260915075954.84da29b --codegen-resolved @cognovis/codegen@0.2.4-canary.20260915075954.84da29b --codegen-integrity sha512-qDjEIYblL4pFMo3zJ0CVE3HB/h8W5Ien8OaUzmvFxrS8CbS4hsdXBHMAKvR88mvkxwQ2aOa9N58uZI2Kzlk9MA== --json --codegen-command bun /tmp/codegen-dru-consumer-84da29b/codegen-install/node_modules/@cognovis/codegen/dist/cli/index.js generate
uv run cognovis-fhir types verify /tmp/codegen-dru-consumer-84da29b/repaired-cold/package --json
node runtime-reference-probe.mjs /tmp/codegen-dru-consumer-84da29b/repaired-cold/package
```

The repaired cold and warm builds both completed stable generation, TypeScript 5.9.3 compilation, package verification, and the Node runtime probe. Each emitted 2,803 JavaScript files and 2,803 declarations with content digest `sha256:fec30ae01e7ccf4b0037346376ed8607ef25a4e607d3dd390c70e2c19be91627` and identity `sha256:4dfaea028d72c6a1224991d27d514f4e09513fcefae41693721eb4252cca33d6`. Both verifier results are `ok: true` with no findings or unverifiable entries. Their payload inventory hashes match at `6acc08e0a8d5f84f32c938710ca712dd0d2f3bf0bed64289cb694e3e9b23abc2`; only `cognovis-fhir-release.manifest.json` differs because the cold result records `coldCache: true` and the warm result records `coldCache: false`. The warm result is iteration evidence and is not eligible for publication. Because these two runs use the same frozen inputs, their agreement does not establish cache isolation between different pin maps; callers that change pin maps still need the separate working directories or cache reset described above.

The Node probe imported compiled `Basic_KvBudgetFreieLz.js` and confirmed that its generated `Reference<Resource>` validation list exactly matches all 146 concrete R4 resource descriptors. It accepts `Organization/org-1`, `Task/task-1`, and `Endpoint/endpoint-1`, rejects `NotAResource/example`, and excludes abstract `Resource` and `DomainResource`. The real stable consumer path therefore shows complete family coverage without member pruning. The separately documented tree-shaken family limitation remains and is not repaired by this synchronization.

The formal acceptance canary used the cold package and FHIR Management input at `99e6949fcc0a3c3fd13aefaa350f5e502b494cc6`. It returned typed contract `cognovis.agentic-acceptance-canary-result.v1`, status `not_configured`, and exit code 3 because the on-host acceptance authority and dispatch trust keys are absent. This is N/A rather than a gate blocker. Reviewer 1 independently checked the immutable artifact digests, generated inventory, and bounded Node profile behavior for the final consumer input and reported no findings. The complete machine-readable record is `.intake/upstream-audit-2026-09-15/evidence/fhir-management-consumer-verification.json`.

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
- The immutable canary `@cognovis/codegen@0.2.4-canary.20260915075954.84da29b` was generated from source commit `84da29b1786fccf09f2d53354e39dfd90044627a`; registry integrity and `gitHead` matched. The stable `latest` tag remained `0.2.3`.
- Real FHIR Management cold and warm stable generation, compilation, verification, and Node runtime validation passed after the consumer selected `node-esm`. The cold result supplies verified cold-cache evidence for subsequent release verification; no Types package was published. The warm result is iteration evidence only. Reviewer 1 reported no findings for the final `99e6949` consumer input and immutable `84da29b` Codegen bytes.
- The formal acceptance canary returned typed status `not_configured` with exit code 3 because the on-host authority and dispatch trust configuration is absent, so agentic acceptance is N/A rather than a delivery gate blocker.

After the merge commit, `scripts/apply-cognovis-overlay.sh --audit --base-ref upstream/main` fails with 355 unclassified paths, dominated by the repository's pre-existing `.agents`, `.claude`, and `.codex` harness trees, plus `AGENTS.md` and `src/utils/log.ts`. The successful overlay verification proves that applying the declared distribution overlay touches only its 14 allowlisted paths. This synchronization does not broadly allowlist the unrelated audit paths.
