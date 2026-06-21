// Integration test driver — spawn the BUILT server binary and connect an SDK
// client over stdio or Streamable HTTP.
//
// Vendored (copied + adapted, NOT imported across the template boundary) from
// the template's own smoke scripts so the template stands alone for Phase 9
// packaging:
//   - waitForListening: scripts/smoke-shutdown.ts (http_listening stderr detect)
//   - StdioClientTransport drive: scripts/check-surface-conformance.ts
//   - StreamableHTTPClientTransport drive: scripts/smoke-shutdown.ts
//
// Spawn path is `node dist/index.js` (the shipped artifact, matching the
// validator probes), NOT tsx — so `npm test`'s pretest build is a prerequisite.

import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// test/helpers/ -> template root is two levels up. Resolved from import.meta.url
// so the path is correct regardless of the process cwd.
const TEMPLATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Absolute path to the built server entrypoint (`npm run build` must have run). */
export const SERVER_BINARY = resolve(TEMPLATE_ROOT, "dist/index.js");

/**
 * Spawn `node dist/index.js [...args]` with an explicit env object.
 *
 * The env is whatever the caller passes (build it with buildChildEnv) — this
 * helper never injects process.env, preserving env isolation.
 */
export function spawnServer(
  args: string[],
  env: Record<string, string>,
): ChildProcess {
  return spawn("node", [SERVER_BINARY, ...args], {
    cwd: TEMPLATE_ROOT,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Resolve once the spawned server logs `http_listening` on stderr, or reject on
 * timeout / early exit. Mirrors scripts/smoke-shutdown.ts:waitForListening.
 *
 * Returns the bound port parsed from the structured log line (supports
 * MCP_HTTP_PORT=0 ephemeral binding), or undefined if the line carries no port.
 */
export function waitForListening(
  child: ChildProcess,
  timeoutMs = 10_000,
): Promise<number | undefined> {
  return new Promise<number | undefined>((resolveListening, rejectListening) => {
    let buf = "";
    const timer = setTimeout(() => {
      rejectListening(new Error(`server did not start within ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();

    child.stderr?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      if (buf.includes('"msg":"http_listening"')) {
        clearTimeout(timer);
        let port: number | undefined;
        for (const line of buf.split("\n")) {
          if (!line.includes('"msg":"http_listening"')) continue;
          try {
            const parsed = JSON.parse(line) as {
              data?: { port?: number };
              port?: number;
            };
            port = parsed.data?.port ?? parsed.port;
          } catch {
            // partial/non-JSON line — port stays undefined, caller can fall back.
          }
        }
        resolveListening(port);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      rejectListening(
        new Error(`server exited (code ${String(code)}) before listening`),
      );
    });
  });
}

/**
 * Connect an SDK Client to a freshly-spawned stdio server.
 *
 * Mirrors check-surface-conformance.ts: StdioClientTransport owns the child
 * lifecycle (it spawns `node dist/index.js --transport=stdio`). Returns the
 * connected client; call client.close() to terminate the child.
 */
export async function connectStdioClient(
  env: Record<string, string>,
  extraArgs: string[] = [],
): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_BINARY, "--transport=stdio", ...extraArgs],
    cwd: TEMPLATE_ROOT,
    env,
  });
  const client = new Client({ name: "vitest-stdio", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

/**
 * Connect an SDK Client to an already-listening HTTP server at baseUrl.
 *
 * Mirrors scripts/smoke-shutdown.ts. The caller owns the child process (spawn
 * it, waitForListening, then connect here).
 */
export async function connectHttpClient(baseUrl: URL): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(baseUrl);
  const client = new Client({ name: "vitest-http", version: "0.0.0" });
  await client.connect(transport);
  return client;
}
