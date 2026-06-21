// The `add` tool — the canonical example surface (SURF-01).
//
// Intentionally slow: a 5-step / 5s loop that demonstrates two MCP mechanics
// every language port in this suite must reproduce byte-for-byte:
//   1. progress notifications  — one `notifications/progress` per step when the
//      caller supplies a progressToken in the request `_meta`.
//   2. cancellation — on `notifications/cancelled` the handler stops work, frees
//      its timer + abort listener, logs the outcome, and returns. Per the MCP
//      2025-11-25 spec (basic/utilities/cancellation) the receiver SHOULD NOT
//      send any response for a cancelled request; the client observes
//      termination through its own in-flight call rejecting/aborting.
//
// SECURITY / THREAT NOTES (see shared threat register):
//   - Numeric input is Zod-finite-validated: NaN / Infinity / non-number are
//     rejected before the handler body runs (threat: NaN/Infinity DoS).
//   - On abort the handler stops the loop and tears down its timer + listener so
//     nothing leaks (threat: cancellation resource leak). It returns a value, but
//     `@modelcontextprotocol/sdk@1.29.0` drops any result that settles after the
//     abort signal fires — that is the SPEC-CONFORMANT outcome (no response on a
//     cancelled request), not a workaround. The returned envelope is never
//     observed by the client.
//   - Tool arguments (a, b) are never logged verbatim outside the injected
//     logger, whose value-shape redactor runs on every line.

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Logger } from "../logger.js";
import { type Config } from "../config.js";
import { incInFlight, decInFlight } from "../lifecycle/shutdown.js";

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
 * @param config validated config; MCP_CANCEL_GRACE_MS bounds how long the
 *               handler may take to observe the abort and unwind — NOT a
 *               deadline to deliver a response (a cancelled request gets none)
 */
export function registerAddTool(
  server: McpServer,
  logger: Logger,
  config: Config,
): void {
  // MCP_CANCEL_GRACE_MS is the unwind budget: how long the handler may take to
  // notice the abort and tear down cleanly. It is NOT a response deadline —
  // per the MCP spec a cancelled request receives no response. The loop returns
  // within one INTERVAL_MS tick of the abort and does no awaited work on the
  // cancel path, so it unwinds well inside this budget by construction.
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

    // Make this in-flight call visible to the graceful-shutdown drain (HARD-01):
    // increment on entry, decrement in a finally so SIGTERM mid-add WAITS for
    // the real result rather than close-aborting it (research §Pattern 1).
    incInFlight();
    try {
      logger.info(
        { component: "tools/add", data: { tool: "add", cancelGraceMs } },
        "tool_call_started",
      );

      for (let step = 1; step <= STEPS; step++) {
        // Emit progress at the START of each step so the emissions land at
        // t≈0,1000,2000,3000,4000 over the 5s run. This makes a cancel at
        // cancel_after_ms (2500) observe expect_progress_count_at_cancel (3)
        // notifications, matching shared/example-surface.yaml byte-for-byte.
        if (progressToken !== undefined) {
          await sendNotification({
            method: "notifications/progress",
            params: { progressToken, progress: step, total: STEPS },
          });
        }

        const aborted = await sleepOrAbort(INTERVAL_MS, signal);
        if (aborted) {
          // Cancelled: sleepOrAbort already cleared the timer and removed the
          // abort listener, so nothing leaks. Stop the loop, log the outcome,
          // and return. The MCP spec says a cancelled request gets NO response,
          // and the SDK enforces that by dropping any result that settles after
          // the abort — so this returned value is never delivered to the client
          // (by design). No sendNotification (a no-op post-abort) and no throw.
          logger.info(
            {
              component: "tools/add",
              data: { tool: "add", outcome: "cancelled" },
            },
            "tool_call_completed",
          );
          return {
            isError: true,
            content: [{ type: "text", text: "cancelled" }],
          };
        }
      }

      logger.info(
        { component: "tools/add", data: { tool: "add", outcome: "ok" } },
        "tool_call_completed",
      );
      // String(a + b) exactly — no toFixed, no locale formatting (Pitfall 4).
      return {
        isError: false,
        content: [{ type: "text", text: String(a + b) }],
      };
    } finally {
      // Decrement on EVERY exit path (normal, cancelled, throw) so the drain
      // counter never leaks an in-flight slot and shutdown cannot deadlock.
      decInFlight();
    }
  });
}
