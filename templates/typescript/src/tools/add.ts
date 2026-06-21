// The `add` tool — the canonical example surface (SURF-01).
//
// Intentionally slow: a 5-step / 5s loop that demonstrates two MCP mechanics
// every language port in this suite must reproduce byte-for-byte:
//   1. progress notifications  — one `notifications/progress` per step when the
//      caller supplies a progressToken in the request `_meta`.
//   2. cancellation WITH A FINAL RESPONSE — on `notifications/cancelled` the
//      handler returns the locked tool-error envelope rather than throwing.
//
// SECURITY / THREAT NOTES (see shared threat register):
//   - Numeric input is Zod-finite-validated: NaN / Infinity / non-number are
//     rejected before the handler body runs (threat: NaN/Infinity DoS).
//   - The abort path returns a final {isError:true} envelope rather than
//     throwing (threat: cancellation-drops-response). The SDK silently drops a
//     handler result that settles AFTER it observes the abort, so the cancel
//     envelope is returned the instant abort is detected — no awaited work and
//     no throw follow that detection.
//   - Tool arguments (a, b) are never logged verbatim outside the injected
//     logger, whose value-shape redactor runs on every line.

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Logger } from "../logger.js";
import { type Config } from "../config.js";

// Timing sourced from shared/example-surface.yaml (timing block):
//   total_ms 5000 / progress_interval_ms 1000 / progress_steps 5.
const STEPS = 5;
const INTERVAL_MS = 1000;

// A finite IEEE-754 double. The raw shape (NOT a wrapped z.object) is what
// registerTool consumes as inputSchema; each addend carries its verbatim
// description and rejects non-finite values before the handler runs.
const finiteNumber = (description: string) =>
  z
    .number({ description })
    .refine(Number.isFinite, { message: "must be a finite number" });

/**
 * Resolve after `ms`, or earlier if `signal` aborts. Resolves to `true` when
 * the wait ended because of abort, `false` on the normal timer path. Cleans up
 * both the timer and the abort listener on every exit so nothing leaks.
 */
function sleepOrAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(true);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Register the `add` tool on the given server.
 *
 * @param server the McpServer to register on
 * @param logger structured logger (lifecycle lines route through its redactor)
 * @param config validated config; MCP_CANCEL_GRACE_MS bounds the watchdog
 *               budget for delivering the cancel envelope to the client
 */
export function registerAddTool(
  server: McpServer,
  logger: Logger,
  config: Config,
): void {
  // MCP_CANCEL_GRACE_MS is the budget within which the final cancel response
  // must reach the client. The loop returns within one INTERVAL_MS tick of the
  // abort and does no awaited work on the cancel path, so it stays well inside
  // this watchdog deadline by construction.
  const cancelGraceMs = config.MCP_CANCEL_GRACE_MS;

  server.registerTool("add", {
    description:
      "Adds two numbers. Intentionally slow (5s loop) to demonstrate MCP progress notifications and cancellation.",
    inputSchema: {
      a: finiteNumber("First addend (IEEE-754 double, unbounded)."),
      b: finiteNumber("Second addend (IEEE-754 double, unbounded)."),
    },
  }, async ({ a, b }, extra) => {
    const { signal, sendNotification, _meta } = extra;
    const progressToken = _meta?.progressToken;

    logger.info(
      { component: "tools/add", data: { tool: "add", cancelGraceMs } },
      "tool_call_started",
    );

    for (let step = 1; step <= STEPS; step++) {
      const aborted = await sleepOrAbort(INTERVAL_MS, signal);
      if (aborted) {
        // Load-bearing: return the locked cancel envelope NOW, while the SDK
        // still considers the request live. No sendNotification (no-op after
        // abort), no throw, no further await — any of those would let the SDK
        // observe the abort first and drop this response.
        logger.info(
          { component: "tools/add", data: { tool: "add", outcome: "cancelled" } },
          "tool_call_completed",
        );
        return { isError: true, content: [{ type: "text", text: "cancelled" }] };
      }

      if (progressToken !== undefined) {
        await sendNotification({
          method: "notifications/progress",
          params: { progressToken, progress: step, total: STEPS },
        });
      }
    }

    logger.info(
      { component: "tools/add", data: { tool: "add", outcome: "ok" } },
      "tool_call_completed",
    );
    // String(a + b) exactly — no toFixed, no locale formatting (Pitfall 4).
    return { isError: false, content: [{ type: "text", text: String(a + b) }] };
  });
}
