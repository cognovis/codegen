# Forgejo review-channel adoption

## Trust boundary

Adopt only for the administrator-approved private repository and its named
trusted writers. Before any write, audit current collaborators, hooks, Actions
secret names, and runner availability; present the exact additions and rollback
to the administrator judge. Never expose values during the audit.

Use two identities:

- Persistent PR-Agent: repository `Admin`, not site admin, with `read:user`,
  `write:repository`, and `write:issue`; membership only in activated repositories.
- Reviewdog: repository `Write`, repository-restricted `write:repository` and
  `write:issue`; one `REVIEWDOG_TOKEN` Actions secret, never reused by PR-Agent.

Repository `Admin` is an operational exception, not a generic least-privilege
claim. The proven Forgejo 16 pilot returned 403 for the collaborator-permission
lookup when this dedicated identity had repository `Write`, and 200 with
repository `Admin`. Keep the account out of non-activated repositories and never
grant site administration. Re-audit this role when Forgejo permission behavior
changes; the three token scopes remain the smallest proven pilot scope set.

## Complete persistent channel

Repository activation is one signed webhook targeting
`https://pr-agent.cognovis.de/api/v1/gitea_webhooks`. Select `pull_request`,
`pull_request_sync`, and `issue_comment` only. Do not select bare `push`. The Atlas guard
authenticates the signature, forwards automatic `/describe` and `/review`, runs
configured review behavior on the pull-request synchronized activity, and admits
writer `/review` and `/improve` comments after permission lookup.

Forgejo delivers pull-request timeline commands through the `issue_comment`
subscription family. The Atlas guard performs the repository and pull-request
checks before forwarding the compatible event to PR-Agent. The live first-consumer
proof supersedes the earlier unproven `pull_request_comment` assumption.

Do not add a per-pull-request PR-Agent Actions workflow: it cannot serve later
interactive comments. Do not change the central Atlas service, model, guard, or
credentials as repository adoption work. Automatic fixes and automatic merges
remain outside the contract.

## Reviewdog adapters

All adapters emit `file:line:column: error CODE: message`. The credential-free
diagnostics job resolves `skill://cognovis-pr/scripts/changed_line_filter.py`,
derives added ranges from the base-to-head zero-context diff with external diff
and text conversion disabled, requires paired diff file headers, consumes hunk
line counts before recognizing another header, and uploads only matching
diagnostics. Diagnostics whose paths cannot use the safe portable artifact schema
are omitted and counted without exposing their content. The isolated
publish job then uses `gitea-pr-review` with `filter-mode=nofilter`; it needs no
checkout or source tree. It initializes only an empty, untracked metadata
repository with system/global Git configuration and templates disabled, then
receives the separate reviewdog token on the repository's audited runner. The
repository config owns that runner label; the portable contract does not
prescribe one universal runner.

- Bun/TypeScript: install with the repository's locked Bun path, expose an
  optional registry secret only to that install step, and capture the existing
  lint command's parseable diagnostics.
- Python: run pinned Ruff through `uvx` over the pull request's changed Python
  files with JSON output and pipe it through the
  `skill://cognovis-pr/scripts/python_diagnostics.py` resource. Resolve that URI
  from `<repo>/.agents`, `<repo>/.claude`, Library source, `~/.agents`, then
  `~/.claude`. The adapter makes Ruff's absolute filenames repository-relative
  and emits diagnostics only; it omits source content and fixes.

For Python, declare the exact pinned command as
`uvx --from ruff==0.16.5 ruff check --select E9,F --output-format json <changed-python-files>`;
the adapter materializes the placeholder as a safely separated argument list.
The workflow listens for `opened`, `reopened`, `synchronize`, and `edited`, skips
drafts, checks out the exact PR head without persisting credentials, and uses
qualified immutable action revisions. Cross-job handoff uses the fully qualified,
pinned v3 `actions/upload-artifact` and `actions/download-artifact` actions. This
compatibility profile deliberately rejects v4: the installed Forgejo server and
runner do not provide the v4 artifact service. The Python collector invokes Ruff once,
accepts its findings exit code, validates one JSON document, and hard-fails tool
errors. The trusted changed-line filter excludes untouched legacy findings before
the artifact boundary. Reviewdog's fail level decides the published job result
without consulting the pull-request worktree or diff.

Keep `REVIEWDOG_TOKEN` out of every job that executes the PR-head adapter,
Python, Ruff, Bun, or dependency lifecycle code. The diagnostic job clears the
injected Forgejo and GitHub token variables, runs the Python adapter with
`uv run --no-project`, and uploads diagnostics only. A dependent job without a
PR-head checkout installs reviewdog from its pinned action, resolves that trusted
action-installed executable, downloads and bounds the diagnostic artifact to
safe repository-relative lines, initializes only empty Git metadata for reviewdog
project discovery, and gives the token only to the allowlisted final reviewdog
command. A Bun registry token is confined to a separate dependency job that
checks out the trusted pull-request base SHA and disables lifecycle scripts;
its artifact is restored explicitly into
`node_modules` in the token-free lint job, so `bun run lint` never shares a job
with `NPM_TOKEN` or runs while the registry token is bound. Pull-request code still runs on the selected
self-hosted runner; that residual is accepted only for the approved private-
repository, named-writer boundary.
Validate both repository config and workflow structurally with the resolved
helper before activation.
