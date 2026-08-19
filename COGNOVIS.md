# Cognovis codegen fork

`main` is the sole Cognovis integration branch. It is based on the current [atomic-ehr/codegen `main`](https://github.com/atomic-ehr/codegen/tree/main) baseline at `f724a661` (v0.0.18) and carries one fork-only correction package.

## Fork-only correction

Commit `63e43b0a` preserves the 2026-08-12 profile-input, CodeableConcept, and collision-safe slice-accessor corrections. It keeps a required Coding slice with only a fixed system from being treated as a fully fixed CodeableConcept, while preserving generated profile inputs and avoiding slice accessor collisions.

No upstream pull request or issue exists for this correction package as of 2026-08-15. The historical canonical-resolver workaround and its related upstream PR history are intentionally not retained on `main`.

## Terminology surface maintenance

The generated per-package terminology surface remains upstream-contributable against the atomic-ehr baseline; it is not maintained as a second fork-only package. Its CodeSystem completeness rules, ValueSet expansion exclusion, NamingSystem canonical handling, and package provenance model are general FHIR code-generation behavior. Cognovis supplies the optional closure verification values from `cognovis-fhir-types.manifest.json`; generators without that manifest record `not-recorded` provenance and retain the same FHIR content rules.

## Branch topology

`cognovis/next` is retired after `main` is published and verified. Consumer snapshot branches, including `cognovis/consumer-dist`, remain independent historical branches and are outside this maintenance operation.
