// HTTP Origin allowlist middleware (TS-04 / XPORT-03 / SEC-03).
//
// Deny-by-default DNS-rebinding defense for the Streamable HTTP transport.
// A malicious web page on another origin can issue authenticated requests to a
// locally-bound MCP server via the browser; DNS rebinding defeats same-origin
// assumptions. See GHSA-89vp-x53w-74fx
// (https://github.com/modelcontextprotocol/rust-sdk/security/advisories/GHSA-89vp-x53w-74fx).
//
// Verbatim semantics (shared/docs/01-transport.md §Origin validation):
//   - no Origin header        -> ALLOW  (non-browser clients: Inspector CLI, curl, native MCP)
//   - Origin in allowlist     -> ALLOW
//   - Origin not in allowlist  -> 403 Forbidden + WARN { msg: "origin_rejected", data: { origin, path } }
//   - empty allowlist          -> deny ALL browser clients (Origin present), still allow no-Origin
//
// The empty-allowlist posture is deny-by-default: operators MUST opt in to
// specific origins via MCP_ORIGIN_ALLOWLIST. The SDK transport's
// allowedOrigins / enableDnsRebindingProtection options are @deprecated and do
// NOT implement these exact semantics — this hand-written middleware is the
// spec-conformant path.

import { type RequestHandler } from "express";
import { type Config } from "../config.js";
import { type Logger } from "../logger.js";

/**
 * Build the Origin-allowlist middleware. Runs before the /mcp route so no
 * disallowed cross-origin request reaches the SDK transport.
 */
export function originAllowlistMiddleware(
  cfg: Config,
  logger: Logger,
): RequestHandler {
  const allowlist = cfg.MCP_ORIGIN_ALLOWLIST;
  return (req, res, next) => {
    const origin = req.headers["origin"];
    // No Origin header -> non-browser client; always allowed.
    if (origin === undefined) {
      next();
      return;
    }
    if (allowlist.includes(origin)) {
      next();
      return;
    }
    logger.warn(
      { component: "security_origin", data: { origin, path: req.path } },
      "origin_rejected",
    );
    res.status(403).json({ error: "forbidden_origin" });
  };
}
