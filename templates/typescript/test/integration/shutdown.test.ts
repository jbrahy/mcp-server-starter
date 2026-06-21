// Graceful-shutdown DRAIN integration — T-08-14 (Denial of Service / availability).
//
// Mirrors scripts/smoke-shutdown.ts EXACTLY (the proven drain contract — do not
// re-derive divergent assertions). On SIGTERM the server must STOP accepting new
// work but WAIT for the in-flight `add` to finish NORMALLY (bounded by
// MCP_SHUTDOWN_GRACE_MS) before closing transports — it must NOT close-to-cancel.
// A correct drain delivers the in-flight add's REAL "5" result, then exits 0.
//
// This is DISTINCT from the no-response CANCELLATION contract (08-03,
// smoke-stdio.test): cancellation aborts the handler and the SDK drops the result
// (no response); shutdown DRAINS to the real result. Asserting "5" here (not a
// cancellation envelope) is the whole point.
//
// Sequence:
//   1. spawn `node dist/index.js --transport=http` on a reserved free port
//      (config rejects MCP_HTTP_PORT=0, so reserve-then-bind a fixed port)
//   2. waitForListening, connect an SDK Client over StreamableHTTP
//   3. call add{a:2,b:3} WITHOUT an abort signal (a ~5s run)
//   4. ~1s in, send SIGTERM to the child
//   5. assert: (a) callTool RESOLVES to content text "5" (DRAINED, not cancelled),
//      (b) child exit code === 0, (c) elapsed since SIGTERM < grace
//   A HARD_TIMEOUT makes any hang (deadlocked drain / close-to-cancel that drops
//   the response) fail loudly within the 30s test timeout.

import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { type ChildProcess } from "node:child_process";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { type Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  spawnServer,
  waitForListening,
  connectHttpClient,
} from "../helpers/spawn-server.js";
import { buildChildEnv } from "../helpers/env.js";

const HOST = "127.0.0.1";
const KILL_AFTER_MS = 1000; // SIGTERM ~1s into the 5s add call
// CI-stable grace budget (the add run is ~5s; 30s leaves wide margin). Passed
// explicitly to the child so the assertion compares against a known bound.
const GRACE_MS = 30_000;
// Hard guard: < the 30s test timeout, > the 5s drain + boot. A hang (e.g. a
// close-to-cancel that drops the in-flight response) fails loudly here.
const HARD_TIMEOUT_MS = 20_000;

// Reserve a free TCP port (bind :0, read the OS-assigned port, release) and pass
// it as a fixed MCP_HTTP_PORT — the shipped config rejects port 0 (Zod .min(1)),
// so an OS-ephemeral bind is not usable against the binary. Collision-free with
// the parallel http/redaction integration tests without touching src.
function reserveFreePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const srv = createServer();
    srv.on("error", rejectPort);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      if (addr === null || typeof addr === "string") {
        srv.close();
        rejectPort(new Error("could not read ephemeral port"));
        return;
      }
      const { port } = addr;
      srv.close(() => {
        resolvePort(port);
      });
    });
  });
}

let client: Client | undefined;
let child: ChildProcess | undefined;

afterEach(async () => {
  await client?.close().catch(() => {});
  client = undefined;
  // SIGKILL on teardown: by the time afterEach runs the child has normally
  // already exited 0 (asserted in-test); this is a belt-and-suspenders cleanup.
  child?.kill("SIGKILL");
  child = undefined;
});

describe("graceful-shutdown drain integration (HARD-01)", () => {
  it("SIGTERM mid-add DRAINS to real \"5\", child exits 0, elapsed < grace", async () => {
    const port = await reserveFreePort();
    const origin = `http://${HOST}:${String(port)}`;

    child = spawnServer(
      ["--transport=http"],
      buildChildEnv({
        transport: "http",
        host: HOST,
        port: String(port),
        shutdownGraceMs: String(GRACE_MS),
        extra: { MCP_ORIGIN_ALLOWLIST: origin },
      }),
    );

    // Capture the child's exit so we can assert the clean exit code after drain.
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    const exited = new Promise<void>((resolveExit) => {
      child?.on("exit", (code, signal) => {
        exitCode = code;
        exitSignal = signal;
        resolveExit();
      });
    });

    // Hard overall guard: if the call never settles or the child never exits,
    // fail loudly rather than hang.
    let hardTimedOut = false;
    const hardTimer = setTimeout(() => {
      hardTimedOut = true;
      child?.kill("SIGKILL");
    }, HARD_TIMEOUT_MS);
    hardTimer.unref();

    await waitForListening(child);
    client = await connectHttpClient(new URL(`${origin}/mcp`));

    // Fire the slow add WITHOUT an abort signal, then SIGTERM ~1s in.
    let killAt = 0;
    const killTimer = setTimeout(() => {
      killAt = Date.now();
      child?.kill("SIGTERM");
    }, KILL_AFTER_MS);
    killTimer.unref();

    let resultText: string | undefined;
    let rejected = false;
    try {
      const result = await client.callTool(
        { name: "add", arguments: { a: 2, b: 3 } },
        CallToolResultSchema,
      );
      const parsed = CallToolResultSchema.parse(result);
      const first = parsed.content[0];
      if (first && first.type === "text") resultText = first.text;
    } catch {
      // A rejection here means the in-flight request was cancelled by the close —
      // the close-to-cancel anti-pattern this test exists to catch.
      rejected = true;
    } finally {
      clearTimeout(killTimer);
    }
    const settledAt = Date.now();

    expect(hardTimedOut, "hard timeout fired — drain hung or response dropped").toBe(
      false,
    );
    // The SIGTERM must actually have fired (the call did not finish before 1s).
    expect(killAt, "SIGTERM never fired — add settled before the kill mark").toBeGreaterThan(
      0,
    );
    // (a) DRAIN: the client received the REAL result, NOT a cancellation/reject.
    expect(rejected, "in-flight add REJECTED on shutdown — close-to-cancel, not drain").toBe(
      false,
    );
    expect(resultText).toBe("5");

    // Let the child finish its drain + exit, then stop the hard guard.
    await exited;
    clearTimeout(hardTimer);

    // (b) clean exit 0 (not killed by signal).
    expect(
      exitCode,
      `child exited code ${String(exitCode)} signal ${String(exitSignal)} — expected clean 0 after drain`,
    ).toBe(0);

    // (c) total drain elapsed must be inside the grace budget.
    const elapsed = settledAt - killAt;
    expect(elapsed, `drain took ${String(elapsed)}ms — not within grace ${String(GRACE_MS)}ms`).toBeLessThan(
      GRACE_MS,
    );
  });
});
