// Wave-0 resolution + env-isolation spike (Assumptions A1 / A2).
//
// This is the go/no-go gate before 08-02/03/04 write their suites. It proves two
// foundational assumptions about the harness:
//
//   A1: Vitest resolves a `.js` import specifier to its `.ts` source under the
//       template's NodeNext/ESM tsconfig with NO separate config. We import
//       loadConfig from "../../src/config.js" (the on-disk file is config.ts) and
//       exercise it — if resolution were broken this file would not even load.
//
//   A2: The child-env isolation control (buildChildEnv) does NOT leak the parent
//       process's environment. We plant a fake secret on process.env at runtime
//       and assert it is visible to the test process but ABSENT from the env a
//       spawned child would receive — proving the isolation seam actually bites.
//       (Vitest's test.env merges over process.env rather than scrubbing it, so
//       the real isolation boundary is the explicit child-env factory, not the
//       test process.)

import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { buildChildEnv } from "../helpers/env.js";

const PLANTED_SECRET_KEY = "SPIKE_PLANTED_SECRET";
const PLANTED_SECRET_VALUE = "ghp_REDACTION_TEST_TOKEN_aaaaaaaaaaaaaaaaaaaa";

describe("Wave-0 harness spike", () => {
  afterEach(() => {
    delete process.env[PLANTED_SECRET_KEY];
  });

  it("A1: resolves the .js->.ts specifier and loadConfig returns a Config", () => {
    const config = loadConfig({ MCP_TRANSPORT: "stdio" });
    expect(config.MCP_TRANSPORT).toBe("stdio");
    // Defaults from the Zod schema prove the real module loaded (not a stub).
    expect(config.MCP_HTTP_HOST).toBe("127.0.0.1");
    expect(config.MCP_HTTP_PORT).toBe(3000);
  });

  it("A2: buildChildEnv does not leak a parent-process secret into a child", () => {
    process.env[PLANTED_SECRET_KEY] = PLANTED_SECRET_VALUE;
    // The test process can see the planted secret...
    expect(process.env[PLANTED_SECRET_KEY]).toBe(PLANTED_SECRET_VALUE);

    // ...but a spawned child built via buildChildEnv must NOT inherit it.
    const childEnv = buildChildEnv({ transport: "stdio" });
    expect(childEnv[PLANTED_SECRET_KEY]).toBeUndefined();
    expect(Object.values(childEnv)).not.toContain(PLANTED_SECRET_VALUE);
    // The child only carries what was explicitly set.
    expect(childEnv.MCP_TRANSPORT).toBe("stdio");
  });

  it("A2: vitest test.env exposes only the configured grace vars", () => {
    // Wiring check: vitest.config.ts test.env makes these two visible.
    expect(process.env.MCP_CANCEL_GRACE_MS).toBe("5000");
    expect(process.env.MCP_SHUTDOWN_GRACE_MS).toBe("30000");
  });
});
