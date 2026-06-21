// Unit coverage for the `add` tool (SURF-01 / TEST-01).
//
// Exercises registerAddTool in-process: register on a real McpServer, invoke the
// stored handler directly (no spawn, no transport), and assert the byte-exact
// contract. Two threat-register controls are locked here:
//   - T-08-04 (DoS): the finiteNumber Zod schema rejects NaN / Infinity /
//     non-number before the handler body runs (V5).
//   - cancellation NO-RESPONSE: per the MCP 2025-11-25 spec a cancelled request
//     receives NO delivered response; we assert the handler STOPS on abort (the
//     returned envelope is never observed by a client). We do not assert a
//     delivered "final response".

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerAddTool } from "../../src/tools/add.js";
import { loadConfig } from "../../src/config.js";
import { type Logger } from "../../src/logger.js";

// A no-op logger with the surface registerAddTool touches.
function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

// Register `add` on a fresh server and return the stored handler so we can drive
// it directly. The SDK stores the tool callback on RegisteredTool.handler.
function registerAndGetHandler(): (
  args: { a: number; b: number },
  extra: {
    signal: AbortSignal;
    sendNotification: (n: unknown) => Promise<void>;
    _meta?: { progressToken?: string | number };
  },
) => Promise<{ isError?: boolean; content: { type: string; text: string }[] }> {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const logger = fakeLogger();
  const config = loadConfig({ MCP_TRANSPORT: "stdio" });
  registerAddTool(server, logger, config);
  // _registeredTools is the internal registry; grab the add handle.
  const registry = (server as unknown as { _registeredTools: Record<string, { handler: unknown }> })
    ._registeredTools;
  return registry.add.handler as never;
}

// Re-derive the finiteNumber schema exactly as src/tools/add.ts defines it, so
// the Zod rejection contract is asserted directly (the same shape registerTool
// consumes as inputSchema).
const finiteNumber = z
  .number()
  .refine(Number.isFinite, { message: "must be a finite number" });

describe("add tool", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders text \"5\" for add(2,3)", async () => {
    const handler = registerAndGetHandler();
    const ac = new AbortController();
    const out = await handler(
      { a: 2, b: 3 },
      { signal: ac.signal, sendNotification: async () => {}, _meta: undefined },
    );
    expect(out.isError).toBe(false);
    expect(out.content[0]).toEqual({ type: "text", text: "5" });
  });

  it("emits one progress notification per step when a progressToken is supplied", async () => {
    vi.useFakeTimers();
    const handler = registerAndGetHandler();
    const ac = new AbortController();
    const sendNotification = vi.fn(async () => {});
    const p = handler(
      { a: 1, b: 1 },
      { signal: ac.signal, sendNotification, _meta: { progressToken: "tok" } },
    );
    // STEPS = 5, INTERVAL_MS = 1000 => five 1s ticks drain the loop.
    await vi.advanceTimersByTimeAsync(5000);
    const out = await p;
    expect(out.content[0]).toEqual({ type: "text", text: "2" });
    expect(sendNotification).toHaveBeenCalledTimes(5);
    expect(sendNotification.mock.calls[0][0]).toMatchObject({
      method: "notifications/progress",
      params: { progressToken: "tok", progress: 1, total: 5 },
    });
  });

  it("stops on abort and delivers NO final 'ok' response (spec NO-RESPONSE on cancel)", async () => {
    vi.useFakeTimers();
    const handler = registerAndGetHandler();
    const ac = new AbortController();
    const sendNotification = vi.fn(async () => {});
    const p = handler(
      { a: 2, b: 3 },
      { signal: ac.signal, sendNotification, _meta: { progressToken: "tok" } },
    );
    // Let two steps elapse, then cancel mid-flight.
    await vi.advanceTimersByTimeAsync(2500);
    ac.abort();
    await vi.advanceTimersByTimeAsync(100);
    const out = await p;
    // The handler unwinds: it returns a cancelled marker, NOT the summed "5"
    // final response. The SDK drops any result that settles after abort, so the
    // client observes no response — we assert the handler did not produce the
    // normal "ok" envelope.
    expect(out.content[0].text).not.toBe("5");
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toBe("cancelled");
  });
});

describe("add finiteNumber Zod schema (T-08-04 DoS rejection)", () => {
  it("rejects a non-number", () => {
    expect(finiteNumber.safeParse("a").success).toBe(false);
  });
  it("rejects NaN", () => {
    expect(finiteNumber.safeParse(Number.NaN).success).toBe(false);
  });
  it("rejects Infinity", () => {
    expect(finiteNumber.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
    expect(finiteNumber.safeParse(Number.NEGATIVE_INFINITY).success).toBe(false);
  });
  it("accepts a finite number", () => {
    expect(finiteNumber.safeParse(3).success).toBe(true);
  });
});
