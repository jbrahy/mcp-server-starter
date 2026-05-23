# Transport Semantics

Every template implements both `stdio` and Streamable HTTP transports.
The transport is selected at process start time via a single
`--transport=stdio|http` flag. The default is `stdio`.

## Single-binary transport switching

The template MUST expose exactly one executable that selects its
transport at startup.

The executable MUST accept `--transport=stdio` (the default) and
`--transport=http`. Templates MAY support reading the transport from
the `MCP_TRANSPORT` environment variable as a fallback; if both are
set, the command-line flag wins.

Templates MUST NOT ship separate binaries per transport. Container
images, init scripts, and Claude Code configuration examples all
reference the same entry point.

> **Why:** a single binary halves the Docker image surface area and
> matches the `dotnet new mcpserver` convention. One image, one
> configuration knob — the deployment story stays simple.

## `stdio` transport

Selected with `--transport=stdio` (or no flag — `stdio` is the
default).

The server reads JSON-RPC requests from stdin (fd 0) as
newline-delimited JSON envelopes and writes JSON-RPC responses to
stdout (fd 1) as newline-delimited JSON envelopes.

### Stdout MUST contain only JSON-RPC

In `stdio` mode, stdout (fd 1) MUST contain only newline-delimited
JSON-RPC envelopes. Any other output — startup banners, log lines,
debug prints, dependency banners, panic stack traces — corrupts the
framing and breaks the client.

Templates MUST route every log line, including those emitted by
dependencies, to stderr (fd 2) or to a log file. The template's logger
MUST bind fd 2 before any other code that could emit a log line runs.

Templates MUST ban the language's default stdout-write APIs
(`console.log`, `print`, `fmt.Println`, `Console.WriteLine`,
`println!`) in the template source tree via a lint rule. The
compliance matrix records the exact lint rule each template ships.

> **Why:** logging to stdout in `stdio` mode is the single most
> common protocol-compliance failure in MCP servers. The symptom is
> opaque — clients drop the connection with "MCP server disconnected"
> and no further detail. The stdout-purity probe at
> `scripts/validate-templates/probes/stdout-purity.ts` exists
> specifically to catch this.

### `initialize` handshake

The server MUST respond to the JSON-RPC `initialize` method. The
response MUST include:

- `protocolVersion`: a string that is one of the protocol versions
  the server supports. The server MUST negotiate: if the client
  requests a version the server supports, the server MUST return
  that version. If the client requests a version the server does not
  support, the server MUST return its highest supported version. The
  server MUST NOT error on a version mismatch.
- `capabilities`: an object advertising the capabilities the server
  exposes. Templates ship with
  `{tools: {listChanged: true}, resources: {listChanged: true}, prompts: {listChanged: true}, logging: {}}`.
- `serverInfo`: an object with `name` and `version` (SemVer) of the
  server implementation.

The server MUST log a `protocol_version_negotiated` event at
`level: info` immediately after the handshake completes. See
`03-observability.md` §"Canonical events" for the line shape.

## Streamable HTTP transport

Selected with `--transport=http`.

The server binds an HTTP listener and exposes a single endpoint at
`/mcp` accepting `POST` requests. Each `POST` body is a JSON-RPC
envelope (or batch). The response body is the corresponding JSON-RPC
response.

Templates SHOULD operate the HTTP transport in stateless mode (no
session cookies, no server-side session state). Each `POST /mcp` is
independently authenticated and routed.

### Bind address

The server MUST bind `127.0.0.1` (loopback) by default. Operators MAY
override via the `MCP_HTTP_HOST` environment variable. If
`MCP_HTTP_HOST` is set to a non-loopback address (including
`0.0.0.0`), the server MUST emit a `WARN` log line at startup naming
the bound address.

> **Why:** DNS rebinding attacks against locally-bound MCP servers —
> see [GHSA-89vp-x53w-74fx](https://github.com/modelcontextprotocol/rust-sdk/security/advisories/GHSA-89vp-x53w-74fx)
> (rmcp Rust SDK, 2025). The default loopback bind blocks the class
> entirely. The `WARN` on non-loopback bind makes the deviation
> visible in production logs.

### `Origin` validation

The server MUST validate the HTTP `Origin` header against an explicit
allowlist. The allowlist is configured via the
`MCP_ORIGIN_ALLOWLIST` environment variable (comma-separated origins).

Required semantics:

- A request with no `Origin` header (typical for non-browser clients
  such as Inspector CLI, native MCP clients, or `curl`) MUST be
  allowed.
- A request with an `Origin` header that matches an entry in the
  allowlist MUST be allowed.
- A request with an `Origin` header that does not match any allowlist
  entry MUST be rejected with HTTP `403 Forbidden`.
- An empty allowlist (`MCP_ORIGIN_ALLOWLIST=""` or unset) means
  deny-all for browser clients but still allow no-Origin clients.
  Operators MUST opt in to specific origins.

> **Why:** without `Origin` validation, a malicious webpage on a
> different origin can issue authenticated requests to a locally-bound
> MCP server via the browser. The DNS-rebinding attack class
> (GHSA-89vp-x53w-74fx) is one form of this; same-origin policy alone
> is insufficient because the attacker controls DNS resolution.

The default allowlist contents (Inspector origin, Claude Desktop
origin, `vscode-webview://*`, the `null` origin marker for non-browser
clients) ship with the TypeScript canonical template and are
replicated across future language ports.

### Authentication hook seam

The HTTP transport MUST expose a single authentication middleware
seam. The default implementation is DEV-ONLY: it logs a `WARN` line
on every request including the literal text
`DEV-ONLY auth hook in use — replace before production` and passes
the request through.

Operators MUST replace the auth hook before production deployment.
The replacement MUST validate the credential presented by the client
(for example, a bearer token via the `Authorization` header) and
reject unauthorized requests.

The exact function signature for the auth hook is locked per language
in each template's production-hardening phase.

> **Why:** a hard-coded `401 Unauthorized` default crashes development
> workflows (Inspector, local testing) and pushes contributors to
> disable auth entirely. A DEV-ONLY default that logs and warns is
> the explicit choice — visible in stderr on every request,
> documented as MUST-REPLACE in every per-template `README.md` and in
> `02-security-baseline.md`.

### OAuth Protected Resource Metadata

The HTTP transport MUST expose
`GET /.well-known/oauth-protected-resource` returning a stub JSON
document conforming to [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728).
The default response includes `"_DEV_STUB": true` and a
`"_DEV_WARNING"` field. Operators MUST replace the stub before
production deployment.

The exact RFC 9728 fields (`resource`, `authorization_servers`,
`scopes_supported`) ship as placeholders. Production deployments fill
these with real values pointing to the operator's authorization
server.

### Health endpoint

The HTTP transport MUST expose `GET /health` returning HTTP `200 OK`
with body:

```json
{
  "status": "ok",
  "uptime_seconds": 0,
  "protocol_version": "2025-11-25"
}
```

The response MUST NOT include version information about dependencies,
environment variables, hostnames, or any other operator-internal
state. Information disclosure on `/health` is a recurring source of
fingerprinting.

## Conformance

Templates are graded against this document by the following matrix
checkpoint IDs (assigned by `shared/compliance-matrix.yaml`):

- `XPORT-01` — `stdio` handshake, stdout purity,
  logs-to-stderr.
- `XPORT-02` — `127.0.0.1` default bind,
  non-loopback `WARN`.
- `XPORT-03` — `Origin` allowlist semantics.
- `XPORT-04` — `/health` shape.
- `XPORT-05` —
  `/.well-known/oauth-protected-resource` stub shape.
- `XPORT-06` — version negotiation behavior.
