# Forgejo Registry (private distribution)

Public PyPI is for public tools. Private Cognovis CLI tools are published to
the Forgejo PyPI package registry on `git.cognovis.de` and installed from
there with `uv tool install` — no git checkout and no repository credentials
needed on the target machine.

## When to Use

- The tool is private (`LicenseRef-Proprietary`, internal repository).
- The tool must be installable and upgradable on machines that have no access
  to the source repository (servers, CI, third-party machines).

Public tools keep the generic PyPI + Trusted Publishing flow from
`versioning-release.md` — this file replaces that flow for private tools.
`cli-versioning` owns their version and release route; this page supplies the
private-index mechanics.

## Publish

Registry endpoint (owner is the Forgejo org or user, usually `cognovis`):

```text
https://git.cognovis.de/api/packages/cognovis/pypi
```

A repository whose `.cognovis/repo.toml` declares `[[release.package]]`
publishes through the release transport. After `ccore pr merge` lands a pull
request, `cognovis-release landed` builds each affected package and calls the
repository's release script, which uploads to this endpoint with credentials
that `cognovis-release` supplies. The catch-up is `cognovis-release <product>`.
No developer or pull request uploads by hand, and the repository holds no
upload token. A repository without that declaration publishes through the
marked tag-workflow contract of `cli-versioning` until it is onboarded.

Re-uploading an identical version is rejected. Do not upload with bare
`curl -F content=@...`: Forgejo validates the full PyPI upload form including
`sha256_digest` and rejects partial forms with `400 hash mismatch`.

## Install on a target machine

One-time setup: register the index and credential. The credential is a
read-only package token — repository access is not required.

```toml
# ~/.config/uv/uv.toml
[[index]]
url = "https://<user>:<token>@git.cognovis.de/api/packages/cognovis/pypi/simple"
```

Then:

```bash
uv tool install <package>
uv tool upgrade <package>        # real version semantics, unlike git sources
```

Ad-hoc without config:

```bash
uv tool install \
  --index-url "https://<user>:<token>@git.cognovis.de/api/packages/cognovis/pypi/simple" \
  <package>
```

## Why not `uv tool install git+https://...`

- Repository credentials on every target machine, per repository.
- No clean upgrade semantics: uv only re-resolves the ref, there is no
  version comparison, so `uv tool upgrade` does not work as expected.
- The registry path gives one index and one token for all private tools.
