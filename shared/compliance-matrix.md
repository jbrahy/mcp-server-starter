# MCP Server Template Compliance Matrix

The single source of truth for what every MCP server template in this suite must do. Each row below cites the documentation anchor that defines the rule and the code anchor in the canonical TypeScript template that owns the implementation. Downstream language ports (Python, Go, C#, Rust) implement the same rows.

> Generated from shared/compliance-matrix.yaml — do not edit directly.

## Table of Contents

- [Protocol](#protocol)
- [Transports](#transports)
- [Capabilities](#capabilities)
- [Errors](#errors)
- [Progress and Cancellation](#progress-and-cancellation)
- [Log Schema](#log-schema)
- [Surface](#surface)
- [Security](#security)
- [Smoke Probes](#smoke-probes)
- [Inspector Commands](#inspector-commands)

## Protocol

Protocol version: `2025-11-25`.

## Transports

Templates ship a single binary that speaks MCP over stdio (default) and Streamable HTTP. Each row below pins one transport-level invariant.

| ID | Level | Check | Doc | Code | Applies to |
|----|-------|-------|-----|------|------------|
| <a id="XPORT-01"></a>`XPORT-01` | MUST | stdio transport responds to initialize with a JSON-RPC result carrying protocolVersion, capabilities, and serverInfo; no error envelope on supported-version handshake | [shared/docs/01-transport.md#initialize-handshake](shared/docs/01-transport.md#initialize-handshake) | `templates/typescript/src/transports/stdio.ts#StdioTransport` | stdio |
| <a id="XPORT-02"></a>`XPORT-02` | MUST | HTTP transport binds 127.0.0.1 by default; MCP_HTTP_HOST set to a non-loopback address emits a WARN log line at startup naming the bound address | [shared/docs/01-transport.md#bind-address](shared/docs/01-transport.md#bind-address) | `templates/typescript/src/transports/http.ts#bindHost` | streamable_http |
| <a id="XPORT-03"></a>`XPORT-03` | MUST | HTTP transport enforces an Origin allowlist: no-Origin requests pass, allowlisted Origins pass, unknown Origins are rejected with 403 Forbidden, empty allowlist means deny-all for browser clients | [shared/docs/01-transport.md#origin-validation](shared/docs/01-transport.md#origin-validation) | `templates/typescript/src/security/origin.ts#originAllowlistMiddleware` | streamable_http |
| <a id="XPORT-04"></a>`XPORT-04` | MUST | HTTP GET /health returns 200 with body {status: 'ok', uptime_seconds: <integer>, protocol_version: '2025-11-25'} and no operator-internal fields (no dependency versions, env, hostnames) | [shared/docs/01-transport.md#health-endpoint](shared/docs/01-transport.md#health-endpoint) | `templates/typescript/src/http/health.ts#healthRoute` | streamable_http |
| <a id="XPORT-05"></a>`XPORT-05` | MUST | HTTP GET /.well-known/oauth-protected-resource returns an RFC 9728 stub JSON document including _DEV_STUB: true and a _DEV_WARNING field; the stub's full RFC 9728 shape is finalized in a later phase | [shared/docs/01-transport.md#oauth-protected-resource-metadata](shared/docs/01-transport.md#oauth-protected-resource-metadata) | `templates/typescript/src/http/oauth-prm.ts#prmRoute` | streamable_http |
| <a id="XPORT-06"></a>`XPORT-06` | MUST | initialize negotiates protocolVersion (returns the supported version when client requests one; returns the server's highest supported version on mismatch; never errors on version mismatch) and emits the protocol_version_negotiated log event | [shared/docs/01-transport.md#initialize-handshake](shared/docs/01-transport.md#initialize-handshake) | `templates/typescript/src/server.ts#protocolVersionNegotiated` | stdio, streamable_http |

## Capabilities

Initialize-time capability advertisement. Every row below must be observable in the negotiated capabilities object.

| ID | Level | Check | Doc | Code | Applies to |
|----|-------|-------|-----|------|------------|
| <a id="CAP-01"></a>`CAP-01` | MUST | tools capability advertised as enabled at initialize | [shared/docs/00-overview.md#per-template-contract-checklist](shared/docs/00-overview.md#per-template-contract-checklist) | `templates/typescript/src/server.ts#capabilities` | stdio, streamable_http |
| <a id="CAP-02"></a>`CAP-02` | MUST | resources capability advertised as enabled at initialize | [shared/docs/00-overview.md#per-template-contract-checklist](shared/docs/00-overview.md#per-template-contract-checklist) | `templates/typescript/src/server.ts#capabilities` | stdio, streamable_http |
| <a id="CAP-03"></a>`CAP-03` | MUST | prompts capability advertised as enabled at initialize | [shared/docs/00-overview.md#per-template-contract-checklist](shared/docs/00-overview.md#per-template-contract-checklist) | `templates/typescript/src/server.ts#capabilities` | stdio, streamable_http |
| <a id="CAP-04"></a>`CAP-04` | MUST | logging capability advertised as enabled at initialize | [shared/docs/00-overview.md#per-template-contract-checklist](shared/docs/00-overview.md#per-template-contract-checklist) | `templates/typescript/src/server.ts#capabilities` | stdio, streamable_http |
| <a id="CAP-05"></a>`CAP-05` | MUST | listChanged advertised true for tools, resources, prompts | [shared/docs/00-overview.md#per-template-contract-checklist](shared/docs/00-overview.md#per-template-contract-checklist) | `templates/typescript/src/server.ts#capabilities` | stdio, streamable_http |

## Errors

Two error envelopes coexist: protocol-level (JSON-RPC) and tool-level (`isError`). They are not interchangeable.

| ID | Level | Check | Doc | Code | Applies to |
|----|-------|-------|-----|------|------------|
| <a id="ERR-01"></a>`ERR-01` | MUST | Protocol-level failures use the JSON-RPC error envelope ({jsonrpc, id, error: {code, message, data?}}); never the tool-error envelope | [shared/docs/03-observability.md#cancellation](shared/docs/03-observability.md#cancellation) | `templates/typescript/src/server.ts#dispatchError` | stdio, streamable_http |
| <a id="ERR-02"></a>`ERR-02` | MUST | Tool failures use the MCP tool-error envelope ({isError: true, content: [...]}); never the JSON-RPC error envelope | [shared/docs/03-observability.md#cancellation](shared/docs/03-observability.md#cancellation) | `templates/typescript/src/tools/add.ts#cancellationHandler` | stdio, streamable_http |

## Progress and Cancellation

Long-running tools emit progress notifications and honor cancellation per the MCP spec: stop work, free resources, and send no response for the cancelled request — the client observes request termination.

| ID | Level | Check | Doc | Code | Applies to |
|----|-------|-------|-----|------|------------|
| <a id="PROG-01"></a>`PROG-01` | MUST | notifications/progress emitted with progressToken matching the inbound tools/call _meta.progressToken; one notification per progress_steps tick | [shared/docs/03-observability.md#progress-notifications](shared/docs/03-observability.md#progress-notifications) | `templates/typescript/src/tools/add.ts#emitProgress` | stdio, streamable_http |
| <a id="PROG-02"></a>`PROG-02` | MUST | On inbound notifications/cancelled the handler stops work, frees resources, and sends NO response for the cancelled request (MCP 2025-11-25 basic/utilities/cancellation); the client observes request termination (its in-flight call rejects/aborts) and ignores any late response | [shared/docs/03-observability.md#cancellation](shared/docs/03-observability.md#cancellation) | `templates/typescript/src/tools/add.ts#cancellationHandler` | stdio, streamable_http |

## Log Schema

Structured JSON log lines written to stderr. The schema is closed; additions go inside `data:{}`.

| ID | Level | Check | Doc | Code | Applies to |
|----|-------|-------|-----|------|------------|
| <a id="LOG-01"></a>`LOG-01` | MUST | Logs written to stderr (fd 2) in stdio mode; never stdout | [shared/docs/03-observability.md#log-destination](shared/docs/03-observability.md#log-destination) | `templates/typescript/src/logger.ts#stderrSink` | stdio, streamable_http |
| <a id="LOG-02"></a>`LOG-02` | MUST | Each log line is a single JSON object carrying the required top-level keys (ts, level, msg, request_id, component, transport, negotiated_protocol); tool_name present only during tool execution; extras nested under data:{} | [shared/docs/03-observability.md#required-top-level-keys](shared/docs/03-observability.md#required-top-level-keys) | `templates/typescript/src/logger.ts#logSchema` | stdio, streamable_http |
| <a id="LOG-03"></a>`LOG-03` | MUST | ts is an ISO-8601 / RFC 3339 string with millisecond precision and trailing Z (UTC) | [shared/docs/03-observability.md#required-top-level-keys](shared/docs/03-observability.md#required-top-level-keys) | `templates/typescript/src/logger.ts#formatTimestamp` | stdio, streamable_http |
| <a id="LOG-04"></a>`LOG-04` | MUST | level field is a lowercase string in {trace, debug, info, warn, error, fatal}; never numeric (Pino's default must be overridden) | [shared/docs/03-observability.md#required-top-level-keys](shared/docs/03-observability.md#required-top-level-keys) | `templates/typescript/src/logger.ts#levelEncoder` | stdio, streamable_http |
| <a id="LOG-05"></a>`LOG-05` | MUST | request_id is a 26-character Crockford base32 ULID per https://github.com/ulid/spec | [shared/docs/03-observability.md#required-top-level-keys](shared/docs/03-observability.md#required-top-level-keys) | `templates/typescript/src/logger.ts#requestIdFactory` | stdio, streamable_http |
| <a id="LOG-06"></a>`LOG-06` | MUST | Canonical events emitted with locked field set: protocol_version_negotiated, request_started, request_completed, tool_call_started, tool_call_completed | [shared/docs/03-observability.md#canonical-events](shared/docs/03-observability.md#canonical-events) | `templates/typescript/src/logger.ts#canonicalEvents` | stdio, streamable_http |
| <a id="LOG-07"></a>`LOG-07` | MUST | All template-defined environment variables use the MCP_ prefix (single exception: STRICT_ENV); supersedes the shipped CONFIG-ENV-PREFIX placeholder | [shared/docs/04-config-and-logging.md#naming-convention](shared/docs/04-config-and-logging.md#naming-convention) | `templates/typescript/src/config.ts#envPrefix` | stdio, streamable_http |
| <a id="LOG-08"></a>`LOG-08` | MUST | Config validation is fail-fast at startup: a parse error causes the server to exit non-zero with a structured stderr line matching the log schema; supersedes the shipped CONFIG-STARTUP-VALIDATION placeholder | [shared/docs/04-config-and-logging.md#startup-validation](shared/docs/04-config-and-logging.md#startup-validation) | `templates/typescript/src/config.ts#validateOrExit` | stdio, streamable_http |
| <a id="LOG-09"></a>`LOG-09` | MUST | STRICT_ENV=1 rejects unknown MCP_* environment variables at startup with a structured stderr error; supersedes the shipped CONFIG-STRICT-ENV placeholder | [shared/docs/04-config-and-logging.md#startup-validation](shared/docs/04-config-and-logging.md#startup-validation) | `templates/typescript/src/config.ts#strictEnvGuard` | stdio, streamable_http |
| <a id="LOG-10"></a>`LOG-10` | MUST | Logger primary sink is stderr (fd 2) by default; HTTP mode MAY tee to MCP_LOG_FILE; supersedes the shipped LOG-SINK-STDERR-DEFAULT placeholder | [shared/docs/04-config-and-logging.md#logger-sink-behavior](shared/docs/04-config-and-logging.md#logger-sink-behavior) | `templates/typescript/src/logger.ts#sinkRouter` | stdio, streamable_http |
| <a id="LOG-11"></a>`LOG-11` | MUST | stdout sink prohibited in stdio mode (no console.log / process.stdout.write call may reach fd 1); supersedes the shipped LOG-SINK-NO-STDOUT-STDIO placeholder | [shared/docs/04-config-and-logging.md#stdio-mode](shared/docs/04-config-and-logging.md#stdio-mode) | `templates/typescript/src/transports/stdio.ts#stdoutGuard` | stdio, streamable_http |

## Surface

Canonical surface defined in [`shared/example-surface.yaml`](example-surface.yaml). Every template implements these bytes verbatim.

| ID | Level | Check | Doc | Code | Applies to |
|----|-------|-------|-----|------|------------|
| <a id="SURF-01"></a>`SURF-01` | MUST | add tool name, inputSchema (a/b as JSON-Schema number, both required), timing (total_ms 5000 / progress_interval_ms 1000 / progress_steps 5 / cancel_after_ms 2500 / expect_progress_count_at_cancel 3), result envelope ({content: [{type: text, text: String(a+b)}], isError: false}), and cancel_behavior ({mode: terminate_no_response, sends_response: false}) match shared/example-surface.yaml byte-for-byte | [shared/docs/00-overview.md#per-template-contract-checklist](shared/docs/00-overview.md#per-template-contract-checklist) | `templates/typescript/src/tools/add.ts#addTool` | stdio, streamable_http |
| <a id="SURF-02"></a>`SURF-02` | MUST | example://greeting resource uri (lowercase, exact), mimeType text/plain, and text bytes "Hello from MCP" (UTF-8, no trailing newline) match shared/example-surface.yaml verbatim | [shared/docs/00-overview.md#per-template-contract-checklist](shared/docs/00-overview.md#per-template-contract-checklist) | `templates/typescript/src/resources/example.ts#greetingResource` | stdio, streamable_http |
| <a id="SURF-03"></a>`SURF-03` | MUST | greet prompt name (lowercase, exact), single required string argument 'name' (no default, no maxLength), and render_template 'Hello, {{name}}!' (literal double-braces; substituted byte-for-byte; no surrounding whitespace) match shared/example-surface.yaml verbatim | [shared/docs/00-overview.md#per-template-contract-checklist](shared/docs/00-overview.md#per-template-contract-checklist) | `templates/typescript/src/prompts/example.ts#greetPrompt` | stdio, streamable_http |

## Security

The non-negotiables. Each row cites a baseline anchor and the implementation surface that owns it.

| ID | Level | Check | Doc | Code | Applies to |
|----|-------|-------|-----|------|------------|
| <a id="SEC-01"></a>`SEC-01` | MUST | In stdio mode, stdout (fd 1) contains only newline-delimited JSON-RPC envelopes; no log lines, no debug prints, no banners reach fd 1 | [shared/docs/02-security-baseline.md#stdout-discipline-stdio-mode](shared/docs/02-security-baseline.md#stdout-discipline-stdio-mode) | `templates/typescript/src/logger.ts#stderrSinkOnly` | stdio, streamable_http |
| <a id="SEC-02"></a>`SEC-02` | MUST | HTTP transport binds 127.0.0.1 by default; non-loopback MCP_HTTP_HOST emits a WARN log line at startup naming the bound address | [shared/docs/02-security-baseline.md#http-bind-default](shared/docs/02-security-baseline.md#http-bind-default) | `templates/typescript/src/transports/http.ts#bindHost` | stdio, streamable_http |
| <a id="SEC-03"></a>`SEC-03` | MUST | HTTP transport enforces an Origin allowlist with deny-by-default semantics: no-Origin requests pass (non-browser clients), allowlisted Origins pass, unknown Origins receive 403 Forbidden, empty allowlist denies all browser clients | [shared/docs/02-security-baseline.md#origin-validation](shared/docs/02-security-baseline.md#origin-validation) | `templates/typescript/src/security/origin.ts#originAllowlist` | stdio, streamable_http |
| <a id="SEC-04"></a>`SEC-04` | MUST | HTTP transport exposes an authentication middleware seam at templates/typescript/src/http/auth.ts with a DEV-ONLY default that emits a WARN log line on every request until replaced | [shared/docs/02-security-baseline.md#authentication-hook-seam](shared/docs/02-security-baseline.md#authentication-hook-seam) | `templates/typescript/src/http/auth.ts#authHook` | stdio, streamable_http |
| <a id="SEC-05"></a>`SEC-05` | MUST | Filesystem-backed resources/tools route every access through a roots-aware helper that (a) rejects paths containing a null byte before any concatenation, (b) calls the OS canonical-path resolver to follow symlinks (fs.realpath in Node), (c) asserts the canonical resolved path starts with one of the canonicalized configured roots, (d) rejects with a clear error otherwise; the canonical-path check happens AFTER symlink resolution, not before | [shared/docs/02-security-baseline.md#filesystem-roots-enforcement](shared/docs/02-security-baseline.md#filesystem-roots-enforcement) | `templates/typescript/src/security/fs-roots.ts#resolveUnderRoots` | stdio, streamable_http |
| <a id="SEC-06"></a>`SEC-06` | MUST | Header-name redaction (case-insensitive): "Authorization", "Proxy-Authorization", "Cookie", "Set-Cookie". Replacement: literal "[REDACTED]". | [shared/docs/02-security-baseline.md#secret-redaction-in-logs](shared/docs/02-security-baseline.md#secret-redaction-in-logs) | `templates/typescript/src/logger.ts#redact` | stdio, streamable_http |
| <a id="SEC-07"></a>`SEC-07` | MUST | Field-name redaction (case-insensitive on object key): "password", "api_key", "apikey", "secret", "token", "access_token", "refresh_token", "client_secret", "private_key". Replacement: literal "[REDACTED]". | [shared/docs/02-security-baseline.md#secret-redaction-in-logs](shared/docs/02-security-baseline.md#secret-redaction-in-logs) | `templates/typescript/src/logger.ts#redact` | stdio, streamable_http |
| <a id="SEC-08"></a>`SEC-08` | MUST | Bearer-token regex (RFC 6750 scheme): Bearer\s+[A-Za-z0-9._~+/=-]+. Replacement: literal "[REDACTED]". | [shared/docs/02-security-baseline.md#secret-redaction-in-logs](shared/docs/02-security-baseline.md#secret-redaction-in-logs) | `templates/typescript/src/logger.ts#redact` | stdio, streamable_http |
| <a id="SEC-09"></a>`SEC-09` | MUST | AWS regexes: AKIA[0-9A-Z]{16} (access key ID); (?<![A-Za-z0-9])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9]) (secret access key, 40-char base64 alphabet, word-boundary-anchored). Replacement: literal "[REDACTED]". | [shared/docs/02-security-baseline.md#secret-redaction-in-logs](shared/docs/02-security-baseline.md#secret-redaction-in-logs) | `templates/typescript/src/logger.ts#redact` | stdio, streamable_http |
| <a id="SEC-10"></a>`SEC-10` | MUST | GitHub token regexes: gh[pousr]_[A-Za-z0-9]{36} (classic PATs: ghp_, gho_, ghu_, ghs_, ghr_); github_pat_[A-Za-z0-9_]{82,} (fine-grained PATs). Replacement: literal "[REDACTED]". | [shared/docs/02-security-baseline.md#secret-redaction-in-logs](shared/docs/02-security-baseline.md#secret-redaction-in-logs) | `templates/typescript/src/logger.ts#redact` | stdio, streamable_http |
| <a id="SEC-11"></a>`SEC-11` | MUST | OpenAI/Anthropic API key regexes: sk-[A-Za-z0-9]{20,} (OpenAI shape); sk-ant-[A-Za-z0-9_-]{20,} (Anthropic). Replacement: literal "[REDACTED]". | [shared/docs/02-security-baseline.md#secret-redaction-in-logs](shared/docs/02-security-baseline.md#secret-redaction-in-logs) | `templates/typescript/src/logger.ts#redact` | stdio, streamable_http |
| <a id="SEC-12"></a>`SEC-12` | MUST | Slack tokens xox[baprs]-[A-Za-z0-9-]{10,} (bot/app/user/refresh/scope); JWT shape eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+ (header.payload.signature, base64url); Email PII [A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,} (redacted unless operator opts in via MCP_LOG_PII=1). Replacement: literal "[REDACTED]". | [shared/docs/02-security-baseline.md#secret-redaction-in-logs](shared/docs/02-security-baseline.md#secret-redaction-in-logs) | `templates/typescript/src/logger.ts#redact` | stdio, streamable_http |
| <a id="SEC-13"></a>`SEC-13` | MUST | No shell-execution tool ships in the default templates; any operator-added process-execution tool MUST use a strict command allowlist, reject shell metacharacters (; & | backtick $( > <), and spawn the child process directly without invoking a shell (execFile not exec in Node; subprocess.run([...], shell=False) in Python; exec.Command not bash -c in Go) | [shared/docs/02-security-baseline.md#shell-execution-disabled-by-default](shared/docs/02-security-baseline.md#shell-execution-disabled-by-default) | `templates/typescript/src/tools/index.ts#registeredTools` | stdio, streamable_http |
| <a id="SEC-14"></a>`SEC-14` | MUST | Templates ship allowlist-ready: the default configuration makes no outbound network requests to arbitrary destinations on behalf of tool inputs. Tools requiring outbound access expose an MCP_HTTP_ALLOWLIST (or similar) env var; default is empty = deny-all. Soft default (WARN on out-of-allowlist) PERMITTED; hard rejection RECOMMENDED. | [shared/docs/02-security-baseline.md#outbound-network-access](shared/docs/02-security-baseline.md#outbound-network-access) | `templates/typescript/src/security/network.ts#egressAllowlist` | stdio, streamable_http |
| <a id="SEC-15"></a>`SEC-15` | SHOULD | GET /.well-known/oauth-protected-resource returns an RFC 9728 stub JSON document containing _DEV_STUB: true and a _DEV_WARNING field; the route emits a WARN log line per request indicating the stub is in use | [shared/docs/02-security-baseline.md#oauth-protected-resource-metadata-stub](shared/docs/02-security-baseline.md#oauth-protected-resource-metadata-stub) | `templates/typescript/src/http/oauth-prm.ts#prmRoute` | stdio, streamable_http |
| <a id="SEC-16"></a>`SEC-16` | SHOULD | Per-template Dockerfile uses a multi-stage build (separate builder and runtime stages), runs as a non-root user at runtime, uses a minimal or distroless runtime base image, declares a HEALTHCHECK pointing at GET /health (when the default transport is HTTP), and uses exec-form ENTRYPOINT (JSON array, not shell string) so PID-1 receives signals directly and graceful shutdown works | [shared/docs/02-security-baseline.md#container-hardening](shared/docs/02-security-baseline.md#container-hardening) | `templates/typescript/Dockerfile` | stdio, streamable_http |
| <a id="SEC-17"></a>`SEC-17` | MUST | Config validator at startup parses every environment variable but does NOT log the values of parsed variables; secrets hidden inside custom MCP_* variables never reach logs at boot. The validator MAY log the list of keys that were parsed (names only). | [shared/docs/04-config-and-logging.md#startup-validation](shared/docs/04-config-and-logging.md#startup-validation) | `templates/typescript/src/config.ts#validateEnv` | stdio, streamable_http |

## Smoke Probes

Each probe is a JSON-RPC request plus shape assertions executed by Phase 4 CI against every template.

### <a id="SMOKE-01"></a>SMOKE-01: initialize handshake — version negotiation succeeds

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": {
      "name": "smoke",
      "version": "0"
    }
  }
}
```

**Required fields:**

- `result.protocolVersion`
- `result.serverInfo.name`
- `result.capabilities.tools`
- `result.capabilities.resources`
- `result.capabilities.prompts`

**Expect:**

```json
{
  "result.protocolVersion": {
    "equals": "2025-11-25"
  }
}
```

### <a id="SMOKE-02"></a>SMOKE-02: initialize with mismatched client version — server negotiates down or returns error envelope

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "1999-01-01",
    "capabilities": {},
    "clientInfo": {
      "name": "smoke",
      "version": "0"
    }
  }
}
```

**Required fields:**

- `jsonrpc`

**Expect:**

```json
{
  "jsonrpc": {
    "equals": "2.0"
  }
}
```

### <a id="SMOKE-03"></a>SMOKE-03: tools/list returns exactly the add tool

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

**Required fields:**

- `result.tools[].name`
- `result.tools[].inputSchema`

**Expect:**

```json
{
  "result.tools[].name": {
    "equals": "add"
  },
  "result.tools": {
    "length": 1
  }
}
```

### <a id="SMOKE-04"></a>SMOKE-04: tools/call add{a:3,b:4} returns 7 after 5 progress notifications

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "add",
    "arguments": {
      "a": 3,
      "b": 4
    },
    "_meta": {
      "progressToken": "smoke-04-pt"
    }
  }
}
```

**Required fields:**

- `result.content[].type`
- `result.content[].text`

**Forbidden fields:**

- `error`

**Expect:**

```json
{
  "result.isError": {
    "equals": false
  },
  "result.content[].text": {
    "equals": "7"
  }
}
```

### <a id="SMOKE-05"></a>SMOKE-05: tools/call add cancelled at 2500ms terminates the request with NO response (MCP spec: receiver sends none)

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "add",
    "arguments": {
      "a": 100,
      "b": 200
    },
    "_meta": {
      "progressToken": "smoke-05-pt"
    }
  }
}
```

**Required fields:**

**Forbidden fields:**

- `result`
- `error`

### <a id="SMOKE-06"></a>SMOKE-06: resources/list returns exactly the example://greeting resource

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "resources/list",
  "params": {}
}
```

**Required fields:**

- `result.resources[].uri`
- `result.resources[].mimeType`

**Expect:**

```json
{
  "result.resources[].uri": {
    "equals": "example://greeting"
  },
  "result.resources": {
    "length": 1
  }
}
```

### <a id="SMOKE-07"></a>SMOKE-07: resources/read example://greeting returns Hello from MCP

```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "resources/read",
  "params": {
    "uri": "example://greeting"
  }
}
```

**Required fields:**

- `result.contents[].uri`
- `result.contents[].text`

**Expect:**

```json
{
  "result.contents[].text": {
    "equals": "Hello from MCP"
  }
}
```

### <a id="SMOKE-08"></a>SMOKE-08: prompts/list returns exactly the greet prompt

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "prompts/list",
  "params": {}
}
```

**Required fields:**

- `result.prompts[].name`
- `result.prompts[].arguments`

**Expect:**

```json
{
  "result.prompts[].name": {
    "equals": "greet"
  },
  "result.prompts": {
    "length": 1
  }
}
```

### <a id="SMOKE-09"></a>SMOKE-09: prompts/get greet name=World renders Hello, World!

```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "prompts/get",
  "params": {
    "name": "greet",
    "arguments": {
      "name": "World"
    }
  }
}
```

**Required fields:**

- `result.messages[].role`
- `result.messages[].content.text`

**Expect:**

```json
{
  "result.messages[].role": {
    "equals": "user"
  },
  "result.messages[].content.text": {
    "equals": "Hello, World!"
  }
}
```

## Inspector Commands

Each command is a one-line MCP Inspector CLI invocation against the TS template's stdio entry point. Forward-reference: `templates/typescript/src/index.ts` lands in Phase 5.

| ID | Label | Command | Expected output |
|----|-------|---------|-----------------|
| <a id="INSP-01"></a>`INSP-01` | initialize handshake | `npx @modelcontextprotocol/inspector --cli npx tsx templates/typescript/src/index.ts --transport=stdio --method initialize` | Output JSON contains "protocolVersion": "2025-11-25" |
| <a id="INSP-02"></a>`INSP-02` | tools/call add | `npx @modelcontextprotocol/inspector --cli npx tsx templates/typescript/src/index.ts --transport=stdio --method tools/call --tool-name add --tool-arg a=3 --tool-arg b=4` | Output JSON contains content[0].text == "7" after ~5 seconds |
| <a id="INSP-03"></a>`INSP-03` | resources/read greeting | `npx @modelcontextprotocol/inspector --cli npx tsx templates/typescript/src/index.ts --transport=stdio --method resources/read --uri example://greeting` | Output JSON contains contents[0].text == "Hello from MCP" |
| <a id="INSP-04"></a>`INSP-04` | prompts/get greet | `npx @modelcontextprotocol/inspector --cli npx tsx templates/typescript/src/index.ts --transport=stdio --method prompts/get --prompt-name greet --prompt-arg name=World` | Output JSON contains messages[0].content.text == "Hello, World!" |
