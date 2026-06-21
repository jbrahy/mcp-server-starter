// Structured logger bound to stderr (TS-06).
//
// pino is bound to fd 2 (stderr) via pino.destination — in stdio mode stdout
// (fd 1) carries JSON-RPC ONLY, so no log byte may ever reach it. The logger
// MUST be built before any code that could emit a log line.
//
// Locked log schema (shared/docs/03-observability.md):
//   - `ts`    ISO-8601 ms-precision UTC string (NOT the default epoch `time`)
//   - `level` lowercase string (NOT pino's default numeric level)
//   - `msg`   the message key (NOT `message`)
//   - base:null drops the forbidden top-level `pid`/`hostname`
//
// SECRET REDACTION is two-layer (TS-07 / SEC-06..SEC-12 / SEC-17), both
// mandatory:
//   - Layer A — pino `redact` (key-path): redacts a value whenever its object
//     KEY is a known secret name, regardless of the value's shape.
//   - Layer B — `hooks.streamWrite` (value-shape regex): runs on the
//     fully-stringified JSON line and replaces secret-SHAPED substrings that
//     appear anywhere (e.g. inside a dumped tool argument or process.env).
// The regex set and the `[REDACTED]` censor are byte-locked in
// shared/docs/02-security-baseline.md — copied verbatim, never re-derived.

import pino, { type Logger, type LoggerOptions } from "pino";
import { type Config } from "./config.js";

export type { Logger };

// The literal censor (02-security-baseline.md §Replacement value): no length,
// prefix, or hash preservation. JSON-safe (no quotes/backslashes/newlines), so
// it is safe to splice into the already-serialized line in Layer B.
const REDACTED = "[REDACTED]";

// Layer A — key-path redaction (SEC-06 header names + SEC-07 field names).
// pino paths are case-sensitive, so enumerate lowercased forms and apply them
// at every depth via the `*.` wildcard. Lines are pre-lowercased on their keys
// by pino's matcher only for these exact paths; a top-level and a wildcard
// nested path are listed for each known key.
const REDACT_KEYS = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "password",
  "api_key",
  "apikey",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "client_secret",
  "private_key",
];
const REDACT_KEY_PATHS: string[] = REDACT_KEYS.flatMap((k) => {
  // Bracket-quote the key so names containing a hyphen (e.g. set-cookie) are
  // valid pino paths. Cover both top-level and any nested depth.
  const quoted = `["${k}"]`;
  return [quoted, `*${quoted}`];
});

// Layer B — value-shape regexes, transcribed VERBATIM from
// shared/docs/02-security-baseline.md §Token-shape patterns. ORDER MATTERS:
// `sk-ant-` MUST precede the generic `sk-` so Anthropic keys are not partially
// matched. The email pattern is gated on MCP_LOG_PII and applied separately.
const VALUE_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
  /AKIA[0-9A-Z]{16}/g,
  /(?<![A-Za-z0-9])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9])/g, // AWS secret access key
  /gh[pousr]_[A-Za-z0-9]{36}/g,
  /github_pat_[A-Za-z0-9_]{82,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // ORDER: ant before generic sk-
  /sk-[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
];

// PII (gated): redacted only when MCP_LOG_PII === "0" (02-security-baseline.md
// §PII). Operators opt in with MCP_LOG_PII=1 for support workflows.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Apply the value-shape regex set to the fully-stringified JSON line. Each
 * match is replaced with the literal `[REDACTED]` (JSON-safe), so the returned
 * line remains valid JSON. `redactPii` adds the email pattern when PII logging
 * is off.
 */
function redactValuePatterns(line: string, redactPii: boolean): string {
  let out = line;
  for (const re of VALUE_PATTERNS) out = out.replace(re, REDACTED);
  if (redactPii) out = out.replace(EMAIL_PATTERN, REDACTED);
  return out;
}

/**
 * Build the process-global logger bound to stderr (fd 2).
 *
 * @param cfg validated config (supplies the minimum log level)
 */
export function buildLogger(cfg: Config): Logger {
  const destination = pino.destination({ dest: 2, sync: false });

  // PII gate (SEC-12): redact emails unless the operator opts in with
  // MCP_LOG_PII=1. Resolved once at build time from validated config.
  const redactPii = cfg.MCP_LOG_PII === "0";

  const options: LoggerOptions = {
    level: cfg.MCP_LOG_LEVEL,
    base: null, // drop forbidden top-level pid/hostname
    messageKey: "msg",
    // Emit `ts` (ISO-8601 ms Z) instead of pino's default top-level `time`.
    // pino concatenates this fragment, so it MUST begin with a comma.
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      // Lowercase string level (LOG-04), not the default numeric level.
      level: (label) => ({ level: label }),
    },
    // Layer A — key-path redaction (SEC-06/07): value redacted whenever its
    // KEY is a known secret name, regardless of value shape.
    redact: { paths: REDACT_KEY_PATHS, censor: REDACTED },
    // Layer B — value-shape redaction (SEC-08..12): the regex set runs on the
    // fully-stringified line so secret-SHAPED values are caught anywhere.
    hooks: {
      streamWrite: (s) => redactValuePatterns(s, redactPii),
    },
  };

  return pino(options, destination);
}
