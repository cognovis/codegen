# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2026.04.2] — 2026-04-26

### Fixed

- **`scanNodeModulesPackage` cache-key mismatch** (codegen-pkt) — when packages are added via `APIBuilder.localTgzPackage()` (or the underlying `manager.addTgzPackage()`), the canonical-manager's cache hash is computed from the constructor packages only, NOT including the tgz adds. Codegen however computed `nodeModulesPath` from ALL focusedPackages, so the two hashes diverged and the fallback path pointed to a non-existent directory — silently disabling the codegen-7y9 fix for any setup using `localTgzPackage`. Fix: when the computed `nodeModulesPath` does not exist, scan all sibling cache record directories under `<workdir>/canonical-manager-cache/` and try each one. New test `scanNodeModulesPackage: cache-key mismatch fallback (codegen-pkt)` covers this case.

## [2026.04.1] — 2026-04-26

### Fixed

- **Transitive package version resolution** in canonical resolver (codegen-7y9) — when a top-level package requires a different version of a transitive dependency than what nested packages expect, the resolver now correctly scans nested `node_modules/<parent>/node_modules/<dep>/` paths to find the correct version, fixing resolution failures for profiles like KBV_PR_Base_Observation_Care_Level that depend on versioned base types
