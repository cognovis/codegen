# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Transitive package version resolution** in canonical resolver — when a top-level package requires a different version of a transitive dependency than what nested packages expect, the resolver now correctly scans nested `node_modules/<parent>/node_modules/<dep>/` paths to find the correct version, fixing resolution failures for profiles like KBV_PR_Base_Observation_Care_Level that depend on versioned base types
