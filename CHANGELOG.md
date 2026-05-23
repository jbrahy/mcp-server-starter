# Changelog

All notable changes to the MCP Server Template Suite are documented in this
file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Version scope:

- Versions tag the suite as a whole (shared foundation + the set of
  released language templates). A new template language is a minor
  version bump; a backwards-incompatible change to the shared compliance
  matrix or to a released template's contract is a major version bump.
- Until the first `1.0.0` release, breaking changes may land under
  `0.x` minor bumps without a major bump.

## [Unreleased]

### Added

- Repository governance scaffold: monorepo directory layout
  (`templates/`, `shared/`, `scripts/`), `README.md`, `CODEOWNERS`,
  `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE`,
  `.gitignore`.
- `shared/docs/`: five canonical cross-template contract documents —
  `00-overview.md`, `01-transport.md`, `02-security-baseline.md`,
  `03-observability.md`, `04-config-and-logging.md`. Establishes
  stdout/stderr discipline, HTTP `127.0.0.1` default bind, Origin
  allowlist semantics, structured log schema (`ts`, `level`, `msg`,
  `request_id` as ULID, …), secret-redaction pattern list, and the
  per-template contract checklist. (DOCS-01..DOCS-05)
- MCP 2025-11-25 compliance matrix: `shared/compliance-matrix.yaml`
  (machine-readable source of truth, ten sections covering protocol,
  transports, capabilities, errors, progress/cancellation, log schema,
  surface, security, smoke probes, and Inspector commands);
  `shared/compliance-matrix.md` (generated human-readable view);
  `shared/example-surface.yaml` (byte-locked canonical tool `add`,
  resource `example://greeting`, prompt `greet`);
  `shared/compliance-matrix.schema.json` and
  `shared/example-surface.schema.json` (JSON Schema draft-2020-12
  contracts, tool-agnostic for future-language ports);
  `scripts/generate-matrix-md.ts` (idempotent TypeScript generator
  run via `tsx`, validates inputs via Ajv 2020-12 on every run);
  root `package.json` and `package-lock.json` for the generator's
  dev dependencies. (MATRIX-01..MATRIX-04)

### Changed

- `shared/docs/01-transport.md`, `shared/docs/02-security-baseline.md`,
  `shared/docs/03-observability.md`,
  `shared/docs/04-config-and-logging.md`: Conformance sections now
  reference real category-prefixed compliance-matrix checkpoint IDs
  (`XPORT-NN`, `SEC-NN`, `LOG-NN`, `PROG-NN`) in place of the
  `TBD-MATRIX-XX` placeholders shipped in Phase 2. (MATRIX-01)

### Deprecated

### Removed

### Fixed

### Security
