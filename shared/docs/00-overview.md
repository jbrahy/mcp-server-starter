# Overview

This directory holds the cross-template contract for the MCP Server Template
Suite. Every present and future template — TypeScript canonical, Python,
Go, C#, optional Rust — implements the contract these documents describe.

## Document set

| Document | Scope |
|----------|-------|
| `00-overview.md` | This file. Suite overview, per-template contract checklist, audience. |
| `01-transport.md` | `stdio` + Streamable HTTP transport semantics. Single-binary `--transport` flag. Stdout discipline. |
| `02-security-baseline.md` | Non-negotiables. Origin validation, FS roots, secret redaction, shell-off, network allowlist. Load-bearing. |
| `03-observability.md` | Structured log line schema, MCP progress notifications, cancellation contract. |
| `04-config-and-logging.md` | Environment-variable conventions, startup validation, logger sink behavior per transport. |

## Audience

These documents are written for three audiences, in this priority order:

1. **Future-language porters.** Someone implementing a new template
   (Python, Go, C#, Rust) MUST be able to ship a compliant server using
   these documents alone, without reading the TypeScript canonical
   template's source.
2. **Security auditors.** Every non-negotiable cites the specific
   advisory or upstream issue that motivates it.
3. **Operators.** The configuration and security defaults described
   here are the defaults a freshly-generated template ships with —
   operators read these documents to understand what they are opting
   in or out of.

The primary client is **Claude Code**. Every template ships with an
`examples/claude-code-config.json` registration example.

## Per-template contract checklist

Every template MUST satisfy every item below. The compliance matrix at
`shared/compliance-matrix.yaml` is the machine-readable form of this
checklist; the validator harness at `scripts/validate-templates/`
enforces it in CI.

- **MCP protocol version:** `2025-11-25`. Deviations require a matrix
  update.
- **Transports:** single binary with a `--transport=stdio|http` flag.
  `stdio` is the default; Streamable HTTP at `/mcp` is the remote
  transport. See `01-transport.md`.
- **Stdout discipline:** in `stdio` mode, stdout contains only
  newline-delimited JSON-RPC envelopes. See `01-transport.md`.
- **HTTP security:** binds `127.0.0.1` by default; validates the
  `Origin` header against an explicit allowlist; ships a DEV-ONLY auth
  hook seam documented as MUST-REPLACE; exposes a stub OAuth Protected
  Resource Metadata document at
  `/.well-known/oauth-protected-resource`. See `02-security-baseline.md`.
- **Filesystem safety:** access is constrained to allowed roots with
  canonical-path validation post-symlink-resolution. Null-byte paths
  are rejected. See `02-security-baseline.md`.
- **Secret redaction:** API keys, bearer tokens, and known credential
  patterns are redacted from log output before emission. See
  `02-security-baseline.md`.
- **Example surface:** every template exposes exactly one tool
  (`add(a, b)` with a five-second slow loop, progress notifications,
  and cancellation), one read-only resource at `example://greeting`,
  and one parameterized prompt named `greet`. The shapes are
  byte-for-byte normative; see `shared/example-surface.yaml`.
- **Observability:** log lines conform to the schema in
  `03-observability.md`; every request is tagged with a `request_id`
  (ULID); the negotiated protocol version is logged at startup.
- **Lifecycle:** SIGINT and SIGTERM trigger a bounded graceful
  shutdown — complete in-flight requests, close transports, exit `0`.
- **Configuration:** environment variables follow the conventions in
  `04-config-and-logging.md`; validation is fail-fast at startup.
- **Tests:** unit tests, MCP protocol smoke tests, a stdout-purity
  test, and a secret-redaction test.
- **Packaging:** multi-stage `Dockerfile`, Claude Code configuration
  example, per-template `docs/CLAUDE-CODE-USAGE.md`, per-template
  `README.md`.

## How to use this document set when porting to a new language

1. Read `00-overview.md` to understand the surface area.
2. Read `01-transport.md` and `02-security-baseline.md` together — these
   are the two load-bearing documents.
3. Read `03-observability.md` to understand the log schema your
   implementation MUST emit byte-for-byte.
4. Read `04-config-and-logging.md` for the configuration contract.
5. Verify against `shared/compliance-matrix.yaml` and
   `shared/example-surface.yaml`.
6. Wire the new template into `scripts/validate-templates/` and confirm
   CI passes.

The TypeScript canonical template at `templates/typescript/` is the
reference implementation. When this document set is ambiguous, the
TypeScript template's observable behavior is the tie-breaker.

## Document conventions

- Normative keywords (`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, `MAY`)
  are used per [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
  [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174). Keywords are
  uppercase in normative statements only.
- "Why" callouts (blockquoted, prefixed `> **Why:**`) explain the
  decision and link to the specific advisory, CVE, or upstream issue
  that motivates it.
- File paths are full repo-relative paths
  (e.g., `templates/typescript/src/logger.ts`).
- External references use direct URLs.
