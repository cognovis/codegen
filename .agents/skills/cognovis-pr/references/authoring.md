# Pull request authoring contract

## Required human-authored content

Use an outcome-led title that names the observable result rather than the work
activity. Keep the body compact while retaining these sections:

1. **Problem and desired state**: state what was missing or unsafe and the state
   this pull request establishes.
2. **Material changes**: name behavior, interfaces, configuration, operations,
   and documentation that changed. Omit file-by-file narration.
3. **Executable evidence**: list commands and live checks that were actually run,
   with their verdicts. Label pending live checks as pending rather than inferred.
4. **Known residuals**: name remaining risk, external configuration, staged
   rollout, or intentionally excluded behavior. Write `None known` when empty.

PR-Agent `/describe` may append its generated walkthrough, but it must preserve
the human-authored decision context above. Review the generated text for false
claims before treating it as evidence.

## Mermaid decision rule

Add a Mermaid diagram only when it makes a material relationship easier to
understand: a sequence with three or more dependent steps, a state transition,
a hierarchy, or one source affecting three or more consumers. Do not add a
decorative diagram for a list of files or a single linear action. When used, the
diagram must label real system boundaries and agree with the prose.

Record the decision in the body as either `Diagram: included — <relationship>`
or `Diagram: omitted — prose is clearer for <reason>`. A generated diagram is
not executable evidence.

## Lifecycle boundary

This skill prepares and evaluates pull request content. It does not invent a
second transport or lifecycle:

- `ccore pr ensure` creates or updates the pull request.
- Canonical Ccore Session Close owns delivery choice, integration, merge,
  terminal landing, push, and cleanup.
- Review comments and Actions findings are inputs to that lifecycle, not a
  replacement for its candidate-bound review or verification gates.
