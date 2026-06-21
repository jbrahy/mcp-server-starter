// Cancellation smoke driver — proves the cancellation-with-final-response
// contract (PROG-02 / Pitfall 1.4) empirically against a real stdio server.
//
// The SDK silently DROPS a tool result that settles after it observes the
// abort. The `add` handler defeats that by returning the locked envelope
// {isError:true, content:[{type:"text",text:"cancelled"}]} the instant abort is
// detected. This script spawns the template over stdio, calls `add` with a
// progressToken, sends notifications/cancelled at 2500ms, and asserts the FINAL
// envelope actually arrives (never an empty/dropped response, never a JSON-RPC
// error) within the grace window.
//
// IMPORTANT: we do NOT pass an AbortSignal into callTool. The client's own
// signal path deletes its response handler and rejects on abort, which would
// hide the server's final response. Instead we send the raw cancelled
// notification for the in-flight request id (sniffed off the outbound stream)
// and keep the callTool promise alive to observe what the server delivers.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

const CANCEL_AFTER_MS = 2500; // shared/example-surface.yaml timing.cancel_after_ms
const GRACE_MS = Number(process.env.MCP_CANCEL_GRACE_MS ?? "1000");
const HARD_TIMEOUT_MS = 15_000; // guard against the SDK-drops-response hang

function fail(message: string): never {
  process.stdout.write(`FAIL: ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Sniff the outbound tools/call request id so we can target it with a raw
  // notifications/cancelled. Wrapping send() is robust — it reads the actual
  // JSON-RPC id rather than guessing the client's private counter.
  let addRequestId: string | number | undefined;
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts", "--transport=stdio"],
    cwd: resolve(fileURLToPath(import.meta.url), "..", ".."),
    env: { ...process.env, MCP_CANCEL_GRACE_MS: String(GRACE_MS) } as Record<
      string,
      string
    >,
  });
  const originalSend = transport.send.bind(transport);
  transport.send = (message: JSONRPCMessage): Promise<void> => {
    if (
      "method" in message &&
      message.method === "tools/call" &&
      "id" in message
    ) {
      addRequestId = message.id;
    }
    return originalSend(message);
  };

  const client = new Client({ name: "smoke-cancellation", version: "0.0.0" });

  // Hard overall timeout: if the response is dropped (Pitfall 1) the callTool
  // promise never settles, so this is the explicit loud-failure guard.
  const hardTimer = setTimeout(() => {
    fail(
      `call did not settle within ${HARD_TIMEOUT_MS}ms — response was dropped (SDK abort-drop)`,
    );
  }, HARD_TIMEOUT_MS);
  hardTimer.unref();

  await client.connect(transport);

  // Fire the cancellation mid-call. Supplying onprogress makes the SDK attach a
  // progressToken to the request _meta, exercising the server's progress path.
  let abortAt = 0;
  const cancelTimer = setTimeout(() => {
    if (addRequestId === undefined) {
      fail("never observed the outbound tools/call request id");
    }
    abortAt = Date.now();
    void client.notification({
      method: "notifications/cancelled",
      params: { requestId: addRequestId, reason: "smoke-test cancel" },
    });
  }, CANCEL_AFTER_MS);
  cancelTimer.unref();

  let progressCount = 0;
  const result = await client.callTool(
    { name: "add", arguments: { a: 100, b: 200 } },
    undefined,
    {
      onprogress: () => {
        progressCount += 1;
      },
    },
  );
  const settledAt = Date.now();
  clearTimeout(hardTimer);
  clearTimeout(cancelTimer);

  // Assert the locked cancel envelope arrived (not a success, not dropped).
  const content = Array.isArray(result.content) ? result.content : [];
  const first = content[0] as { type?: string; text?: string } | undefined;
  if (result.isError !== true) {
    fail(`expected isError:true, got isError:${String(result.isError)}`);
  }
  if (first?.type !== "text" || first.text !== "cancelled") {
    fail(`expected content[0].text "cancelled", got ${JSON.stringify(first)}`);
  }
  if ("error" in result) {
    fail("result carried a forbidden JSON-RPC error field");
  }

  const elapsed = abortAt === 0 ? -1 : settledAt - abortAt;
  if (elapsed < 0) {
    fail("cancellation never fired");
  }
  if (elapsed > GRACE_MS) {
    fail(`cancel envelope arrived in ${elapsed}ms, exceeding grace ${GRACE_MS}ms`);
  }

  await client.close();
  process.stdout.write(
    `PASS: cancel envelope delivered in ${elapsed}ms (grace ${GRACE_MS}ms, ${progressCount} progress before cancel)\n`,
  );
  process.exit(0);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
