// Liveness probe route (HARD-02 / XPORT-04).
//
// GET /health returns a minimal, fixed-shape 200 body for liveness probes
// (and the Phase-9 Dockerfile HEALTHCHECK). The body carries EXACTLY three
// keys and nothing else:
//   - status            always "ok" (the route only answers when the process is up)
//   - uptime_seconds    Math.floor(process.uptime()) — an integer second count;
//                       Math.floor satisfies both the matrix `<integer>` (XPORT-04)
//                       and the doc `<number>` forms.
//   - protocol_version  the MCP protocol version this build speaks ("2025-11-25",
//                       = the SDK LATEST_PROTOCOL_VERSION).
//
// SECURITY (T-07-healthleak): this response MUST NOT leak dependency versions,
// environment values, or hostnames — a liveness probe is an unauthenticated,
// pre-auth surface (mounted before the auth hook). Keep the shape minimal.
//
// No console.* anywhere (enforced by ESLint).

import { type RequestHandler } from "express";

// = SDK LATEST_PROTOCOL_VERSION (types.js). The literal is intentional: /health
// reports the version this build speaks, independent of any per-connection
// negotiation.
const PROTOCOL_VERSION = "2025-11-25";

/**
 * GET /health handler. 200 + the exact 3-key liveness body.
 */
export const healthRoute: RequestHandler = (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime_seconds: Math.floor(process.uptime()),
    protocol_version: PROTOCOL_VERSION,
  });
};
