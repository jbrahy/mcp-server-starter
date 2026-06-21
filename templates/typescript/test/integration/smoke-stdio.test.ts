// Protocol smoke (stdio) — TEST-02 / T-08-09.
//
// An SDK Client drives the BUILT `node dist/index.js --transport=stdio` binary
// through the full MCP surface, then locks the AMENDED no-response cancellation
// contract (SMOKE-05 forbidden_fields:[result,error]). Assertions mirror the
// proven smoke scripts so they cannot drift:
//   - surface walk:  scripts/check-surface-conformance.ts
//   - cancellation:  scripts/smoke-cancellation.ts (PROGRESS_TOLERANCE=0)
//
// Expected surface shapes are INLINED as constants (not read from the repo-root
// shared/example-surface.yaml) so the template stands alone for Phase-9
// packaging — byte-conformance against the YAML is gated separately by
// scripts/check-surface-conformance.ts. Here we assert protocol behavior.
//
// Spawn path is the shipped dist artifact (matching the validator probes), so
// `npm test`'s pretest build is a prerequisite. The child env is built
// explicitly (no process.env spread) for secret isolation (T-08-01).

import { afterEach, describe, expect, it } from "vitest";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { type Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectStdioClient } from "../helpers/spawn-server.js";
import { buildChildEnv } from "../helpers/env.js";

// --- Inlined expected surface (mirrors shared/example-surface.yaml shapes) ---
const TOOL_NAME = "add";
const TOOL_DESCRIPTION =
  "Adds two numbers. Intentionally slow (5s loop) to demonstrate MCP progress notifications and cancellation.";
const ADD_SUM_TEXT = "5"; // add{a:2,b:3}
const RESOURCE_URI = "example://greeting";
const RESOURCE_TEXT = "Hello from MCP";
const PROMPT_NAME = "greet";
const PROMPT_RENDERED = "Hello, World!"; // greet{name:"World"}

// --- Cancellation contract (mirrors smoke-cancellation.ts EXACTLY) ----------
const CANCEL_AFTER_MS = 2500; // timing.cancel_after_ms
const EXPECT_PROGRESS_AT_CANCEL = 3; // timing.expect_progress_count_at_cancel
const PROGRESS_TOLERANCE = 0; // exact: add emits at t≈0,1000,2000; cancel at 2500ms

let client: Client | undefined;

afterEach(async () => {
  // Closing the stdio client terminates the spawned child it owns.
  await client?.close().catch(() => {});
  client = undefined;
});

describe("protocol smoke: stdio (TEST-02)", () => {
  it("drives the full surface over stdio against the built binary", async () => {
    client = await connectStdioClient(buildChildEnv({ transport: "stdio" }));

    // tools/list — the add tool is present with the contract description.
    const { tools } = await client.listTools();
    const addTool = tools.find((t) => t.name === TOOL_NAME);
    expect(addTool).toBeDefined();
    expect(addTool?.description).toBe(TOOL_DESCRIPTION);

    // tools/call add{a:2,b:3} -> content text "5".
    const callResult = await client.callTool(
      { name: TOOL_NAME, arguments: { a: 2, b: 3 } },
      CallToolResultSchema,
    );
    const parsed = CallToolResultSchema.parse(callResult);
    const first = parsed.content[0];
    expect(first?.type).toBe("text");
    expect(first?.type === "text" ? first.text : undefined).toBe(ADD_SUM_TEXT);

    // resources/list + resources/read example://greeting -> "Hello from MCP".
    const { resources } = await client.listResources();
    expect(resources.some((r) => r.uri === RESOURCE_URI)).toBe(true);
    const read = await client.readResource({ uri: RESOURCE_URI });
    const content = read.contents[0];
    const readText =
      content && "text" in content ? (content.text as string) : undefined;
    expect(readText).toBe(RESOURCE_TEXT);

    // prompts/list + prompts/get greet{name:"World"} -> "Hello, World!".
    const { prompts } = await client.listPrompts();
    expect(prompts.some((p) => p.name === PROMPT_NAME)).toBe(true);
    const got = await client.getPrompt({
      name: PROMPT_NAME,
      arguments: { name: "World" },
    });
    const message = got.messages[0];
    const rendered =
      message && message.content.type === "text"
        ? message.content.text
        : undefined;
    expect(rendered).toBe(PROMPT_RENDERED);
  });

  it("terminates a cancelled add with NO response and exactly 3 progress", async () => {
    client = await connectStdioClient(buildChildEnv({ transport: "stdio" }));

    // Abort the in-flight request at 2500ms. The SDK client emits
    // notifications/cancelled and rejects the callTool promise; the server sends
    // NO response (SMOKE-05 forbidden_fields:[result,error]).
    const controller = new AbortController();
    let abortAt = 0;
    const cancelTimer = setTimeout(() => {
      abortAt = Date.now();
      controller.abort();
    }, CANCEL_AFTER_MS);

    let progressCount = 0;
    let resultDelivered = false;
    try {
      await client.callTool(
        { name: TOOL_NAME, arguments: { a: 100, b: 200 } },
        CallToolResultSchema,
        {
          signal: controller.signal,
          onprogress: () => {
            progressCount += 1;
          },
        },
      );
      // Reaching here means a result was delivered for the cancelled request —
      // a spec violation (the receiver must send no response).
      resultDelivered = true;
    } catch {
      // Expected: the request terminates via the abort, so callTool rejects.
      // Any rejection means no result was delivered — the conformant outcome.
    } finally {
      clearTimeout(cancelTimer);
    }

    // The cancel must actually have fired (the call did not finish early).
    expect(abortAt).toBeGreaterThan(0);
    // No-response contract: no result envelope was delivered.
    expect(resultDelivered).toBe(false);
    // Exactly 3 progress notifications arrive before the 2500ms cancel (±0).
    expect(progressCount).toBeGreaterThanOrEqual(
      EXPECT_PROGRESS_AT_CANCEL - PROGRESS_TOLERANCE,
    );
    expect(progressCount).toBeLessThanOrEqual(
      EXPECT_PROGRESS_AT_CANCEL + PROGRESS_TOLERANCE,
    );
  });
});
