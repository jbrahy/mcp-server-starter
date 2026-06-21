// Protocol smoke (HTTP) — TEST-02 / T-08-10.
//
// An SDK Client drives the BUILT `node dist/index.js --transport=http` binary
// through the same full MCP surface as the stdio smoke, over
// StreamableHTTPClientTransport, then locks the Origin deny-by-default contract:
// an out-of-allowlist Origin POST to /mcp is rejected 403 (the hand-written
// originAllowlistMiddleware path, NOT the deprecated SDK allowedOrigins option).
//
// Expected surface shapes are INLINED as constants (not read from the repo-root
// shared/example-surface.yaml) so the template stands alone for Phase-9
// packaging — byte-conformance is gated separately by
// scripts/check-surface-conformance.ts.
//
// Port handling: the shipped config rejects MCP_HTTP_PORT=0 (Zod .min(1)) and
// the http_listening log echoes the CONFIGURED port, so an OS-ephemeral bind is
// not observable from the binary. To avoid a fixed-port collision with the
// parallel shutdown smoke (08-04), the test reserves a free port in-process
// (bind :0, read the OS-assigned port, release it) and passes that as the
// child's fixed MCP_HTTP_PORT — collision-free without touching src.

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

// --- Inlined expected surface (mirrors shared/example-surface.yaml shapes) ---
const TOOL_NAME = "add";
const TOOL_DESCRIPTION =
  "Adds two numbers. Intentionally slow (5s loop) to demonstrate MCP progress notifications and cancellation.";
const ADD_SUM_TEXT = "5"; // add{a:2,b:3}
const RESOURCE_URI = "example://greeting";
const RESOURCE_TEXT = "Hello from MCP";
const PROMPT_NAME = "greet";
const PROMPT_RENDERED = "Hello, World!"; // greet{name:"World"}

const HOST = "127.0.0.1";

// Reserve a free TCP port: bind an ephemeral listener, read the OS-assigned
// port, then release it. The window between release and the child's bind is the
// standard reserve-then-bind race, acceptable for a loopback test and far less
// collision-prone than a hardcoded port shared with the parallel http smoke.
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
  child?.kill("SIGTERM");
  child = undefined;
});

describe("protocol smoke: http (TEST-02)", () => {
  it("drives the full surface over HTTP against the built binary", async () => {
    const port = await reserveFreePort();
    const origin = `http://${HOST}:${String(port)}`;
    child = spawnServer(
      ["--transport=http"],
      buildChildEnv({
        transport: "http",
        host: HOST,
        port: String(port),
        extra: { MCP_ORIGIN_ALLOWLIST: origin },
      }),
    );
    await waitForListening(child);

    client = await connectHttpClient(new URL(`${origin}/mcp`));

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
    const firstContent = parsed.content[0];
    expect(firstContent?.type).toBe("text");
    expect(
      firstContent?.type === "text" ? firstContent.text : undefined,
    ).toBe(ADD_SUM_TEXT);

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

  it("rejects an out-of-allowlist Origin with 403 (deny-by-default)", async () => {
    const port = await reserveFreePort();
    const allowedOrigin = `http://${HOST}:${String(port)}`;
    child = spawnServer(
      ["--transport=http"],
      buildChildEnv({
        transport: "http",
        host: HOST,
        port: String(port),
        extra: { MCP_ORIGIN_ALLOWLIST: allowedOrigin },
      }),
    );
    await waitForListening(child);

    // Raw POST with an Origin NOT in the allowlist -> 403 from the middleware
    // BEFORE the SDK transport. Deny-by-default DNS-rebinding defense.
    const res = await fetch(`${allowedOrigin}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        origin: "https://evil.test",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    expect(res.status).toBe(403);
  });
});
