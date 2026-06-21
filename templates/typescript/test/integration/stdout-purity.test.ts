// Stdout-purity integration — TEST-03 / T-08-12 (Tampering).
//
// In stdio mode fd 1 carries JSON-RPC ONLY; any log byte that bleeds onto stdout
// corrupts the channel. This test drives the BUILT `node dist/index.js` binary
// through a SMOKE-01 initialize via the vendored checkStdoutPurity probe and
// asserts EVERY stdout line is a JSON-RPC 2.0 envelope.
//
// Fail-ability WITHOUT a broken disk state: the SAME probe is run against the
// vendored test/fixtures/failing-template/server.js — a known-dirty binary that
// bleeds a startup banner + non-JSON-RPC noise onto stdout. The probe MUST reject
// it. That proves the purity gate bites without ever editing logger.ts or the
// pino config on disk (research §Pattern 4).

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { checkStdoutPurity } from "../helpers/stdout-purity.js";

// test/integration/ -> template root is two levels up.
const TEMPLATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// The shipped artifact (npm test's pretest build is a prerequisite).
const REAL_BINARY = resolve(TEMPLATE_ROOT, "dist/index.js");
// The vendored known-dirty fixture (single-file CJS, zero deps).
const FAILING_FIXTURE = resolve(
  TEMPLATE_ROOT,
  "test/fixtures/failing-template/server.js",
);

describe("stdout-purity integration (TEST-03)", () => {
  it("accepts the real built binary: every stdout line is JSON-RPC 2.0", async () => {
    const result = await checkStdoutPurity(REAL_BINARY, ["--transport=stdio"]);
    // Surface the failure detail (line + snippet) if the probe rejects, so a
    // regression points straight at the bleeding line.
    expect(result, JSON.stringify(result)).toMatchObject({ passed: true });
  });

  it("rejects the known-dirty fixture (fail-ability, no disk mutation)", async () => {
    const result = await checkStdoutPurity(FAILING_FIXTURE);
    // The fixture writes a startup banner + "not-json-rpc-noise" to stdout — the
    // probe MUST flag it. If this ever passes, the purity gate is vacuous.
    expect(result.passed).toBe(false);
  });
});
