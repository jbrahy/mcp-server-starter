// Graceful-shutdown smoke — proves DRAIN-not-cancel (HARD-01 / SC#1) empirically
// against a real HTTP server.
//
// The load-bearing contract (research §Pattern 1 + Pitfall 1): on SIGTERM the
// server must STOP accepting new work but WAIT for in-flight requests to finish
// NORMALLY (bounded by MCP_SHUTDOWN_GRACE_MS) before closing transports — it must
// NOT close-to-cancel. The SDK's transport.close() aborts in-flight handlers and
// the aborted result is dropped (no response). So a correct drain delivers the
// in-flight add's REAL "5" result, then the process exits 0.
//
// This script:
//   1. spawns `tsx src/index.ts --transport=http` on a fixed port
//   2. connects an SDK Client over StreamableHTTPClientTransport
//   3. calls add{a:2,b:3} WITHOUT an abort signal (a ~5s run)
//   4. ~1s into the call, sends SIGTERM to the child
//   5. asserts: (a) callTool RESOLVES to content text "5" (DRAINED, not
//      cancelled), (b) child exit code === 0, (c) total elapsed < grace
//
// A hard timeout makes any hang (e.g. a deadlocked drain, or a close-to-cancel
// that drops the response) fail loudly instead of stalling.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const PORT = 39_417; // fixed, unlikely-to-collide local port
const GRACE_MS = Number(process.env.MCP_SHUTDOWN_GRACE_MS ?? "30000");
const KILL_AFTER_MS = 1000; // send SIGTERM ~1s into the 5s add call
const SERVER_BOOT_TIMEOUT_MS = 10_000;
const HARD_TIMEOUT_MS = 20_000; // < add's 5s run leaves margin; guards a hang

function fail(message: string): never {
  process.stdout.write(`FAIL: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const cwd = resolve(fileURLToPath(import.meta.url), "..", "..");
  const child = spawn("npx", ["tsx", "src/index.ts", "--transport=http"], {
    cwd,
    env: {
      ...process.env,
      MCP_TRANSPORT: "http",
      MCP_HTTP_PORT: String(PORT),
      MCP_HTTP_HOST: "127.0.0.1",
      MCP_SHUTDOWN_GRACE_MS: String(GRACE_MS),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  // Resolve the child's exit so we can assert the exit code after the drain.
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  const exited = new Promise<void>((resolveExit) => {
    child.on("exit", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      resolveExit();
    });
  });

  // Hard overall guard: if the call never settles or the child never exits, fail
  // loudly rather than hang (e.g. a close-to-cancel that drops the response).
  const hardTimer = setTimeout(() => {
    child.kill("SIGKILL");
    fail(
      `did not complete within ${HARD_TIMEOUT_MS}ms — drain likely hung or the in-flight response was dropped (close-to-cancel)`,
    );
  }, HARD_TIMEOUT_MS);
  hardTimer.unref();

  // Wait for the server to log http_listening on stderr.
  await waitForListening(child, SERVER_BOOT_TIMEOUT_MS);

  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${PORT}/mcp`),
  );
  const client = new Client({ name: "smoke-shutdown", version: "0.0.0" });
  await client.connect(transport);

  // Fire the slow add WITHOUT an abort signal, then SIGTERM ~1s in.
  const callStart = Date.now();
  let killAt = 0;
  const killTimer = setTimeout(() => {
    killAt = Date.now();
    child.kill("SIGTERM");
  }, KILL_AFTER_MS);
  killTimer.unref();

  let resultText: string | undefined;
  try {
    const result = await client.callTool(
      { name: "add", arguments: { a: 2, b: 3 } },
      CallToolResultSchema,
    );
    const parsed = CallToolResultSchema.parse(result);
    const first = parsed.content[0];
    if (first && first.type === "text") resultText = first.text;
  } catch (err) {
    clearTimeout(killTimer);
    // A rejection here means the in-flight request was cancelled by the close —
    // exactly the close-to-cancel anti-pattern this smoke exists to catch.
    fail(
      `the in-flight add call REJECTED on shutdown (${err instanceof Error ? err.message : String(err)}) — this is close-to-cancel, not drain`,
    );
  }
  clearTimeout(killTimer);
  const settledAt = Date.now();

  if (killAt === 0) {
    fail("SIGTERM never fired (the add call settled before the 1s kill mark)");
  }
  // (a) DRAIN: the client must receive the REAL result, not a cancellation.
  if (resultText !== "5") {
    fail(`expected drained result "5", got ${JSON.stringify(resultText)}`);
  }

  // Let the child finish its drain + exit.
  await Promise.race([exited, delay(HARD_TIMEOUT_MS)]);
  clearTimeout(hardTimer);
  await client.close().catch(() => {});

  // (b) clean exit 0 (not killed by signal).
  if (exitCode !== 0) {
    fail(
      `child exited with code ${String(exitCode)} signal ${String(exitSignal)} — expected clean exit 0 after drain`,
    );
  }
  // (c) total drain elapsed must be inside the grace budget.
  const elapsed = settledAt - killAt;
  if (elapsed >= GRACE_MS) {
    fail(`drain took ${elapsed}ms — not within MCP_SHUTDOWN_GRACE_MS (${GRACE_MS}ms)`);
  }

  process.stdout.write(
    `PASS: SIGTERM mid-add drained to "5", child exited 0 (${elapsed}ms after signal, grace ${GRACE_MS}ms)\n`,
  );
  process.exit(0);
}

/**
 * Resolve once the spawned server logs `http_listening` on stderr, or reject on
 * timeout / early exit. The server's structured logger writes JSON lines to fd 2.
 */
function waitForListening(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolveListening, rejectListening) => {
    let buf = "";
    const timer = setTimeout(() => {
      rejectListening(new Error(`server did not start within ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();
    child.stderr?.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      if (buf.includes('"msg":"http_listening"')) {
        clearTimeout(timer);
        resolveListening();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      rejectListening(new Error(`server exited (code ${String(code)}) before listening`));
    });
  });
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
