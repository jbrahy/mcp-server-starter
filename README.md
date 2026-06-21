# MCP Server Template Suite

A reusable, production-shaped template suite for building [Model Context
Protocol](https://modelcontextprotocol.io/) servers across multiple
language ecosystems. Spinning up a new MCP server should take minutes,
not days, and should start production-shaped — secure, observable, and
MCP-compliant — by default.

Target MCP protocol version: **`2025-11-25`**.
Primary consumer: **Claude Code**.

---

## Why this exists

Every new MCP server project re-decides the same set of questions:
how to keep stdout clean in `stdio` mode, how to bind HTTP safely, how
to redact secrets, how to wire progress and cancellation, how to ship
a Dockerfile that actually behaves under SIGTERM, how to validate that
the protocol surface matches the spec. This suite makes those decisions
once, encodes them in a machine-readable compliance matrix, and
provides a canonical template per language that conforms to it.

A new MCP server is not a green-field design exercise — it is a port
of the canonical template, with the business-specific tools, resources,
and prompts layered on top.

## Status

**Milestone 1 (in progress):** shared foundation + TypeScript canonical
template.

| Component | Location | Status |
|-----------|----------|--------|
| Repo & governance scaffold | repo root | Phase 1 — in progress |
| Shared docs & security baseline | `shared/docs/` | Phase 2 — pending |
| MCP `2025-11-25` compliance matrix | `shared/compliance-matrix.yaml` | Phase 3 — pending |
| CI & validator harness skeleton | `.github/workflows/`, `scripts/validate-templates/` | Phase 4 — pending |
| TypeScript template — skeleton & transports | `templates/typescript/` | Phase 5 — pending |
| TypeScript template — example surface | `templates/typescript/src/{tools,resources,prompts}/` | Phase 6 — pending |
| TypeScript template — production hardening | `templates/typescript/src/{lifecycle,http,security}/` | Phase 7 — pending |
| TypeScript template — tests | `templates/typescript/tests/` | Phase 8 — pending |
| TypeScript template — packaging & docs | `templates/typescript/{Dockerfile,docs,examples}/` | Phase 9 — pending |

**Future milestones (planned, not yet implemented):** Python / FastMCP,
Go, C# / .NET, optional Rust, Copier-based generator, cross-template
parity validation.

## Repository layout

```
.
├── README.md                       This file
├── SECURITY.md                     How to report vulnerabilities
├── CONTRIBUTING.md                 Contributor guide
├── CHANGELOG.md                    Keep-a-Changelog + SemVer
├── CODEOWNERS                      Path-to-reviewer mapping
├── LICENSE                         MIT
├── mcp_template_prd.md             Source PRD (multi-language vision)
├── templates/                      One subdirectory per language template
│   └── typescript/                 (lands in Milestone 1)
├── shared/                         Cross-template docs, matrix, and contracts
│   ├── docs/                       Architecture, transport, security, observability
│   ├── compliance-matrix.yaml      Machine-readable compliance source of truth
│   ├── compliance-matrix.md        Generated Markdown view (do not hand-edit)
│   └── example-surface.yaml        Canonical tool/resource/prompt schema
└── scripts/
    └── validate-templates/         Validator harness that grades every template
                                    against the compliance matrix
```

## The shared contract

Every template — present and future — implements the same observable
contract:

- **Protocol:** MCP `2025-11-25`. Deviations require an explicit decision
  and a matrix update.
- **Transports:** single binary with a `--transport=stdio|http` flag.
  `stdio` is the default; Streamable HTTP at `/mcp` is the remote
  transport.
- **Stdout discipline:** in `stdio` mode, stdout carries only valid
  JSON-RPC envelopes. Logs go to stderr as structured JSON. Anything
  else is a protocol-compliance bug.
- **HTTP security baseline:** binds `127.0.0.1` by default; validates
  the `Origin` header against an explicit allowlist; ships a DEV-ONLY
  auth hook seam that is documented as MUST-REPLACE before production
  use; exposes a stub OAuth Protected Resource Metadata document at
  `/.well-known/oauth-protected-resource` clearly marked as a stub.
- **Surface:** every template exposes exactly one example tool
  (`add(a, b)` — a 5-second intentionally-slow loop that emits progress
  notifications and honours cancellation), one example resource, one
  example prompt. This is the minimum surface the compliance matrix can
  grade.
- **Observability:** every request is tagged with a correlation ID
  (`mcp-correlation-id` header in HTTP mode, generated otherwise) and
  the ID appears on every log line for that request. The negotiated
  protocol version is logged at startup.
- **Lifecycle:** SIGINT and SIGTERM trigger a bounded graceful
  shutdown: complete in-flight requests, close transports, exit `0`.
- **Filesystem safety:** access is constrained to allowed roots with
  canonical-path validation post-symlink-resolution. Null-byte paths
  are rejected.
- **Secrets:** API keys, bearer tokens, and known credential patterns
  are redacted from log output before emission.

The full security baseline lives in `shared/docs/02-security-baseline.md`
(added in Phase 2).

## Quick start with the TypeScript template

The TypeScript canonical template ships now. Requires Node `^22.7.5`.

1. **Clone and enter the template:**

   ```bash
   git clone https://github.com/jbrahy/mcp-server-template.git
   cd mcp-server-template/templates/typescript
   ```

2. **Install and build:**

   ```bash
   npm install
   npm run build
   ```

3. **Run the server.** Over `stdio` (the default — stdout carries
   JSON-RPC, logs go to stderr):

   ```bash
   npm run start:stdio
   ```

   Or over Streamable HTTP (binds `127.0.0.1:3000` by default):

   ```bash
   npm run start:http
   ```

   Transport precedence: the `--transport=` CLI flag wins over the
   `MCP_TRANSPORT` environment variable; the default is `stdio`.

4. **Build and run the container** with the multi-stage `Dockerfile`:

   ```bash
   docker build -t mcp-ts templates/typescript/
   docker run --rm -i mcp-ts                 # stdio (keep stdin open)
   ```

   For HTTP in Docker, override the bind host to `0.0.0.0` so the
   published port is reachable:

   ```bash
   docker run --rm -p 3000:3000 -e MCP_TRANSPORT=http -e MCP_HTTP_HOST=0.0.0.0 mcp-ts
   ```

5. **Register with Claude Code** using the example configuration at
   `templates/typescript/examples/claude-code-config.json` and the
   walkthrough in `templates/typescript/docs/CLAUDE-CODE-USAGE.md`.

6. **Read the full per-template reference** —
   `templates/typescript/README.md` covers build, test, environment
   variables, and security defaults in depth.

## Contributing

See `CONTRIBUTING.md` for how the project is structured, the
source-of-truth rule, the compliance-matrix gate, and the commit and
pull request conventions.

## Reporting security issues

Do not open a public issue. See `SECURITY.md` for how to report
vulnerabilities privately via GitHub's private advisory workflow.

## License

[MIT](LICENSE) © John Brahy.
