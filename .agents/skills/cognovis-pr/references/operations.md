# Review-channel operations and evidence

## Live verification

Use one implementation pull request and record identifiers plus verdicts only:

1. Pull request URL and candidate SHA.
2. Automatic `/describe` and `/review` comment identifiers on open, and automatic
   review evidence after a synchronized commit.
3. Authorized writer `/review` and `/improve` command and response identifiers.
4. One deliberate changed-line lint violation, its Actions run and inline finding,
   then the next clean synchronization and passing run.
5. Webhook removal with zero new delivery, then restoration with a successful
   delivery. Separately record an emergency anchored deny and restored default.
6. The deterministic redacted audit and a tracked-file credential scan verdict.

The `/describe` result must preserve the human-authored body, add a useful
walkthrough, and include Mermaid only when the authoring rule is satisfied.
Never record prompts, diffs, comment bodies, headers, keys, or customer data.

## Normal operation

New commits reach PR-Agent through the signed `pull_request_sync` event,
not a bare `push` event. Writers may request `/review` or `/improve` in a pull
request comment. Reviewdog replaces changed-line findings on each Actions run;
the clean synchronization proves stale findings can be cleared.

## Disablement and restore

Normal per-repository disablement removes that repository's webhook. Confirm no
delivery for a new authorized test comment, while other repositories remain
untouched. Before disablement, retain a protected full-state snapshot and the
central HMAC provenance/hash proof without logging the HMAC value. Restore by
recreating the same signed webhook with `active=true`, the original target and
JSON content type, and exactly `pull_request`, `pull_request_sync`, and
`issue_comment`; source the HMAC from the approved central location.

Never send an `active`-only hook PATCH. Forgejo may replace omitted events with
its `[push]` default. If an approved operation uses PATCH instead of delete and
recreate, both the disable and restore request must carry the full config and
exact event list. After restoration, GET the hook, construct a redacted
projection containing only `active`, `events`, `config.url`,
`config.content_type`, and the central-source/hash-match booleans, then run:

    uv run --script <resolved-skill>/scripts/review_channel.py restore-audit \
      --hook-state <projection.json>

Continue only after that deterministic audit passes and a signed test reaches
Atlas admission.

For an emergency central stop, add an anchored `^owner/repository$` expression to
`CONFIG__IGNORE_REPOSITORIES`, render and restart the service, and verify denial.
Remove the expression and restore the prior list after the check. This central
deny is not the normal activation switch and requires the infrastructure owner.

Removing repository membership and deleting the Actions secret are independent
revocation steps. Each is an external write and requires the applicable mandate.
