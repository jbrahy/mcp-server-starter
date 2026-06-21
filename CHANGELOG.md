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

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [1.0.0] - 2026-06-21

First release: shared foundation plus the canonical TypeScript MCP server
template, conformant to MCP 2025-11-25.

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
  (machine-readable source of truth), `shared/compliance-matrix.md`
  (generated view), `shared/example-surface.yaml` (byte-locked canonical
  tool `add`, resource `example://greeting`, prompt `greet`), JSON Schema
  contracts, and the idempotent Ajv-validated `scripts/generate-matrix-md.ts`
  generator. (MATRIX-01..MATRIX-04)
- CI and validator harness: `.github/workflows/ci.yml` (`validate`,
  `matrix-drift`, `link-check`, `test` jobs; SHA-pinned actions,
  least-privilege) and `scripts/validate-templates/` — builds each template
  and grades it with the stdout-purity probe against the matrix, with a
  self-test fixture proving the validator can fail. (CI-01..CI-04)
- TypeScript template (`templates/typescript/`) — skeleton & transports:
  single binary with `--transport=stdio|http`, Zod-validated config,
  pino structured logging to stderr with two-layer secret redaction
  (key-path + value-shape), capability advertisement, stateless HTTP at
  `POST /mcp` with a deny-by-default Origin allowlist. (TS-01..TS-08)
- Example surface: `add(a,b)` tool with progress notifications and
  cancellation, one resource, one prompt — matching `example-surface.yaml`,
  with a byte-conformance gate. (SURF-01..SURF-03)
- Production hardening: graceful-shutdown drain, `GET /health`,
  protocol-version-negotiation logging, AsyncLocalStorage ULID correlation
  IDs, RFC 9728 OAuth Protected Resource Metadata stub, a DEV-only auth-hook
  middleware seam, and a roots-aware filesystem helper (realpath
  canonicalization + null-byte and sibling-prefix rejection). (HARD-01..HARD-07)
- Test suite: 44 Vitest tests — unit (tool, config, logger redaction,
  fs-roots, Origin) plus integration (SDK-client protocol smokes over stdio
  and HTTP, stdout-purity, secret-redaction, shutdown-drain), wired into CI.
  (TEST-01..TEST-04)
- Packaging & docs: multi-stage Dockerfile (digest-pinned `node:22-alpine`,
  ~61 MB, non-root, exec-form ENTRYPOINT), `.dockerignore`, a Claude Code
  registration example and usage guide, and a per-template README.
  (PACK-01..PACK-05)
- MIT `LICENSE` carried alongside the TypeScript template for self-contained
  extraction.

### Changed

- `shared/docs/01-transport.md`, `02-security-baseline.md`,
  `03-observability.md`, `04-config-and-logging.md`: Conformance sections now
  reference real category-prefixed compliance-matrix checkpoint IDs
  (`XPORT-NN`, `SEC-NN`, `LOG-NN`, `PROG-NN`) in place of the
  `TBD-MATRIX-XX` placeholders. (MATRIX-01)

### Fixed

- Cancellation contract aligned to the MCP 2025-11-25 specification
  (`basic/utilities/cancellation`): on `notifications/cancelled` the receiver
  stops work, frees resources, and sends **no response** for the cancelled
  request; the client observes termination through its own in-flight call
  aborting. The earlier "final response on cancel" contract contradicted the
  spec and is undeliverable with `@modelcontextprotocol/sdk@1.29.0`, which
  drops any response settling after the abort signal fires. Updated
  `example-surface.yaml` (`cancel_behavior`), the matrix
  (`PROG-02`/`SURF-01`/`SMOKE-05`), and `03-observability.md`.
