// Request correlation via AsyncLocalStorage (HARD-04 / LOG-05 / SC#4).
//
// One ULID `request_id` per request, propagated across async boundaries by a
// node:async_hooks AsyncLocalStorage store and auto-stamped onto every log line
// by the pino `mixin` in logger.ts (which reads `requestStore.getStore()`).
//
// Two IDs are tracked per request (shared/docs/03-observability.md §150-168):
//   - request_id          honors an inbound client `mcp-correlation-id` header
//                         VERBATIM when present, else a fresh ULID. Clients want
//                         their own IDs to survive into server logs.
//   - internal_request_id ALWAYS a fresh server-generated ULID, logged once at
//                         request start under `data.internal_request_id`, so log
//                         search stays reliable even if a client forges or
//                         collides on the inbound correlation id (T-07-corrforge).
//
// ULID — not crypto.randomUUID: the locked log schema (LOG-05) requires a
// 26-char Crockford-base32 id matching /[A-Z0-9]{26}/; UUIDv4 fails that contract.

import { AsyncLocalStorage } from "node:async_hooks";
import { type RequestHandler } from "express";
import { ulid } from "ulid";

/** The per-request correlation context carried through the async call tree. */
export interface RequestContext {
  request_id: string;
  internal_request_id: string;
}

/** Process-global ALS store. Empty (getStore() === undefined) outside a request. */
export const requestStore = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` inside a fresh correlation scope.
 *
 * @param inbound a client-supplied correlation id (honored verbatim) or
 *                undefined to mint a fresh ULID as the request_id.
 * @param fn      the request-scoped work; every log line it emits carries request_id.
 */
export function runWithCorrelation<T>(
  inbound: string | undefined,
  fn: () => T,
): T {
  const ctx: RequestContext = {
    request_id: inbound ?? ulid(),
    internal_request_id: ulid(),
  };
  return requestStore.run(ctx, fn);
}

/**
 * Express middleware that opens a correlation scope per HTTP request. Reads the
 * inbound `mcp-correlation-id` header (lowercased by Node; first element if it
 * arrives as an array) and seeds the store before passing control downstream.
 * Mount BEFORE origin/auth/routes so every downstream line is request-scoped.
 */
export function correlationMiddleware(): RequestHandler {
  return (req, _res, next) => {
    const raw = req.headers["mcp-correlation-id"];
    const inbound = Array.isArray(raw) ? raw[0] : raw;
    runWithCorrelation(inbound, () => next());
  };
}
