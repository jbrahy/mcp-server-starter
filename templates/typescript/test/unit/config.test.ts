// Unit coverage for loadConfig / STRICT_ENV (TS-05 / TEST-01).
//
// loadConfig fails fast by calling process.exit(1) on any invalid env. To test
// that path in-process WITHOUT adding a return-instead-of-exit seam to
// config.ts (surgical rule / 08-RESEARCH §Pitfall 3), we spy on process.exit and
// make it throw so the call site unwinds observably. process.stderr.write is
// silenced so the structured fatal line does not pollute test output.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Throw instead of exiting so the fail-fast path is observable in-process.
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error("exit:" + String(code));
      }) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a valid env into a Config with defaulted keys", () => {
    const cfg = loadConfig({ MCP_TRANSPORT: "stdio" });
    expect(cfg.MCP_TRANSPORT).toBe("stdio");
    expect(cfg.MCP_HTTP_HOST).toBe("127.0.0.1");
    expect(cfg.MCP_HTTP_PORT).toBe(3000);
    expect(cfg.MCP_LOG_LEVEL).toBe("info");
    // ORIGIN_ALLOWLIST defaults to an empty parsed array.
    expect(cfg.MCP_ORIGIN_ALLOWLIST).toEqual([]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("exits(1) on an out-of-range MCP_HTTP_PORT", () => {
    expect(() => loadConfig({ MCP_TRANSPORT: "stdio", MCP_HTTP_PORT: "-1" })).toThrow(
      "exit:1",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits(1) on a non-numeric MCP_HTTP_PORT", () => {
    expect(() => loadConfig({ MCP_HTTP_PORT: "abc" })).toThrow("exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits(1) on an invalid MCP_LOG_LEVEL", () => {
    expect(() => loadConfig({ MCP_LOG_LEVEL: "bogus" })).toThrow("exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits(1) under STRICT_ENV=1 on an unknown MCP_* key", () => {
    expect(() => loadConfig({ STRICT_ENV: "1", MCP_TYPO: "x" })).toThrow("exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("ignores an unknown MCP_* key when STRICT_ENV is unset (default no-op)", () => {
    const cfg = loadConfig({ MCP_TRANSPORT: "stdio", MCP_TYPO: "x" });
    expect(cfg.MCP_TRANSPORT).toBe("stdio");
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
