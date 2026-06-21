// Minimal child-env factory for integration tests.
//
// Threat T-08-01 (Information Disclosure): a spawned server must NOT inherit the
// test runner's — and therefore the operator's — real environment, or a
// redaction test could pass vacuously (no real secret present) or a real secret
// could bleed into test output. This factory builds a child env from scratch:
// it explicitly does NOT spread process.env. Callers add only the vars the child
// needs (e.g. a planted redaction secret for TEST-04).

export interface ChildEnvOptions {
  /** Transport mode for the spawned server. */
  transport?: "stdio" | "http";
  /** HTTP host (only meaningful for transport "http"). */
  host?: string;
  /** HTTP port. Pass "0" for an ephemeral port (read back from the listen log). */
  port?: string;
  /** Cancellation grace budget (ms). */
  cancelGraceMs?: string;
  /** Shutdown drain grace budget (ms). */
  shutdownGraceMs?: string;
  /** Extra vars (e.g. a planted secret) merged in last. */
  extra?: Record<string, string>;
}

/**
 * Build an explicit child environment that does NOT spread process.env.
 *
 * PATH is included because Node itself needs it to resolve the interpreter; no
 * other inherited variable is forwarded, so the child cannot see real secrets
 * from the runner's shell.
 */
export function buildChildEnv(opts: ChildEnvOptions = {}): Record<string, string> {
  const env: Record<string, string> = {
    // Node needs PATH to locate the runtime; everything else is set explicitly.
    PATH: process.env.PATH ?? "",
    MCP_TRANSPORT: opts.transport ?? "stdio",
  };
  if (opts.host !== undefined) env.MCP_HTTP_HOST = opts.host;
  if (opts.port !== undefined) env.MCP_HTTP_PORT = opts.port;
  if (opts.cancelGraceMs !== undefined) env.MCP_CANCEL_GRACE_MS = opts.cancelGraceMs;
  if (opts.shutdownGraceMs !== undefined) env.MCP_SHUTDOWN_GRACE_MS = opts.shutdownGraceMs;
  if (opts.extra) Object.assign(env, opts.extra);
  return env;
}
