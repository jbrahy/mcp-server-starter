// Graceful shutdown — DRAIN, then close (HARD-01 / SC#1).
//
// THE LOAD-BEARING DECISION (research §Pattern 1 + Pitfall 1): the SDK's
// `transport.close()` / `server.close()` synchronously ABORTS every in-flight
// request handler (Protocol._onclose, protocol.js:258-262), and under the
// Phase-6 cancellation contract an aborted handler's result is DROPPED — the
// client gets NO response. So closing-to-shutdown CANCELS in-flight work.
//
// To deliver SC#1's "final response" (the in-flight add's real "5"), shutdown
// must NOT close until in-flight work has finished on its own:
//   1. log shutdown_initiated, set shuttingDown (idempotent re-entry guard)
//   2. stopAcceptingNew()  — HTTP: httpServer.close() stops NEW conns, keeps
//                            active; stdio: pause stdin (no new inbound parse)
//   3. DRAIN: await Promise.race([whenIdle(), timeout(graceMs)]) — whenIdle
//      resolves when the in-flight counter reaches 0; graceMs defaults to 30000
//      (MCP_SHUTDOWN_GRACE_MS), which exceeds add's 5s run
//   4. await server.close()  — safe now: aborting nothing, or only the
//      grace-expired stragglers (forced termination, acceptable)
//   5. process.exit(0)
//
// Never process.exit synchronously inside the signal handler — run the async
// drain, then exit. PID-1 signal delivery (exec-form ENTRYPOINT, SEC-16) is a
// Phase-9 Dockerfile concern; without it this shutdown is dead in a container.

// ── In-flight counter ──────────────────────────────────────────────────────
// The SDK exposes no public in-flight counter, and stateless HTTP connects a
// fresh transport per POST, so the per-transport abort map is not a usable
// cross-request view (research §Pattern 1). Track it ourselves: tool handlers
// inc/dec around execution, and HTTP middleware inc/dec around the request
// lifecycle (belt-and-suspenders). whenIdle() resolves the moment the counter
// reaches 0.

let inFlight = 0;
const idleWaiters: Array<() => void> = [];

/** Increment the in-flight request counter. Pair with decInFlight in a finally. */
export function incInFlight(): void {
  inFlight += 1;
}

/**
 * Decrement the in-flight request counter. When it reaches 0, resolve every
 * pending whenIdle() promise. Clamped at 0 so a stray double-decrement cannot
 * drive the count negative and wedge the drain.
 */
export function decInFlight(): void {
  if (inFlight > 0) inFlight -= 1;
  if (inFlight === 0) {
    const waiters = idleWaiters.splice(0, idleWaiters.length);
    for (const resolve of waiters) resolve();
  }
}

/** Current in-flight count (for diagnostics / drain logging). */
export function inFlightCount(): number {
  return inFlight;
}

/**
 * Resolve when the in-flight counter is (or next becomes) 0. If nothing is in
 * flight, resolves immediately; otherwise resolves on the decrement that brings
 * the counter to 0.
 */
export function whenIdle(): Promise<void> {
  if (inFlight === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    idleWaiters.push(resolve);
  });
}

/**
 * Wrap a tool/handler function so the in-flight counter is incremented on entry
 * and decremented in a finally (even on throw). Used to make the `add` handler
 * visible to the drain.
 */
export function trackInFlight<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    incInFlight();
    try {
      return await fn(...args);
    } finally {
      decInFlight();
    }
  };
}

// ── Shutdown registration ──────────────────────────────────────────────────

/** Minimal logger surface used by the shutdown handler (matches pino's). */
interface ShutdownLogger {
  info(obj: object, msg: string): void;
}

/** Minimal closable-server surface (McpServer.close()). */
interface ClosableServer {
  close(): Promise<void>;
}

export interface RegisterShutdownOptions {
  /** The MCP server to close AFTER the drain completes. */
  server: ClosableServer;
  /** Structured logger (lifecycle lines route through its redactor). */
  logger: ShutdownLogger;
  /** Drain budget in ms (config.MCP_SHUTDOWN_GRACE_MS, default 30000). */
  graceMs: number;
  /**
   * Stop accepting NEW work. HTTP: close the listening socket (keeps active
   * conns alive to drain). stdio: pause stdin so no new inbound message is
   * parsed. Invoked LAZILY at signal time, so a late-bound httpServer reference
   * (captured after app.listen resolves) is fine. Idempotent by contract.
   */
  stopAcceptingNew: () => void;
}

/**
 * Install idempotent SIGINT/SIGTERM handlers that DRAIN in-flight work before
 * closing transports and exiting 0. Call this FIRST in main() (before any
 * transport connects) so the handlers are in place before a request can arrive.
 *
 * A second signal during drain is ignored (the shuttingDown guard) so an
 * impatient orchestrator double-tap cannot short-circuit the drain.
 */
export function registerShutdown(options: RegisterShutdownOptions): void {
  const { server, logger, graceMs, stopAcceptingNew } = options;
  let shuttingDown = false;

  const handle = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return; // idempotent: ignore a second signal mid-drain
    shuttingDown = true;

    // Run the async drain detached from the synchronous signal callback — never
    // process.exit synchronously inside the handler.
    void (async () => {
      logger.info({ component: "lifecycle", data: { signal } }, "shutdown_initiated");

      // 1. Stop accepting new work (lazy: resolves the late-bound httpServer /
      //    stdin reference at signal time).
      stopAcceptingNew();

      // 2. Drain in-flight to zero, bounded by graceMs.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), graceMs);
      });
      const outcome = await Promise.race([
        whenIdle().then(() => "drained" as const),
        timeout,
      ]);
      if (timer) clearTimeout(timer);

      if (outcome === "drained") {
        logger.info({ component: "lifecycle", data: { drained: true } }, "shutdown_drained");
      } else {
        // Grace expired: the stragglers below get aborted by close() and
        // receive nothing — correct for a forced termination.
        logger.info(
          { component: "lifecycle", data: { remaining: inFlightCount() } },
          "shutdown_grace_expired",
        );
      }

      // 3. Close transports — safe now (aborting nothing, or only stragglers).
      await server.close();
      logger.info({ component: "lifecycle" }, "shutdown_complete");

      // 4. Exit clean.
      process.exit(0);
    })();
  };

  process.on("SIGINT", handle);
  process.on("SIGTERM", handle);
}
