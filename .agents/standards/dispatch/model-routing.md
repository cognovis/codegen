# Model Routing

Model selection for repository delivery is behavioral prompt policy. The initiating
prompt supplies one readable paragraph naming the implementation owner, Reviewer 1,
Reviewer 2, and fallback. Explicit caller wording overrides launcher defaults, provided
the implementation actor remains distinct and the required review perspectives remain
different-family.

STATUS: BEHAVIORAL POLICY. The repository delivery owner follows the role paragraph.
Transport proves session execution, not semantic role compliance. Normal Solo and
Executive Pack progression has no JSON role payload, route resolver, profile registry,
candidate selector, or deterministic model-selection choreography.

## Defaults

Fable is the Claude-family review model. Wherever a Claude-family reviewer or fallback
is named below, it is Claude Fable through the ccore `claude-fable` route (`fable[1m]` on
the native `claude` harness), not Opus. Opus stays a configured route for callers that
name it explicitly; it is no longer a launcher default for review.

For a Codex-owned delivery, use a distinct `gpt-5.6-sol` implementation sub-agent with
medium reasoning, Fable as Reviewer 1, and Grok as Reviewer 2 on the grok harness.

For a Claude-owned delivery, use a distinct Opus implementation sub-agent, a fresh
`gpt-5.6-sol` Reviewer 1 with high reasoning, and Grok as Reviewer 2 on the grok
harness. The implementation model is unchanged by the Fable preference above, which
covers review roles only.

Different-family is measured against the implementation actor. The invariant every
reviewer must satisfy is that its model family differs from the family that produced the
candidate, and that it is a fresh actor that has not touched the candidate. Two reviewers
sharing a family with each other is a loss of perspective diversity, not a violation of
that invariant: the launcher defaults avoid it, a fallback may accept it, and the delivery
owner records the reason in the Bead notes when it does. The complete fallback matrix is:

| Implementer family | Unreachable provider | Replacement |
|---|---|---|
| GPT (Codex-owned) | Fable (Reviewer 1) | Closed. Both remaining families are GPT (same as the implementer) and Grok (already Reviewer 2). Report the provider gap; do not review around it. |
| GPT (Codex-owned) | Grok (Reviewer 2) | Fresh Fable, distinct from the Reviewer 1 session; both reviewers are then Claude-family, recorded as a diversity loss. |
| Claude (Claude-owned) | GPT-5.6-sol (Reviewer 1) | Fresh Fable is not allowed (same family as the implementer). Fresh Grok, distinct from the Reviewer 2 session, recorded as a diversity loss; report the gap when Grok is also unreachable. |
| Claude (Claude-owned) | Grok (Reviewer 2) | Fresh `gpt-5.6-sol` with high reasoning, distinct from the Reviewer 1 session, recorded as a diversity loss. |

A caller that names another implementation family, for example Grok, applies the same
two rules: the replacement differs from the implementer's family and is fresh. In
particular, `gpt-5.6-sol` with high reasoning is an allowed Reviewer 1 fallback for any
non-GPT implementer when Fable is unreachable, and a fresh Fable fallback is allowed for
any non-Claude implementer. A row that reads "report the gap" ends the review, not the
invariant: provider absence never becomes approval.

Grok reaches its reviewer role through `--harness grok`, not through Cursor. Cursor as a
transport has delivered answers since 2026-09-04, but Fable through Cursor has not; see
"Reviewer route status" below before treating any cursor-hosted model as a review option.

These are launcher defaults, not a registry. A compatible caller may name other actors
in the paragraph. It may not make the repository delivery owner the implementation
actor, reuse one actor for required distinct perspectives, or turn provider absence into
approval.

## Transport boundary

Agent-shell work uses the installed ACPX dispatcher with an exact adapter, advertised
model ID, reasoning effort, stable session, linked worktree, complete prompt file,
permissions, and unique event and answer files. A route names an adapter, never a shell
fragment. A review has no turn budget.

The `ccore agent run` default of `approve-reads` grants only read-only tools and
no shell, so it cannot implement, repair, or run verification. The implementation
owner and every reviewer that executes tests or git therefore dispatch with an
explicit `--permissions approve-all`; the CLI confines that grant to a linked
worktree and refuses it in a main checkout. Code reviewers receive worktree-confined
`approve-all` so they can run verification while remaining behaviorally read-only;
a purely reading perspective may stay on `approve-reads`. Agentic acceptance needs
no caller flag: `ccore acceptance run` owns its validator permissions itself.

Persistent prompt execution is the default. One-shot execution requires an explicit
transport choice. A zero exit, terminal stop reason, and non-empty answer prove transport
completion only. Missing output, unavailable providers, or a non-passing semantic result
return control to the delivery owner and never authorize progression.

### Model identifiers

A route names a canonical model; what an adapter accepts is a
verified dispatch input. The two are sometimes the same string and sometimes not,
and which case applies is not something a caller can read off the alias.
`ccore model resolve grok-4.6 --via cursor` returns the bare `grok-4.6`, which
dispatches unchanged because ACPX normalizes it to the one advertised bracketed
identifier that matches it. So the caller takes the dispatch input from
`ccore model resolve <alias> [--via <agent>]`, whose deterministic table carries a
verification date per entry, instead of deciding which case applies. Guessing an
identifier from a provider CLI, a marketing name, or memory is not a substitute for
that lookup, and neither is assuming the alias must be rewritten.

The rules below were verified by live dispatch on 2026-08-17. A rule without such a
date is unverified and does not belong here.

- The cursor adapter advertises bracketed identifiers through its `model` configuration
  option, for example `grok-4.6[effort=high,fast=true]`.
  ACPX normalizes a bare name only when exactly one bracketed variant matches it.
  Provider-CLI identifiers, such as the `cursor-grok-4.6-high-fast` and `auto` values
  that `agent models` prints, are rejected with ACP error `-32602`. (2026-08-17)
- A persistent ACPX session keeps the model it was last set to, so the caller passes
  `--model` explicitly on every dispatch rather than relying on session state.
  (2026-08-17)

## Reviewer route status

This section records what has actually been dispatched, so a delivery owner does not
discover at Reviewer 2 that no second family is reachable. It is operator policy prose,
not a machine-resolved routing table: read it, then choose. A route absent from here is
unverified, and an unverified route is not a reviewer.

Grok observations below were made on 2026-08-26 against ccore 2026.8.35 (build
c7d7fda3972b32), ACPX 0.13, cursor-agent 2026.08.11-e8db854, and Grok Build 1.0.5.
Fable and Cursor observations were made on 2026-09-04 against ccore 2026.9.2, ACPX
0.13.1, cursor-agent 2026.08.25-3e8eec8, and Claude Code 2.1.260 on yakushido.

### Fable: transport-verified Claude-family reviewer route

`ccore agent run --model claude-fable` resolves to `fable[1m]` on the native `claude`
harness. On 2026-09-04 it returned a terminal answer with `stop_reason: end_turn` on two
hosts: a macOS workstation whose Claude Code holds a Claude Max OAuth login, and
yakushido, whose Claude Code authenticates through an `apiKeyHelper` against the cliproxy
endpoint. Both observations were single-word probes (`PONG`) under `deny-all`
permissions, so they prove reachability of the route, not review quality; a review
dispatch still carries worktree-confined `approve-all` as the transport boundary
requires. The route is the only Fable dispatch that has answered on this fleet.

One host caveat, not a route limit: Claude Code reads a user-level `apiKeyHelper` only
from `~/.claude/settings.json`. A helper placed in `~/.claude/settings.local.json` applies
only when the working directory is the home directory, so a dispatch from any repository
worktree fails with `Failed to authenticate: OAuth session expired and could not be
refreshed`. The remedy is an operator edit of the user settings file; ccore does not work
around it.

### Grok: verified reviewer family

Grok accepts reasoning effort `low`, `medium`, `high`, and `xhigh`, and rejects `max`.
That matrix was verified by ccore-x0n.

The installed route applies the effort through the `GROK_CONFIG` environment variable,
which ccore merges as `models.default_reasoning_effort` before launching the agent. It is
not applied by an ACP `set model` `_meta` call: ACPX 0.13 sends only `modelId` on set
model and does not forward `_meta`, so that route cannot carry reasoning effort even
though Grok Build implements `set_model` itself. It is also not applied by a
command-line flag. ACPX launches the plain argv `grok agent stdio`, so although the Grok
CLI does expose `--reasoning-effort`, the installed route never passes it, and a caller
who reasons from that flag will mispredict what the dispatch does.

The historical `-32601` came from none of those. ccore-x0n records it against the retired
`acpx grok-build set reasoning_effort` call, which reaches ACP
`session/set_config_option`, a method Grok Build does not implement for effort. That call
is gone, which is why nothing in the current route sets effort over ACP at all.

A caller therefore passes `--reasoning` to `ccore agent run --harness grok` and lets ccore
put it into `GROK_CONFIG`; there is no acpx `set` call to reach for, and a missing one is
not a defect. Confirmed on 2026-08-26: the ACP session record for a dispatched turn
carries `modelId: grok-4.6` with `reasoningEffort: xhigh` (and `high` on a second run),
and ccore's evidence contract reports `reasoning_setup_status: applied` with
`reasoning_source: grok_config`.

Grok qualifies as a Reviewer 2 family for both a Claude-led and a Codex-led delivery.
It is a third provider family, distinct from Anthropic and from OpenAI, so it satisfies
the different-family requirement in either direction without collapsing a perspective.

One account caveat, not a capability limit: on 2026-08-26 four dispatches reached the
model and then ended with `stop_reason: error` and
`API error (status 402 Payment Required): Grok Build usage balance exhausted`. Transport
and effort application were sound; the account balance was not. An exhausted balance
yields an empty answer, and an empty answer returns control to the delivery owner. Note
that ccore surfaces this as a bare `ACPX exited 1:` with no detail, so the operator reads
the actual cause from the raw ACP stream under `~/.acpx/sessions/<session-id>.stream.ndjson`.

### Cursor: transport verified, Fable gated

On 2026-09-04 the persistent-session dispatch `ccore agent run --harness cursor`
completed `sessions ensure`, `set model`, and a prompt turn on yakushido with cursor-agent
logged in. Two exact advertised ids returned a terminal answer with `stop_reason:
end_turn`:

- `claude-opus-5[thinking=true,context=300k,effort=high,fast=false]`
- `gpt-5.6-sol[context=272k,reasoning=medium,fast=false]`

Both Fable ids, `claude-fable-5-1[thinking=true,context=300k,effort=high]` and
`claude-fable-5[thinking=true,context=300k,effort=high]`, completed the same transport
steps and returned the single agent message `Check your settings to continue` with
`stop_reason: end_turn` and zero token usage. The raw ACP stream carries that text as an
ordinary `agent_message_chunk` from the agent, after `set model` succeeded, so it arrived
through the same transport path as the answers above. The same reply has been reported by
other ACP clients for Anthropic models on some Cursor accounts. Its cause is not
established here and is outside this standard; until a Fable dispatch through Cursor
returns a real answer, Fable through Cursor is not a reviewer route, and Fable's
transport-verified route is the native `claude` harness above.

A verified Cursor transport does not by itself make a cursor-hosted model a launcher
default. Grok keeps its `--harness grok` route, and Reviewer 2 for both delivery families
stays Grok. A caller who names a cursor-hosted Opus 5 or GPT-5.6 reviewer must still keep
the different-family invariant against the implementation actor.

The two conditions recorded on 2026-08-26 did not reproduce on this host: cursor-agent
was logged in, and the persistent-session spawn reached the ACP handshake. The earlier
pre-handshake failure, `ACP agent exited before initialize completed ... Device not
configured (os error 6)`, was observed on a different host and cursor-agent build; its
ruled-out set lives in clc-c2lt, which still owns either recording a verified cursor
reviewer route with an effort value or dropping Cursor from the reviewer options.

Two ccore transport findings from that diagnosis belong to ccore-8el, not to this
standard: ccore's native ACPX path never sets or forwards `--no-terminal`, and ccore
discards the provider error detail when ACPX exits non-zero.

## Ownership

- The repository delivery owner chooses and prompts actors, sequences Beads, evaluates
  findings, owns callbacks, and invokes Session Close.
- The logical implementation owner remains stable for source changes and every
  accepted repair. In normal serial execution, fresh sessions take over only from a
  compact clean committed handoff; optional Sub-Pack receipt bindings remain fixed.
- A fresh Reviewer 1 context supplies bounded member-diff and affected-interaction
  coverage in an Executive Pack.
- Reviewer 2 supplies the complete different-family final adversarial perspective over
  the whole Pack.
- Agentic acceptance, security, and applicable project-specific checks remain distinct
  evidence perspectives and never repair source.

Transport telemetry is operational evidence only. Usage reports keep uncached input,
cached input, and output separate when those values exist, mark missing classes
unavailable, and never estimate or double count them. Role quality, perspective
quality, finding severity, and repair decisions remain caller-owned judgment.
