# Security Baseline

This document is the load-bearing security contract for every
template in the suite. Every non-negotiable here is enforced by
`shared/compliance-matrix.yaml` and the validator harness at
`scripts/validate-templates/`. A template that does not satisfy every
item in this document does not ship.

## Stdout discipline (`stdio` mode)

In `stdio` mode, stdout (fd 1) MUST contain only newline-delimited
JSON-RPC envelopes. See `01-transport.md` §"Stdout MUST contain only
JSON-RPC".

## HTTP bind default

The HTTP transport MUST bind `127.0.0.1` by default. See
`01-transport.md` §"Bind address".

## `Origin` validation

The HTTP transport MUST validate the `Origin` header against an
explicit allowlist. See `01-transport.md` §"`Origin` validation".

## Authentication hook seam

The HTTP transport MUST expose an authentication middleware seam with
a DEV-ONLY default that logs a `WARN` line per request. See
`01-transport.md` §"Authentication hook seam".

> **Why:** a no-op default that warns is the explicit choice over a
> crashing-by-default or a permissive-by-default. Operators who ship
> the template to production without replacing the seam see the
> warning in every log line — the omission is loud, not silent.
> Per-request logging is intentional.

## Filesystem roots enforcement

Templates that expose filesystem-backed resources or tools MUST route
every filesystem access through a roots-aware helper that:

1. Rejects paths containing a null byte (`\0`). The helper MUST
   reject before any path concatenation.
2. Resolves the path against the process working directory if
   relative.
3. Calls the operating-system canonical-path resolver to follow
   symlinks. Per language: `fs.realpath` (Node), `os.path.realpath`
   (Python), `filepath.EvalSymlinks` (Go), `Path.GetFullPath` +
   `File.ResolveLinkTarget` (C#), `std::fs::canonicalize` (Rust).
4. Asserts that the canonical resolved path starts with one of the
   canonicalized configured roots.
5. Rejects with a clear error message if the assertion fails.

The canonical-path check happens **after** symlink resolution, not
before. A path that lexically appears to be inside a configured root
MAY still resolve outside the root via a symlink.

> **Why:** [CVE-2025-67364](https://nvd.nist.gov/vuln/detail/CVE-2025-67364)
> and [CVE-2025-53109](https://nvd.nist.gov/vuln/detail/CVE-2025-53109)
> are both 2025 MCP-server filesystem-escape vulnerabilities, both
> caused by path checks that ran before symlink resolution rather
> than after. The canonical-realpath-then-prefix-check pattern blocks
> both.

## Secret redaction in logs

Every log line emitted by the server MUST be passed through a
redaction layer before reaching stderr or a log file. The redaction
layer MUST match the patterns below and replace each match with the
literal string `[REDACTED]`.

### Header names (case-insensitive match on key)

- `Authorization`
- `Proxy-Authorization`
- `Cookie`
- `Set-Cookie`

### Field names (case-insensitive match on object key)

- `password`
- `api_key`
- `apikey`
- `secret`
- `token`
- `access_token`
- `refresh_token`
- `client_secret`
- `private_key`

### Token-shape patterns (applied to every string value)

| Pattern | Matches |
|---------|---------|
| `Bearer\s+[A-Za-z0-9._~+/=-]+` | RFC 6750 Bearer scheme tokens. |
| `AKIA[0-9A-Z]{16}` | AWS access key ID. |
| `(?<![A-Za-z0-9])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9])` | AWS secret access key (40-char base64 alphabet, word-boundary anchored). |
| `gh[pousr]_[A-Za-z0-9]{36}` | GitHub classic personal access tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`). |
| `github_pat_[A-Za-z0-9_]{82,}` | GitHub fine-grained personal access tokens. |
| `sk-[A-Za-z0-9]{20,}` | OpenAI-shape API keys. |
| `sk-ant-[A-Za-z0-9_-]{20,}` | Anthropic API keys. |
| `xox[baprs]-[A-Za-z0-9-]{10,}` | Slack tokens (bot, app, user, refresh, scope). |
| `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` | JSON Web Tokens (header.payload.signature, base64url). |

### PII (gated)

Templates MUST redact email addresses matching
`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` from log output
unless the operator opts in via `MCP_LOG_PII=1`. The gate exists
because some operators need email-address signals in logs for support
workflows.

### Replacement value

The redacted value is replaced with the literal string `[REDACTED]`.
Templates MUST NOT preserve length (`***`), MUST NOT preserve a
prefix (`gh_***`), MUST NOT replace with a hash (which leaks identity
across log lines), and MUST NOT store the original value alongside
the redacted version.

### Extension policy

Contributors MAY add patterns by submitting a pull request that
updates:

1. This document (with rationale and the new pattern).
2. The compliance matrix at `shared/compliance-matrix.yaml` to add
   the pattern to the security-baseline checkpoints.
3. The TypeScript canonical template's `templates/typescript/src/logger.ts`
   to add the regex.

Each addition is a minor version bump per `CHANGELOG.md`'s SemVer
convention.

Removing or weakening a redaction pattern is a **major** version bump
and requires explicit acknowledgement in `CHANGELOG.md` under the
`### Security` heading.

> **Why:** secrets in logs are the second-most-common security
> failure in MCP servers (after stdout-as-JSON-RPC violations).
> Templates that ship with a permissive default leak secrets the
> first time an operator dumps `process.env` to logs in a debug
> session. The comprehensive default catches the high-signal patterns
> out of the box; the extension policy keeps the list growing without
> bloating the canonical baseline.

## Shell execution disabled by default

Default-shipping templates MUST NOT include a tool that executes
arbitrary shell commands.

If an operator-added tool requires process execution, it MUST:

1. Use a strict allowlist of permitted commands.
2. Reject any input that includes shell metacharacters (`;`, `&`,
   `|`, backtick, `$(`, `>`, `<`).
3. Spawn the child process directly (not via a shell) — for example,
   `execFile` not `exec` in Node, `subprocess.run([...], shell=False)`
   in Python, `exec.Command` (not `bash -c`) in Go.

> **Why:** [CVE-2025-68143](https://nvd.nist.gov/vuln/detail/CVE-2025-68143),
> [CVE-2025-68144](https://nvd.nist.gov/vuln/detail/CVE-2025-68144),
> and [CVE-2025-68145](https://nvd.nist.gov/vuln/detail/CVE-2025-68145)
> are three 2025 MCP-server remote-code-execution vulnerabilities,
> all caused by templates shipping with shell-execution tools enabled
> by default and inadequate input sanitization. The shell-off default
> blocks the class entirely.

## Outbound network access

Templates MUST ship "allowlist-ready". The default configuration MUST
NOT make outbound network requests to arbitrary destinations on
behalf of tool inputs. If a tool requires outbound network access,
the template MUST expose an `MCP_HTTP_ALLOWLIST` (or similar)
environment variable that operators populate with the explicit
destinations the tool is allowed to reach.

Templates MAY implement the allowlist as a soft default — log a
`WARN` on out-of-allowlist requests — but the recommended pattern is
hard rejection.

## Input validation

Every tool input MUST be validated against the tool's declared input
schema (Zod in TypeScript, Pydantic in Python, the equivalent in each
ecosystem) at the boundary, before the input is passed to any
business logic.

Validation failures MUST surface as **tool-execution errors**
(`{content: [...], isError: true}`) — NOT as JSON-RPC protocol errors
(`-32602 Invalid Params`). The MCP `2025-11-25` specification
distinguishes the two; surfacing the wrong error kind confuses the
model and harms self-correction.

Templates MUST reject unknown fields when running in strict mode (see
`04-config-and-logging.md` §`STRICT_ENV`).

## OAuth Protected Resource Metadata stub

The HTTP transport MUST expose
`GET /.well-known/oauth-protected-resource`. See `01-transport.md`
§"OAuth Protected Resource Metadata".

## Container hardening

Per-template `Dockerfile`s are graded against this document in each
template's packaging phase. Required container behavior:

- Multi-stage build separating build and runtime stages.
- Non-root user at runtime.
- Minimal or distroless runtime base image.
- `HEALTHCHECK` directive pointing at `GET /health` when the default
  transport is HTTP.
- `ENTRYPOINT` in exec form (JSON array, not shell string) so the
  PID-1 process receives signals directly and graceful shutdown
  works.

## Conformance

Templates are graded against this document by the following matrix
checkpoint IDs (assigned by `shared/compliance-matrix.yaml`):

- `TBD-MATRIX-SECURITY-STDOUT-PURE` — stdout-only-JSON-RPC in `stdio`
  mode.
- `TBD-MATRIX-SECURITY-HTTP-BIND` — `127.0.0.1` default bind.
- `TBD-MATRIX-SECURITY-HTTP-ORIGIN` — `Origin` allowlist semantics.
- `TBD-MATRIX-SECURITY-AUTH-HOOK` — DEV-ONLY auth hook with per-request
  `WARN`.
- `TBD-MATRIX-SECURITY-FS-ROOTS` — canonical-realpath roots check,
  null-byte rejection.
- `TBD-MATRIX-SECURITY-REDACTION` — every pattern in §"Secret
  redaction in logs" is matched.
- `TBD-MATRIX-SECURITY-SHELL-OFF` — no shell-execution tool in
  default-shipping templates.
- `TBD-MATRIX-SECURITY-NETWORK-ALLOWLIST` — allowlist-ready default.
- `TBD-MATRIX-SECURITY-OAUTH-PRM-STUB` — RFC 9728 stub with
  `_DEV_STUB: true`.
- `TBD-MATRIX-SECURITY-CONTAINER-HARDENING` — multi-stage, non-root,
  exec-form `ENTRYPOINT`, `HEALTHCHECK` (HTTP default).
