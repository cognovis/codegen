---
name: intake
description: Turn notes, bug reports or initiatives into author-checked beads; continue to delivery when the request authorizes implementation.
requires: [standard:workflow/bead-hygiene, skill:bug-triage, skill:executive-pack, script:triage/query_history]
requires_standards: [workflow/bead-hygiene, writing/plain-technical-english, writing/unslop, writing/unambiguous-english]
---

# Intake

Turn source notes into factory-ready beads. The original request is the authority
source: creating a work order and implementing it are different requested outcomes.
This active session remains the original author; do not delegate authoring. Never
run Bead review automatically; review is a separate explicitly requested action.

## Establish the request

Read the provided source and preserve it in local .intake scratch space. With no
source, ask for the missing input. Before extraction, read
[history.md](references/history.md) and run query_history.py at one of its bounded
paths. Surface duplicate matches before creating another work order.

Classify the requested outcome by meaning:

- author-only: create, file or track work; stop with the created bead.
- author-and-execute: fix, build or deliver the requested change; continue after
  author-check and persistence.
- unclear: ask only the question that decides between those outcomes.

## Approve the boundary

One coherent outcome is one bead; implementation steps are internal work, not
sub-beads. When there is exactly one candidate, a clear target and requested outcome,
no duplicate choice and no competing boundary or Human Decision Gate, record
`approval_source: original_request`. Do not ask for a routine confirmation.

Ask only when multiple plausible candidate boundaries remain, whether to append
to the existing bead or create a new one is unresolved, the target repository is
ambiguous, the requested outcome is unclear, or a product/architecture/policy choice
is needed. Record `approval_source: explicit_hitl` for that decision. Never repeat
approval already given for the same scope.

For bug reports or multiple outcomes/initiatives, read [modes.md](references/modes.md).
Bug signals use the same conditional boundary gate; investigate safely while missing
evidence is pending. Do not turn an initiative into an epic automatically.

## Author and persist

Read [authoring.md](references/authoring.md) for the field contract, including
classification_evidence, AC/MoC, Review-Risk and any genuine Human Decision Gate.
Draft the body inline and validate before bd create or bd update with --body-file.
Probe only <repo>/scripts/bead-author-check.py, then
~/.agents/scripts/bead-author-check.py. If both are missing, report that limitation
and continue without validation; never search the entire filesystem.

Revise validation failures before mutation. Every admitted bead, including chores,
needs exactly one Review-Risk classification: none, payment, pii, auth or compliance.
Use the original source and actual identifiers; do not invent evidence names.
Sync through ccore beads sync with a stable operation ID before a handoff.

## Continue according to authority

Author-only ends after persistence and deterministic validation with the ID and
check result. Author-and-execute invokes executive-pack in solo mode in this active
session; do not ask for another implementation confirmation. That skill owns the
implementation entry path and resolves landing policy from the live bead body.
Author-check failure never dispatches implementation. Manual review findings do not
grant execution authority or upgrade an author-only request.

Report created/updated IDs, duplicate dispositions, validation results and whether
delivery continued. Existing metadata/dependency updates use direct bd commands;
substantive body updates use the same inline author-check without a new intake lifecycle.
