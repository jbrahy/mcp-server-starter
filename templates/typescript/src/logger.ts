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
// SECRET REDACTION (two-layer: `redact` key-path + `hooks.streamWrite` value
// regex) is DEFERRED to plan 05-03. buildLogger is structured so 05-03 adds
// those pino options here without reshaping any call site.

import pino, { type Logger, type LoggerOptions } from "pino";
import { type Config } from "./config.js";

export type { Logger };

/**
 * Build the process-global logger bound to stderr (fd 2).
 *
 * @param cfg validated config (supplies the minimum log level)
 */
export function buildLogger(cfg: Config): Logger {
  const destination = pino.destination({ dest: 2, sync: false });

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
    // SEAM for plan 05-03: add `redact: { paths, censor }` (key-path) and
    // `hooks: { streamWrite }` (value-shape regex) here. Do NOT implement
    // redaction in this slice.
  };

  return pino(options, destination);
}
