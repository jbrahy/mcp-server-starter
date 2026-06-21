// Startup environment configuration (TS-05).
//
// Parses the reserved MCP_* environment variables (locked in
// shared/docs/04-config-and-logging.md) with Zod, fail-fast on any parse
// error, and returns a frozen typed config. Validation runs synchronously,
// BEFORE the logger is bound, so a parse failure is written as a single
// structured JSON line to fd 2 (matching the log schema in
// shared/docs/03-observability.md) and the process exits non-zero.
//
// SEC-17: never log parsed VALUES — a secret may hide inside a custom MCP_*
// variable. Only key NAMES may ever be logged.

import { z } from "zod";

const ConfigSchema = z.object({
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MCP_ORIGIN_ALLOWLIST: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  MCP_LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  MCP_LOG_FILE: z.string().optional(),
  MCP_LOG_PII: z.enum(["0", "1"]).default("0"),
  MCP_CANCEL_GRACE_MS: z.coerce.number().int().min(0).default(1000),
  MCP_SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).default(30000),
  STRICT_ENV: z.enum(["0", "1"]).default("0"),
});

export type Config = Readonly<z.infer<typeof ConfigSchema>>;

// The reserved key set. Exported so the STRICT_ENV unknown-key scan (deferred
// to plan 05-03) can compare process.env MCP_* keys against it.
export const RESERVED_ENV_KEYS = Object.freeze([
  "MCP_TRANSPORT",
  "MCP_HTTP_HOST",
  "MCP_HTTP_PORT",
  "MCP_ORIGIN_ALLOWLIST",
  "MCP_LOG_LEVEL",
  "MCP_LOG_FILE",
  "MCP_LOG_PII",
  "MCP_CANCEL_GRACE_MS",
  "MCP_SHUTDOWN_GRACE_MS",
  "STRICT_ENV",
] as const);

// The MCP_-prefixed reserved keys. STRICT_ENV is reserved but NOT MCP_-prefixed,
// so it is excluded from the prefix scan below by construction.
const RESERVED_MCP_KEYS: ReadonlySet<string> = new Set(
  RESERVED_ENV_KEYS.filter((k) => k.startsWith("MCP_")),
);

/**
 * When STRICT_ENV=1, reject any process.env key starting with "MCP_" that is
 * not in the reserved set (LOG-09 typo guard). Zod's schema only sees the
 * curated subset we pass it, not the global env, so the unknown-key reject must
 * be an explicit scan over process.env (RESEARCH A3).
 *
 * On the first unknown key, writes ONE structured JSON error line to fd 2
 * naming the offending KEY only (never its value — SEC-17) and exits non-zero.
 * STRICT_ENV=0 (default) is a no-op: unknown keys are ignored.
 */
export function assertNoUnknownEnvKeys(env: NodeJS.ProcessEnv): void {
  if (env.STRICT_ENV !== "1") return;

  for (const key of Object.keys(env)) {
    if (!key.startsWith("MCP_")) continue;
    if (RESERVED_MCP_KEYS.has(key)) continue;
    // SEC-17: name the offending KEY, never the value.
    failConfig(key, "unknown_env_key");
  }
}

/** Write one structured JSON error line to fd 2, then exit non-zero. */
function failConfig(variable: string, reason: string): never {
  const line = {
    ts: new Date().toISOString(),
    level: "fatal",
    msg: "config_parse_failed",
    component: "config",
    // SEC-17: variable NAME and a coarse reason only — never the value.
    data: { variable, reason },
  };
  process.stderr.write(JSON.stringify(line) + "\n");
  process.exit(1);
}

/**
 * Parse and validate the environment. Returns a frozen typed config.
 * On any validation failure, writes one structured JSON line to fd 2 and
 * exits the process non-zero (fail-fast, LOG-08).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Value-level fail-fast first (LOG-08): a bad reserved value exits non-zero
  // with a structured error before any unknown-key scan.
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const first = result.error.issues[0];
    const variable = first?.path?.[0]?.toString() ?? "unknown";
    const reason = first?.code ?? "invalid";
    failConfig(variable, reason);
  }

  // STRICT_ENV=1 unknown-MCP_*-key reject (LOG-09), after a successful parse.
  assertNoUnknownEnvKeys(env);

  return Object.freeze(result.data);
}
