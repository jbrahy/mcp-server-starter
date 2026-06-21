// Authentication hook seam (HARD-06 / SEC-04).
//
// MUST-REPLACE before production. This is the single-file seam where credential
// validation for the /mcp data path belongs. The DEV-ONLY default WARNs on
// every request and then calls next() — it does NOT reject. A no-op-that-warns
// default is the deliberate choice over a crashing-by-default (breaks Inspector
// and local dev) or a silently-permissive default (the omission would be
// invisible). Operators who ship without replacing this seam see the warning in
// every request's logs; the omission is loud, not silent.
//
// The handler signature `(req, res, next) => void | Promise<void>` is the
// cross-language binding contract — every port maps its auth middleware against
// this exact shape. Do NOT change it.
//
// SECURITY (T-07-authmisuse): the per-request WARN ("DEV-ONLY auth hook in use
// — replace before production") is the #1 production-readiness gate. Downstream
// CI may grep for `auth_hook_dev_only_in_use` and refuse to ship while it fires.
// Mounted on the HTTP transport ONLY, gating /mcp — stdio is unaffected.
//
// No console.* anywhere (enforced by ESLint).

import { type RequestHandler } from "express";
import { type Logger } from "../logger.js";

/**
 * Build the DEV-ONLY auth-hook middleware. WARNs once per request
 * ("auth_hook_dev_only_in_use") then calls next(). Replace the body with real
 * credential validation before production.
 */
export function authHook(logger: Logger): RequestHandler {
  return (_req, _res, next) => {
    logger.warn(
      {
        component: "http_auth",
        data: {
          notice: "DEV-ONLY auth hook in use — replace before production",
        },
      },
      "auth_hook_dev_only_in_use",
    );
    next();
  };
}
