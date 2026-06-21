// Secret-redaction integration — TEST-04 / T-08-13 (Information Disclosure).
//
// The shipped binary (src/logger.ts bound to fd 2, SEC-17 "never log values")
// must never let a planted operator secret reach the real child's STDERR. This
// is the spawned-subprocess END-TO-END complement to the unit-level regex bite
// proven in 08-02 (test/unit/logger.test.ts, which states this stderr path is
// covered here). The 08-02 unit test locks the value-shape regex CONTRACT + its
// fail-ability; this test locks the WIRED invariant: with a secret live in the
// child's env AND on the request, nothing leaks to fd 2.
//
// Method (research §Pattern 4 + Pitfall 6):
//   1. Build the child env EXPLICITLY via buildChildEnv — process.env is NOT
//      spread, so no real operator secret can leak in or give false confidence
//      (the env-isolation control, T-08-01).
//   2. Plant the literal `ghp_REDACTION_TEST_TOKEN_aaa` in the child env under
//      redact-key-named vars AND deliver it to the server as an
//      `Authorization: Bearer <secret>` header on a real /mcp request.
//   3. Drive the secret-bearing request so the server WRITES request-scoped log
//      lines to stderr WHILE the secret is live in its env + on the wire (the
//      per-request auth_hook WARN carries a request_id, proving the request was
//      processed during the capture window — the non-vacuity control: the
//      "absent" assertion is meaningless if the server logged nothing).
//   4. Capture the child's FULL stderr and assert the literal token is ABSENT.
//
// This is THE regression gate: if a future change starts dumping env / request
// headers (or a logger change bypasses redaction), the planted token surfaces in
// stderr and this test fails. logger.ts is NEVER edited to prove the bite (no
// destination seam — surgical-changes rule).

import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { type ChildProcess } from "node:child_process";
import { spawnServer, waitForListening } from "../helpers/spawn-server.js";
import { buildChildEnv } from "../helpers/env.js";

// The mandated planted secret literal (matches the ROADMAP/REQUIREMENTS exactly).
const PLANTED_SECRET = "ghp_REDACTION_TEST_TOKEN_aaa";

const HOST = "127.0.0.1";

// Reserve a free TCP port (bind :0, read the OS-assigned port, release) and pass
// it as a fixed MCP_HTTP_PORT — the shipped config rejects port 0 (Zod .min(1)),
// so an OS-ephemeral bind is not usable against the binary. Collision-free with
// the parallel http/shutdown integration tests without touching src.
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

let child: ChildProcess | undefined;

afterEach(() => {
  child?.kill("SIGTERM");
  child = undefined;
});

describe("secret-redaction integration (TEST-04)", () => {
  it("never leaks a planted secret to the child's stderr", async () => {
    const port = await reserveFreePort();
    const origin = `http://${HOST}:${String(port)}`;

    // Explicit child env: ONLY the required MCP_* vars plus the planted secret
    // under redact-key-named vars (process.env NOT spread — env isolation).
    child = spawnServer(
      ["--transport=http"],
      buildChildEnv({
        transport: "http",
        host: HOST,
        port: String(port),
        extra: {
          MCP_ORIGIN_ALLOWLIST: origin,
          // Planted under names the key-path redactor (Layer A) targets, and a
          // value the value-shape regex (Layer B) targets once Bearer-wrapped.
          MCP_TEST_TOKEN: PLANTED_SECRET,
          MCP_TEST_AUTHORIZATION: `Bearer ${PLANTED_SECRET}`,
        },
      }),
    );

    // Capture the FULL child stderr for the lifetime of the test.
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    await waitForListening(child);

    // Drive a real /mcp request carrying the secret as an Authorization header —
    // the per-request auth_hook WARN fires, exercising the wired logger. Origin
    // is in the allowlist so the request reaches the auth + transport path.
    await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        origin,
        authorization: `Bearer ${PLANTED_SECRET}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "redaction-test", version: "0" },
        },
      }),
    }).catch(() => {
      // A transport-level error is irrelevant — we only care about what the
      // server logged to stderr while handling the request.
    });

    // Give the async pino destination a beat to flush the request-scoped lines.
    await new Promise((r) => setTimeout(r, 250));

    // Non-vacuity guard: the server MUST have (a) booted (http_listening) and
    // (b) PROCESSED the secret-bearing request — the request-scoped auth_hook
    // WARN fires inside the /mcp handler while the secret is live. Without this,
    // an "absent" assertion could pass simply because nothing was logged.
    expect(stderr).toContain("http_listening");
    expect(stderr).toContain("auth_hook_dev_only_in_use");

    // THE gate: the planted secret never appears in cleartext on stderr.
    expect(stderr).not.toContain(PLANTED_SECRET);
  });
});
