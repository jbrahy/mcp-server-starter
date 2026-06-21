// OAuth Protected Resource Metadata stub (HARD-05 / XPORT-05 / SEC-15).
//
// GET /.well-known/oauth-protected-resource serves an RFC 9728 Protected
// Resource Metadata document. This is a DEV-ONLY STUB: the values are
// placeholders, the body is flagged `_DEV_STUB: true` with a `_DEV_WARNING`,
// and every hit emits a WARN log line.
//
// MUST-REPLACE before production. Replace `resource` and `authorization_servers`
// with the real protected-resource URL and authorization server(s), and remove
// the `_DEV_STUB`/`_DEV_WARNING` markers. See
// shared/docs/02-security-baseline.md#oauth-protected-resource-metadata-stub.
//
// SECURITY (T-07-prmleak): the explicit `_DEV_STUB`/`_DEV_WARNING` markers plus
// the per-hit WARN exist so a stub is never silently mistaken for real auth
// metadata.
//
// RFC 9728: `resource` is the only REQUIRED member; `authorization_servers` and
// `scopes_supported` are OPTIONAL.
//
// No console.* anywhere (enforced by ESLint).

import { type RequestHandler } from "express";
import { type Logger } from "../logger.js";

/**
 * Build the GET /.well-known/oauth-protected-resource handler. WARNs once per
 * hit ("oauth_prm_dev_stub_in_use") then serves the RFC 9728 stub document.
 */
export function prmRoute(logger: Logger): RequestHandler {
  return (_req, res) => {
    logger.warn(
      { component: "http_oauth_prm" },
      "oauth_prm_dev_stub_in_use",
    );
    res.status(200).json({
      resource: "<TBD-replace-in-prod>", // RFC 9728 REQUIRED
      authorization_servers: ["<TBD-replace-in-prod>"], // RFC 9728 OPTIONAL
      scopes_supported: ["mcp:read", "mcp:write"], // RFC 9728 OPTIONAL
      _DEV_STUB: true,
      _DEV_WARNING:
        "Replace before production. See shared/docs/02-security-baseline.md#oauth-protected-resource-metadata-stub.",
    });
  };
}
