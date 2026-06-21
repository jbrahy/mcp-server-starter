# TypeScript MCP server template

A single-binary Model Context Protocol (MCP) server in TypeScript. It speaks
both `stdio` and Streamable HTTP transports, logs structured JSON to stderr,
redacts secrets, and conforms to the MCP
[2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
specification. Copy this directory, replace the example tool/resource/prompt
with your own, and ship.

The server ships three example surfaces so you can confirm it works end to end:
an `add` tool (adds two numbers), an `example://greeting` resource (returns
`Hello from MCP`), and a `greet` prompt (renders `Hello, World!` for
`name=World`).

## Quick start

Requires Node `^22.7.5`.

```bash
npm install
npm run build
```

Run in **stdio** mode (the default — stdout carries JSON-RPC, logs go to
stderr):

```bash
npm run start:stdio
```

Run in **http** mode (Streamable HTTP on `127.0.0.1:3000`):

```bash
npm run start:http
```

Transport selection precedence: the `--transport=` CLI flag wins over the
`MCP_TRANSPORT` environment variable, and the default is `stdio`. Both
`npm run` scripts above pass `--transport=` explicitly.

## Tests

```bash
npm test            # build + run the Vitest suite
npm run test:coverage
```

## Docker

Build the image from the template directory:

```bash
docker build -t mcp-ts templates/typescript/
```

Run in **stdio** mode (keep stdin open with `-i` so the server can read
JSON-RPC):

```bash
docker run --rm -i mcp-ts
```

Run in **http** mode. HTTP-in-Docker **requires** `MCP_HTTP_HOST=0.0.0.0`: the
image default `127.0.0.1` binds the container's own loopback, which a published
port cannot reach. Override both the transport and the bind host:

```bash
docker run --rm -p 3000:3000 -e MCP_TRANSPORT=http -e MCP_HTTP_HOST=0.0.0.0 mcp-ts
# then, host side:
curl -s http://127.0.0.1:3000/health
```

Binding `0.0.0.0` emits a startup `http_bound_non_loopback` WARN on stderr.
**This WARN is expected and correct in a port-mapped container** — the Docker
port mapping is the network trust boundary, not the in-container bind address.

The image is built exec-form (`node` is PID 1), so `docker stop` delivers
SIGTERM directly and the server drains and exits `0`. A `HEALTHCHECK` is
intentionally omitted from the default (stdio) image; the `Dockerfile` carries a
copy-paste HTTP-mode `HEALTHCHECK` snippet for operators who flip to HTTP.

## Environment variables

All configuration is read from the reserved `MCP_*` / `STRICT_ENV` keys at
startup, validated with Zod, fail-fast on any parse error. Values are never
logged — only key names — so a secret tucked into a custom variable cannot leak.

| Variable | Default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`. The `--transport=` CLI flag wins over this. |
| `MCP_HTTP_HOST` | `127.0.0.1` | HTTP bind host. Set `0.0.0.0` for containers. |
| `MCP_HTTP_PORT` | `3000` | HTTP port (1–65535). |
| `MCP_ORIGIN_ALLOWLIST` | (empty — deny all) | Comma-separated list of allowed `Origin` header values. |
| `MCP_LOG_LEVEL` | `info` | One of `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |
| `MCP_LOG_FILE` | (unset) | Optional file sink for logs (in addition to stderr). |
| `MCP_LOG_PII` | `0` | `1` allows email addresses through redaction. |
| `MCP_CANCEL_GRACE_MS` | `1000` | Grace window (ms) for in-flight cancellation. |
| `MCP_SHUTDOWN_GRACE_MS` | `30000` | Graceful-shutdown drain budget (ms). |
| `STRICT_ENV` | `0` | `1` rejects any unknown `MCP_*` key at startup (typo guard). |

## Security defaults

This template ships secure-by-default. The full contract lives in
[`shared/docs/02-security-baseline.md`](../../shared/docs/02-security-baseline.md).
Highlights:

- **Stdout is JSON-RPC only** in `stdio` mode — every log line goes to stderr,
  so nothing corrupts the protocol stream.
- **Loopback bind by default** — the HTTP transport binds `127.0.0.1`. Any
  non-loopback bind logs a `http_bound_non_loopback` WARN.
- **Origin allowlist is deny-by-default** — an empty `MCP_ORIGIN_ALLOWLIST`
  rejects all cross-origin requests; populate it explicitly.
- **Secret redaction** — every log line passes through a redaction layer that
  replaces Bearer tokens, AWS/GitHub/OpenAI/Anthropic/Slack keys, JWTs, and
  sensitive header/field names with `[REDACTED]` before reaching stderr.
- **DEV-ONLY auth hook** — the HTTP auth seam (`src/http/auth.ts`) warns on every
  request and **must be replaced before production**. The stub OAuth Protected
  Resource Metadata route (`src/http/oauth-prm.ts`) is likewise a dev placeholder
  flagged `_DEV_STUB: true`. See the "Before production" section of
  [`docs/CLAUDE-CODE-USAGE.md`](docs/CLAUDE-CODE-USAGE.md).

The runtime image uses `node:22-alpine`, pinned by digest and run as a non-root
user. A distroless runtime base (no shell, smaller attack surface) is a planned
future hardening upgrade.

## Further reading

- MCP specification: <https://modelcontextprotocol.io/specification/2025-11-25>
- Security baseline: [`shared/docs/02-security-baseline.md`](../../shared/docs/02-security-baseline.md)
- Registering with Claude Code: [`docs/CLAUDE-CODE-USAGE.md`](docs/CLAUDE-CODE-USAGE.md)
