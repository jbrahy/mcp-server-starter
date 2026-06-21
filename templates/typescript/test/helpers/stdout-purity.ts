// Self-contained stdout-purity checker.
//
// Vendored (copied + adapted) from scripts/validate-templates/probes/stdout-purity.ts
// so the template stands alone for Phase 9 packaging — there is NO import across
// the template boundary into scripts/validate-templates. The assertions here are
// byte-identical to the validator probe (same Result type, same BOM / CR-only /
// JSON-parse / jsonrpc-2.0 traps) to avoid divergence.
//
// Spawns `node <binaryPath> [...args]`, pipes a single SMOKE-01 initialize
// envelope to stdin, and asserts every non-empty stdout line is a JSON-RPC 2.0
// envelope. A line that is valid JSON but missing jsonrpc:"2.0" (e.g. a Pino log
// line that bled onto stdout) is a failure — that is the whole point.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

type Failure = { passed: false; reason: string; line: number; snippet: string };
type Success = { passed: true };
export type Result = Failure | Success;

const TIMEOUT_MS = 5000;

// SMOKE-01 initialize envelope, inlined verbatim from shared/compliance-matrix.yaml
// (the validator probe reads it from the YAML; vendoring it keeps the template
// self-contained — no cross-boundary file read).
const SMOKE_01_ENVELOPE: Record<string, unknown> = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  },
};

function failure(reason: string, line: number, snippet: string): Failure {
  return { passed: false, reason, line, snippet };
}

/**
 * Spawn `node binaryPath [...extraArgs]` in stdio mode, drive a SMOKE-01
 * initialize, and assert every stdout line is a JSON-RPC 2.0 envelope.
 */
export async function checkStdoutPurity(
  binaryPath: string,
  extraArgs: string[] = [],
): Promise<Result> {
  if (!existsSync(binaryPath)) {
    return failure("binary not found", 0, binaryPath);
  }

  const payload = JSON.stringify(SMOKE_01_ENVELOPE) + "\n";

  return new Promise<Result>((resolveProbe) => {
    let buf = "";
    let lineCount = 0;
    let firstChunk = true;
    let settled = false;

    // Explicit minimal env — do NOT inherit the runner's real environment.
    const child = spawn("node", [binaryPath, ...extraArgs], {
      env: { PATH: process.env.PATH ?? "", MCP_TRANSPORT: "stdio" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const settle = (result: Result): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        // already exited
      }
      resolveProbe(result);
    };

    const timer = setTimeout(() => {
      settle(failure("timeout", lineCount, ""));
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      settle(failure(`spawn error: ${err.message}`, 0, ""));
    });

    // Drain stderr so the child doesn't block on a full pipe.
    child.stderr?.resume();

    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;

      if (firstChunk) {
        firstChunk = false;
        // BOM detection at start of stream.
        if (
          chunk.length >= 3 &&
          chunk[0] === 0xef &&
          chunk[1] === 0xbb &&
          chunk[2] === 0xbf
        ) {
          settle(
            failure(
              "BOM detected at start of stdout",
              1,
              chunk.slice(0, 200).toString("utf8"),
            ),
          );
          return;
        }
      }

      buf += chunk.toString("utf8");

      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);

        if (line.length === 0) {
          continue;
        }
        lineCount += 1;

        // CR-only line ending (Windows-style bug indicator).
        if (line.includes("\r") && !line.endsWith("\r")) {
          settle(failure("CR-only line ending detected", lineCount, line.slice(0, 200)));
          return;
        }
        const stripped = line.endsWith("\r") ? line.slice(0, -1) : line;

        let parsed: unknown;
        try {
          parsed = JSON.parse(stripped);
        } catch (e) {
          settle(
            failure(
              `JSON parse failed: ${(e as Error).message}`,
              lineCount,
              stripped.slice(0, 200),
            ),
          );
          return;
        }

        // A JSON-valid log line (e.g. Pino default output) would silently pass
        // without this second check.
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          (parsed as { jsonrpc?: unknown }).jsonrpc !== "2.0"
        ) {
          settle(
            failure(
              'line is valid JSON but missing jsonrpc:"2.0" (looks like a log line)',
              lineCount,
              stripped.slice(0, 200),
            ),
          );
          return;
        }
      }
    });

    child.on("exit", () => {
      if (settled) return;
      if (lineCount === 0) {
        settle(failure("process exited with empty stdout", 0, ""));
        return;
      }
      settle({ passed: true });
    });

    child.stdin?.write(payload);
    child.stdin?.end();
  });
}
