# Configuration and Logging

This document specifies the environment-variable conventions every
template honors, the startup validation contract, and the logger
sink behavior in each transport mode.

## Environment variables

Templates read configuration from environment variables. Configuration
via files or command-line flags is OPTIONAL and template-specific;
environment variables are the universal contract.

### Naming convention

All template-defined environment variables use the prefix `MCP_`
followed by `SCREAMING_SNAKE_CASE`. Examples: `MCP_TRANSPORT`,
`MCP_HTTP_HOST`, `MCP_LOG_LEVEL`.

Templates MUST NOT read OS-level or third-party variables (for
example, `PORT`, `HOST`, `NODE_ENV`) as their primary configuration
source. Templates MAY accept third-party variables as fallbacks if
the corresponding `MCP_*` variable is unset, but MUST document the
fallback explicitly in the per-template `README.md`.

### Reserved variables

The following variables are reserved across every template with the
semantics specified.

| Variable | Type | Default | Effect |
|----------|------|---------|--------|
| `MCP_TRANSPORT` | `stdio` / `http` | `stdio` | Selects the transport at startup. `--transport` command-line flag wins if both are set. |
| `MCP_HTTP_HOST` | string | `127.0.0.1` | Bind address for HTTP transport. Non-loopback values emit a startup `WARN`. |
| `MCP_HTTP_PORT` | integer | `3000` | Bind port for HTTP transport. Must be in `[1, 65535]`. |
| `MCP_ORIGIN_ALLOWLIST` | comma-separated strings | `""` (empty) | Allowed `Origin` header values for HTTP transport. Empty = deny-all browser clients (no-`Origin` clients still allowed). |
| `MCP_LOG_LEVEL` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` | `info` | Minimum log level emitted. |
| `MCP_LOG_FILE` | path | unset | Optional secondary log sink. When set, log lines are written to stderr AND appended to this path. |
| `MCP_LOG_PII` | `0` / `1` | `0` | When `1`, email addresses bypass the PII redaction (see `02-security-baseline.md` §PII). |
| `MCP_CANCEL_GRACE_MS` | integer milliseconds | `1000` | Grace period after `notifications/cancelled` before the server stops waiting and emits the final response. |
| `MCP_SHUTDOWN_GRACE_MS` | integer milliseconds | `30000` | Grace period on SIGTERM/SIGINT before forced exit. |
| `STRICT_ENV` | `0` / `1` | `0` | When `1`, the server rejects unknown `MCP_*` variables at startup (typo guard). |

Templates MAY add additional `MCP_*` variables for template-specific
configuration. Additions MUST be documented in the per-template
`README.md`.

### Startup validation

Templates MUST validate every environment variable at startup, before
any transport is bound or any handler is registered. Validation is
fail-fast: a parse error causes the server to exit non-zero with a
structured stderr error line.

Required validation behavior:

1. Every reserved variable above MUST be parsed with its declared
   type. Type mismatches (for example, `MCP_HTTP_PORT=abc`) cause
   exit.
2. Enumerated variables (`MCP_TRANSPORT`, `MCP_LOG_LEVEL`,
   `MCP_LOG_PII`, `STRICT_ENV`) MUST reject values outside their
   enumeration.
3. Range-bounded variables (`MCP_HTTP_PORT` in `[1, 65535]`,
   `MCP_CANCEL_GRACE_MS` >= 0, `MCP_SHUTDOWN_GRACE_MS` >= 0) MUST
   reject out-of-range values.
4. When `STRICT_ENV=1`, the validator MUST emit a structured error
   if any environment variable starting with `MCP_` is not in the
   reserved or template-specific list.

The validator MUST NOT log the values of parsed variables at boot. A
future operator dumping logs to a public location should not leak the
secret hidden inside a custom `MCP_*` variable. The validator MAY log
the list of keys that were parsed (names only).

The validator MUST run synchronously, before the logger is bound to
any sink. A parse failure is written to stderr as a single JSON line
matching the log line format in `03-observability.md`:

```json
{"ts":"2026-05-22T19:35:00.123Z","level":"fatal","msg":"config_parse_failed","data":{"variable":"MCP_HTTP_PORT","reason":"out_of_range"}}
```

Templates SHOULD use a schema-validation library appropriate to the
ecosystem (Zod in TypeScript, Pydantic in Python, the equivalent
elsewhere) to keep validation declarative.

## Logger sink behavior

The logger sink — the destination where log lines are written —
depends on transport mode.

### `stdio` mode

- **Primary sink:** stderr (fd 2). MANDATORY. The logger MUST bind
  fd 2 before any code that could emit a log line runs.
- **Secondary sink:** file at `MCP_LOG_FILE` if set. Templates MUST
  open the file with `O_APPEND` and MUST handle "file rotated under
  us" gracefully (re-open on each write batch or use the operating
  system's append-on-write semantics).
- **Stdout sink:** PROHIBITED. Templates MUST NOT have a code path
  that writes to stdout in `stdio` mode.

### HTTP mode

- **Primary sink:** stderr (fd 2). MANDATORY.
- **Secondary sink:** file at `MCP_LOG_FILE` if set, same semantics
  as `stdio` mode.
- **Stdout sink:** PERMITTED but discouraged. Container deployments
  (Docker, Kubernetes) typically aggregate stderr and stdout into
  the same log stream; templates MAY emit logs to stdout in HTTP
  mode for environments that prefer it, but the default is
  stderr-only to keep behavior consistent with `stdio` mode.

## Log rotation

Templates MUST NOT implement log rotation in process. Log rotation is
the responsibility of the operator's log-aggregation stack (syslog,
journald, the Docker log driver, the Kubernetes container log
rotator, a log shipper).

Templates that need to support per-process log files for development
workflows SHOULD point operators at external tools (`logrotate`,
`multilog`, `svlogd`) in the per-template `README.md`.

> **Why no in-process rotation:** in-process log rotation is a
> frequent source of bugs — race conditions on file handles, lost
> lines during rotation, double-writes, locking. Every modern
> deployment environment has a battle-tested log-rotation tool.
> Templates that try to roll their own ship the bug surface inside
> every deployment.

## Graceful shutdown

Templates MUST register SIGINT and SIGTERM handlers. On signal:

1. Stop accepting new requests (close the listening transport).
2. Allow in-flight requests to complete (via the cancellation
   contract in `03-observability.md` for cancellable tools).
3. Flush the logger.
4. Exit `0`.

Total time from signal receipt to exit is bounded by
`MCP_SHUTDOWN_GRACE_MS` (default `30000` milliseconds = 30 seconds).
If the grace period elapses, the template MUST forcibly close
transports and exit `0` anyway. Operators expect SIGTERM to cause
exit within a bounded time.

## Conformance

Templates are graded against this document by the following matrix
checkpoint IDs (assigned by `shared/compliance-matrix.yaml`):

- `TBD-MATRIX-CONFIG-ENV-PREFIX` — all template-defined variables
  use `MCP_` prefix.
- `TBD-MATRIX-CONFIG-STARTUP-VALIDATION` — fail-fast on parse errors.
- `TBD-MATRIX-CONFIG-STRICT-ENV` — `STRICT_ENV=1` rejects unknown
  `MCP_*` variables.
- `TBD-MATRIX-CONFIG-NO-VALUE-LOGGING` — the boot-time validator
  does not log values.
- `TBD-MATRIX-LOG-SINK-STDERR-DEFAULT` — primary sink is stderr.
- `TBD-MATRIX-LOG-SINK-NO-STDOUT-STDIO` — stdout sink prohibited in
  `stdio` mode.
- `TBD-MATRIX-SHUTDOWN-GRACEFUL` — SIGTERM/SIGINT trigger bounded
  graceful shutdown.
