// Cancellation smoke driver — proves the no-response cancellation contract
// (PROG-02 / SMOKE-05) empirically against a real stdio server.
//
// Per the MCP 2025-11-25 spec (basic/utilities/cancellation): on
// notifications/cancelled the receiver stops processing, frees resources, and
// sends NO response for the cancelled request; the sender ignores any late
// response. The pinned @modelcontextprotocol/sdk@1.29.0 enforces this — it
// drops any handler result that settles after the abort signal fires.
//
// This script spawns the template over stdio, calls `add` with a progressToken,
// and aborts the in-flight request at 2500ms via an AbortController passed to
// callTool. The client's own cancellation path sends notifications/cancelled to
// the server and rejects the callTool promise. We assert the spec-conformant
// outcome: (a) the callTool promise REJECTS/aborts (the request terminates),
// (b) NO tool result is delivered for that request, and (c) ~3 progress
// notifications arrived before the cancel. A hard 15s timeout makes any hang
// (e.g. a client that waits for a response that will never come) fail loudly.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const CANCEL_AFTER_MS = 2500; // shared/example-surface.yaml timing.cancel_after_ms
const EXPECT_PROGRESS_AT_CANCEL = 3; // timing.expect_progress_count_at_cancel
const PROGRESS_TOLERANCE = 1; // allow ±1 for runner timing jitter
const GRACE_MS = Number(process.env.MCP_CANCEL_GRACE_MS ?? "1000");
const HARD_TIMEOUT_MS = 15_000; // guard against a hang waiting for a response that never arrives

function fail(message: string): never {
  process.stdout.write(`FAIL: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts", "--transport=stdio"],
    cwd: resolve(fileURLToPath(import.meta.url), "..", ".."),
    env: { ...process.env, MCP_CANCEL_GRACE_MS: String(GRACE_MS) } as Record<
      string,
      string
    >,
  });

  const client = new Client({ name: "smoke-cancellation", version: "0.0.0" });

  // Hard overall timeout: if the call neither resolves nor rejects (a client
  // hanging for a response the spec says will never come), this is the explicit
  // loud-failure guard.
  const hardTimer = setTimeout(() => {
    fail(
      `call did not settle within ${HARD_TIMEOUT_MS}ms — request hung waiting for a response (a cancelled request gets none)`,
    );
  }, HARD_TIMEOUT_MS);
  hardTimer.unref();

  await client.connect(transport);

  // Abort the in-flight request mid-call. The SDK client translates the abort
  // into notifications/cancelled to the server and rejects the callTool promise.
  const controller = new AbortController();
  let abortAt = 0;
  const cancelTimer = setTimeout(() => {
    abortAt = Date.now();
    controller.abort();
  }, CANCEL_AFTER_MS);
  cancelTimer.unref();

  // Supplying onprogress makes the SDK attach a progressToken to the request
  // _meta, exercising the server's progress path. Count notifications observed
  // before the cancel fires.
  let progressCount = 0;
  let resultDelivered = false;

  try {
    await client.callTool(
      { name: "add", arguments: { a: 100, b: 200 } },
      CallToolResultSchema,
      {
        signal: controller.signal,
        onprogress: () => {
          progressCount += 1;
        },
      },
    );
    // Reaching here means a tool result was delivered for the cancelled
    // request — a spec violation (the receiver must send no response).
    resultDelivered = true;
  } catch {
    // Expected: the request terminates via the abort, so callTool rejects.
    // We do not inspect the rejection shape — any rejection means the request
    // did not produce a delivered result, which is the spec-conformant outcome.
  }

  const settledAt = Date.now();
  clearTimeout(hardTimer);
  clearTimeout(cancelTimer);

  if (abortAt === 0) {
    fail("cancellation never fired (call completed before the 2500ms cancel)");
  }
  if (resultDelivered) {
    fail(
      "a tool result was delivered for the cancelled request — the spec forbids any response",
    );
  }
  const lowerBound = EXPECT_PROGRESS_AT_CANCEL - PROGRESS_TOLERANCE;
  const upperBound = EXPECT_PROGRESS_AT_CANCEL + PROGRESS_TOLERANCE;
  if (progressCount < lowerBound || progressCount > upperBound) {
    fail(
      `expected ~${EXPECT_PROGRESS_AT_CANCEL} (±${PROGRESS_TOLERANCE}) progress notifications before cancel, got ${progressCount}`,
    );
  }

  const elapsed = settledAt - abortAt;
  await client.close();
  process.stdout.write(
    `PASS: request terminated on cancel with no response (settled ${elapsed}ms after abort, ${progressCount} progress before cancel)\n`,
  );
  process.exit(0);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
