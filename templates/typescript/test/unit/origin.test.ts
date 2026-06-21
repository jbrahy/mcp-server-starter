// Unit coverage for originAllowlistMiddleware (TS-04 / XPORT-03 / SEC-03 /
// threat T-08-06 Spoofing). Drives the middleware with fake req/res/next — no
// HTTP server, no transport.
//
// Verbatim semantics (src/security/origin.ts / 01-transport.md §Origin
// validation):
//   no Origin header      -> ALLOW (next called, no 403)
//   Origin in allowlist    -> ALLOW
//   Origin NOT in allowlist -> 403, next NOT called
//   empty allowlist + Origin present -> 403 (deny-by-default)

import { describe, expect, it, vi } from "vitest";
import { type Config } from "../../src/config.js";
import { type Logger } from "../../src/logger.js";
import { originAllowlistMiddleware } from "../../src/security/origin.js";

function fakeLogger(): Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

// Minimal Express req/res/next doubles covering exactly what the middleware
// touches: req.headers.origin, req.path, res.status().json(), next().
function harness(allowlist: string[], origin?: string) {
  const cfg = { MCP_ORIGIN_ALLOWLIST: allowlist } as unknown as Config;
  const mw = originAllowlistMiddleware(cfg, fakeLogger());
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const req = { headers: origin === undefined ? {} : { origin }, path: "/mcp" };
  const res = { status, json };
  const next = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mw(req as any, res as any, next as any);
  return { status, json, next };
}

describe("originAllowlistMiddleware (T-08-06)", () => {
  it("allows a request with no Origin header (non-browser client)", () => {
    const { status, next } = harness(["https://ok.test"], undefined);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("allows an Origin that is in the allowlist", () => {
    const { status, next } = harness(["https://ok.test"], "https://ok.test");
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects an Origin not in the allowlist with 403 and does not call next", () => {
    const { status, next } = harness(["https://ok.test"], "https://evil.test");
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects any Origin under an empty allowlist (deny-by-default)", () => {
    const { status, next } = harness([], "https://anything.test");
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
