# Observability

This document locks the structured log line shape, the MCP progress
notification flow, and the cancellation contract. Every template —
TypeScript canonical and every future-language port — emits
byte-for-byte compatible log lines.

## Log destination

In `stdio` mode, log lines MUST be written to stderr (fd 2). Writing
log lines to stdout corrupts the JSON-RPC framing on stdin/stdout
(see `01-transport.md` §"Stdout MUST contain only JSON-RPC").

In HTTP mode, log lines MUST be written to stderr by default and MAY
additionally be teed to a file via the `MCP_LOG_FILE` environment
variable.

Log lines MUST be flushed eagerly (not buffered indefinitely). On
graceful shutdown, the logger MUST drain its buffer before exit.

## Log line format

Every log line is a single-line UTF-8 JSON object terminated by a
newline. The top-level keys are fixed and closed — additional
information goes inside a `data` object.

### Required top-level keys

| Key | Type | Value |
|-----|------|-------|
| `ts` | string | ISO-8601 with millisecond precision, UTC `Z` suffix. Example: `"2026-05-22T19:35:00.123Z"`. Conforms to [RFC 3339](https://www.rfc-editor.org/rfc/rfc3339). |
| `level` | string | One of: `"trace"`, `"debug"`, `"info"`, `"warn"`, `"error"`, `"fatal"`. Lowercase only. NOT numeric. |
| `msg` | string | Short event name in `snake_case`. Example: `"protocol_version_negotiated"`. Designed for grep. NOT an English sentence. |
| `request_id` | string | ULID (26-character Crockford base32, monotonic). See the [ULID spec](https://github.com/ulid/spec). |

> **Why ULID for `request_id`:** monotonic ordering means
> `request_id` sorts chronologically — useful for log triage.
> Crockford base32 means no ambiguous characters (`0`/`O`, `1`/`I`/`l`).
> Fixed 26-character width simplifies log-aggregation pipelines.
> UUIDs are 36 characters with hyphens and do not sort
> chronologically.

> **Why lowercase string for `level`:** Pino (TypeScript) emits
> numeric levels by default (`30` for info, `40` for warn). Other
> language ports do not share that default. Locking on lowercase
> string here means every language port emits the same level
> encoding without per-template aliasing.

### Reserved top-level keys (present when applicable)

| Key | Type | When present |
|-----|------|--------------|
| `component` | string | Module name in `snake_case`. Examples: `"server"`, `"transport_http"`, `"tool_add"`, `"security_origin"`. Set on every line. |
| `transport` | string | `"stdio"` or `"http"`. Set at server boot, present on every line afterward. |
| `negotiated_protocol` | string | MCP protocol version negotiated on `initialize`. Set on `initialize` completion, present on every line afterward. |
| `tool_name` | string | Set during tool execution; absent otherwise. |

### Additional data

Any additional event-specific fields go inside a `data` object, NOT
at the top level. This keeps the reserved field set stable across log
lines and across language ports.

```json
{
  "ts": "2026-05-22T19:35:00.123Z",
  "level": "info",
  "msg": "tool_call_started",
  "request_id": "01HNGV3K8YZQX2WAVM4PRT5BFE",
  "component": "tool_add",
  "transport": "stdio",
  "negotiated_protocol": "2025-11-25",
  "tool_name": "add",
  "data": {
    "arguments_hash": "9f2c4a..."
  }
}
```

### Forbidden top-level fields

Templates MUST NOT include the following at the top level:

- `pid`, `hostname` — log aggregators add these from the transport
  layer; per-line inclusion bloats the log and leaks environment
  detail.
- `name`, `app` — implied by the deployment context, not the line.
- `time` — collides with `ts`; some logger defaults (Pino) emit
  `time` instead. Templates MUST rename to `ts`.

### Redaction

Every log line passes through the redaction layer specified in
`02-security-baseline.md` §"Secret redaction in logs" before being
written. Redaction operates on top-level keys, on nested keys, and on
every string value via regex.

## Canonical events

The following events have locked names and locked top-level fields.
Every template emits these with the names and fields specified.

### `protocol_version_negotiated`

Emitted once, immediately after the `initialize` handshake completes.
Level: `info`.

Required fields:

- Top level: `ts`, `level: "info"`,
  `msg: "protocol_version_negotiated"`, `request_id`,
  `component: "server"`, `transport`, `negotiated_protocol`.
- `data`:
  `{client_version: "<from client initialize>", server_version: "<package version>"}`.

### `request_started` / `request_completed`

Emitted at the start and end of every JSON-RPC request.

- `request_started`: level `debug`,
  `data: {method: "<json-rpc method>"}`.
- `request_completed`: level `info` for success, `warn` or `error`
  for failure,
  `data: {method, duration_ms: <integer>, status: "ok" | "error"}`.

### `tool_call_started` / `tool_call_completed` / `tool_call_cancelled`

Emitted around tool execution.

- `tool_call_started`: level `info`, fields include `tool_name`,
  `data: {arguments_hash: "<sha256 prefix>"}`. Do NOT log raw
  arguments — they pass through redaction, but `arguments_hash`
  avoids the entire surface.
- `tool_call_completed`: level `info`, fields include `tool_name`,
  `data: {duration_ms, status}`.
- `tool_call_cancelled`: level `info`, fields include `tool_name`,
  `data: {duration_ms, cancelled_at_step: <integer>}`.

### Security WARNs

- `auth_hook_dev_only_in_use`: level `warn`, emitted per request from
  the DEV-ONLY auth hook seam. Includes the literal text
  `DEV-ONLY auth hook in use — replace before production` in
  `msg.data.notice`.
- `http_bound_non_loopback`: level `warn`, emitted once at startup if
  `MCP_HTTP_HOST` is set to a non-loopback address.
- `origin_rejected`: level `warn`, emitted per rejected request,
  `data: {origin: "<rejected value>", path: "<request path>"}`.

## Request correlation

Every log line for a given request MUST carry the same `request_id`.
The correlation ID is propagated via:

- **HTTP mode:** the inbound `mcp-correlation-id` request header if
  present; otherwise a fresh ULID generated at request start.
- **`stdio` mode:** a fresh ULID generated at request start.

A server-generated internal request ID is ALSO logged at the start of
the request (under `data.internal_request_id`) so log search remains
reliable even if a client forges or collides on the inbound
correlation ID.

> **Why expose both:** clients want their own correlation IDs to
> survive into the server's logs for end-to-end tracing. Servers need
> their own correlation IDs to be unforgeable. Logging both — the
> inbound ID as `request_id` and the server-generated ID as
> `data.internal_request_id` — satisfies both constraints.

## Progress notifications

The MCP `2025-11-25` specification defines the
`notifications/progress` notification shape. Templates MUST support
emitting progress notifications during long-running tool executions.

Required behavior:

1. The tool handler MAY emit zero or more `notifications/progress`
   notifications during execution.
2. Each notification's `progressToken` MUST match the
   `progressToken` provided by the client in the tool-call request.
3. Each notification carries `progress` (current units) and OPTIONALLY
   `total` (target units) and a free-form `message`.
4. The notification is delivered out of band of the request /
   response. The request still terminates with a single response when
   the tool completes.

Templates SHOULD emit progress notifications at most once per second
for long-running tools, to avoid flooding the client.

## Cancellation

The MCP `2025-11-25` specification defines `notifications/cancelled`.
When a client sends `notifications/cancelled` for an in-flight
request, the server MUST:

1. Signal cancellation to the tool handler (via `AbortSignal` in
   TypeScript, `context.Context` cancellation in Go, equivalent in
   each language).
2. Stop work as soon as the next checkpoint allows.
3. **Send a final JSON-RPC response** to the cancelled request within
   a bounded grace period (default 1000 ms; configurable via
   `MCP_CANCEL_GRACE_MS`). The final response is a tool result with
   `isError: false` and content describing the cancellation state.

The final response MUST NOT be a JSON-RPC protocol error.
Cancellation is a tool-level event, not a protocol error.

> **Why a final response after cancellation:**
> [openai/codex issue #20925](https://github.com/openai/codex/issues/20925)
> documents the failure mode — clients hang indefinitely when a
> cancellable request does not receive a final response. The "stop
> work and silently disappear" pattern that feels intuitive to
> implement is broken; clients track request lifecycles via the
> response, not via the cancellation notification.

## Conformance

Templates are graded against this document by the following matrix
checkpoint IDs (assigned by `shared/compliance-matrix.yaml`):

- `TBD-MATRIX-LOG-DESTINATION-STDERR` — `stdio` mode writes logs to
  stderr only.
- `TBD-MATRIX-LOG-SCHEMA-FIELDS` — required top-level keys present.
- `TBD-MATRIX-LOG-SCHEMA-TS-ISO8601` — `ts` is ISO-8601
  ms-precision string.
- `TBD-MATRIX-LOG-SCHEMA-LEVEL-STRING` — `level` is lowercase
  string, not numeric.
- `TBD-MATRIX-LOG-SCHEMA-REQUEST-ID-ULID` — `request_id` is a
  26-char Crockford base32 ULID.
- `TBD-MATRIX-LOG-EVENTS-CANONICAL` — `protocol_version_negotiated`,
  `request_started`, `request_completed`, `tool_call_*` emitted with
  locked field set.
- `TBD-MATRIX-PROGRESS-NOTIFICATIONS` — emitted with matching
  `progressToken`.
- `TBD-MATRIX-CANCELLATION-FINAL-RESPONSE` — final response
  delivered within `MCP_CANCEL_GRACE_MS` of `notifications/cancelled`.
