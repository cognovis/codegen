# Developing contributions for Atomic Codegen

Apply this project standard when changing the generator, TypeSchema, runtime helpers, public configuration, or an upstream PR. It records our working rules derived from maintainer feedback through 2026-09-15; it is not an upstream policy declaration or a claim that the referenced proposals are merged. Check live upstream state before using a proposal as an implementation baseline. Existing repository authorization and verification rules still apply.

## 1. Agree on observable behavior before choosing a mechanism

Start with a small, preferably real-package example: its StructureDefinition or TypeSchema input, the generated code, and the expected compile-time or runtime result. Separate a supported use case from an extension of the product contract. Multiple package roots do not imply support for simultaneous versions of the same package; the current supported direction selects one version per package name.

Distinguish correctness feedback, an API/design choice, and a genuinely unsupported requirement. Preserve the accepted part of a contribution when repairing the disputed part. The maintainer explicitly accepts the factory widening and required arguments in #224; the disagreement concerns the getter's promise, not the need for the factory fix.

## 2. Preserve established defaults and vocabulary

Use a scoped option for a new consumer requirement when existing output remains valid. For example, Node ESM consumers select `moduleSpecifierStyle: "node-esm"`; they do not require changing every consumer's default. Name and document an intentional breaking correction explicitly.

Keep existing terms attached to their established meanings. `Flat` is already factory/setter input. A getter correction should not rename that input contract or add another exported type solely to preserve a convenient symmetry.

## 3. Put semantics in their existing owner

Look for an existing resolver or normalized model before adding a helper. Put language-neutral facts in package processing, register, or TypeSchema; let writers render those facts. Use TypeSchemaIndex resolution for specialization and family identity, existing predicates for schema kinds, and Canonical Manager patches for input-package repairs.

Avoid a second TypeScript-only terminology model, repeated resource-name inference, or a runtime wildcard where generation already knows the concrete resource family. Keep source identity, matching identity, and generated member names distinct: an extension URL or raw slice name is not its camelCased property key.

## 4. Generated types must describe runtime guarantees

Derive a factory argument from the fields needed to construct valid output. Derive a getter result from the fields extraction actually writes, including the possibility of incomplete external input. A resource being invalid does not justify typing an absent field as present.

```typescript
// Factory/setter input keeps its required fields.
type Flat = { id: string; note: string; detail?: string };

// Extraction writes only sub-extension fields it finds, never the ordinary id.
type Extracted = Partial<Pick<Flat, "note" | "detail">>;
```

Treat the example's `Extracted` as notation, not a requirement to add an exported symbol; the getter can use the expression directly. Cover both profile-backed and profile-less inline generation. If an honest getter type makes `set(get()!)` fail to compile, document the required completion of input or the supported raw/profile round trip rather than widening away the error.

## 5. Keep independent FHIR rules independent

Use declared schema information rather than inferring a contract from the shape of an instance. For constrained values, distinguish absence, declared scalar/array arity, matching inside one value, and a constraint applying to every repetition. One matching category must not hide another invalid category. Containment inside a `coding` array is a different operation from validating every repeating category.

Keep requiredness, fixed/pattern matching, choice-type ceilings, slice membership, and slice cardinality separate. A slicing rule must not reopen a type excluded by an inherited explicit choice constraint. Do not claim exact `fixed[x]` equality when the implementation still uses pattern containment; isolate that behavior change and its evidence.

## 6. Test the generated consumer contract

Use the smallest tests that prove the affected behavior. A snapshot documents output; successful generator execution or output compilation alone cannot detect a getter whose type promises a missing value. For public type changes, exercise the generated module and its referencing parent, then pair valid consumer code and expected compile errors with the relevant runtime assertions.

Select boundary cases relevant to the change: absent/null/empty values, correct and incorrect arity, mixed valid/invalid repetitions, required and optional inputs, inherited profiles, and profile-backed/inline paths. For naming changes, include raw versus normalized names, reserved names, and collisions. Assert unchanged adjacent behavior as well as the original failure.

Use real FHIR/package evidence for a claimed production defect. Clearly label synthetic defensive hardening when the trigger cannot occur through the real input pipeline. Review snapshot changes semantically before accepting them. Run the repository's existing required checks and affected generated examples; documentation-only edits do not require regenerating code or rerunning the generator suite.

## 7. Recover only when the generated contract remains sound

For a recoverable naming or representation collision, follow the writer's diagnostic convention, identify the profile canonical and conflicting members, and choose a deterministic, safe representation. A raw representation can remain usable when a typed convenience surface cannot be represented faithfully. Do not abort an entire package solely because one such convenience surface collides.

This is not permission to swallow invalid input, invent a type, silently drop required data, or emit uncompilable output. When there is no sound recovery, fail with a precise diagnostic. Missing dependencies and ambiguous package identities still need explicit handling.

## 8. Check transformations and shared state across boundaries

These are lessons from our compatibility audit, not established maintainer decisions: output tree shaking must not accidentally narrow which external references the unchanged FHIR schema permits; per-builder option objects do not prove isolation of the package cache they share. Test the behavior before and after pruning, and across successive cached runs when making either claim.

Likewise, preserve the declaring package and version while resolving inherited nested types and slice-only dependencies. Prefer a specific schema-derived correction with a positive and negative example over restoring a broad wildcard or a consumer-specific special case.

## 9. Make the patch easy to assess and retire

Create new upstream contributions from the current upstream baseline and transfer only the required source change, regression evidence, and generated artifacts. Keep Cognovis distribution and agent-tooling changes out of those PRs. Existing published branches retain additive history unless the user explicitly authorizes rewriting it.

Keep one behavior change per contribution. Make the failure, correction, and resulting generated difference independently visible in logical commits; keep generated/example updates separate and last. Avoid incidental refactoring, exported symbols, dependency changes, or documentation renames. Follow the repository's module-prefixed PR titles, concise change bullets, and before/after examples for API/config changes.

When upstream replaces our mechanism, compare behavior against our regression cases and remove the redundant implementation from the new integration. Keep only the demonstrated residual difference. An open replacement PR is a separate comparison target, not upstream `main`; closing the original PR does not deliver its replacement. Wait on overlapping work where useful, without stopping unrelated work on already merged upstream code.

## Evidence and limits

| Evidence | Lesson supported |
| --- | --- |
| [#151 package-version discussion](https://github.com/atomic-ehr/codegen/pull/151#issuecomment-4358948397) | Distinguish one selected version per package from a broader resolution model. Revisit the historical decision if the supported contract changes. |
| [#196 choice and slicing review](https://github.com/atomic-ehr/codegen/pull/196#issuecomment-5068567807) | Keep explicit choice restrictions and slicing checks independent. |
| [#210 terminology review](https://github.com/atomic-ehr/codegen/pull/210#issuecomment-5601630704), [#218](https://github.com/atomic-ehr/codegen/pull/218) | Normalize language-neutral terminology in the shared pipeline. |
| [#219](https://github.com/atomic-ehr/codegen/pull/219), [#225](https://github.com/atomic-ehr/codegen/pull/225), [#227](https://github.com/atomic-ehr/codegen/pull/227) | Preserve module defaults, reuse TypeSchemaIndex, and expand explicit resource families. |
| [#228](https://github.com/atomic-ehr/codegen/pull/228) | Pass declared arity, test every repetition, separate fixed equality from containment, and show baseline/fix/output evidence. |
| [#224 maintainer review](https://github.com/atomic-ehr/codegen/pull/224#issuecomment-5666107890), [#229](https://github.com/atomic-ehr/codegen/pull/229) | Preserve accepted factory inputs, type getters as extraction, cover parent and inline paths, and report recoverable collisions. |
| [Local upstream compatibility audit](../upstream-sync-2026-09-15.md) | Remaining reference-pruning and shared-cache limitations; these observations do not establish the maintainer's intended contract. |

Keep live PR states, commit identities, and unresolved defects in the integration report or work item rather than turning them into permanent rules here. Apply the rules proportionately to the changed behavior; this standard adds no approval gate or permission to publish, close, merge, or rewrite branches.
