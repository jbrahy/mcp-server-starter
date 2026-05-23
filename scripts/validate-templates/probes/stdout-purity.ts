// Stdout-purity probe — Phase 4 success criterion #3 (CI-04).
// Spawn a template binary in stdio mode, pipe the SMOKE-01 initialize envelope to its stdin,
// read stdout, and assert every non-empty newline-delimited line is a valid JSON-RPC 2.0 envelope.
// See .planning/phases/04-ci-validator-harness-skeleton/04-RESEARCH.md §Pattern 3 + §Pitfall 4 + §Pitfall 5.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const REPO_ROOT = process.cwd();
const MATRIX_YAML = resolve(REPO_ROOT, "shared/compliance-matrix.yaml");
const TIMEOUT_MS = 5000;

type Failure = { passed: false; reason: string; line: number; snippet: string };
type Success = { passed: true };
export type Result = Failure | Success;

function logInfo(msg: string, data: Record<string, unknown> = {}): void {
  process.stderr.write(msg + "\n");
  const line = {
    ts: new Date().toISOString(),
    level: "info",
    msg,
    component: "stdout-purity",
    data,
  };
  process.stderr.write(JSON.stringify(line) + "\n");
}

function logFatal(msg: string, data: Record<string, unknown> = {}): never {
  process.stderr.write(msg + "\n");
  const line = {
    ts: new Date().toISOString(),
    level: "error",
    msg,
    component: "stdout-purity",
    data,
  };
  process.stderr.write(JSON.stringify(line) + "\n");
  process.exit(2);
}

function failure(reason: string, line: number, snippet: string): Failure {
  return { passed: false, reason, line, snippet };
}

function loadSmoke01Envelope(): Record<string, unknown> {
  type SmokeProbe = { id: string; request: Record<string, unknown> };
  const matrix = parseYaml(readFileSync(MATRIX_YAML, "utf8"), {
    version: "1.2",
    strict: true,
  }) as { smoke_probes?: SmokeProbe[] };
  const probe = (matrix.smoke_probes ?? []).find((p) => p.id === "SMOKE-01");
  if (!probe || !probe.request) {
    logFatal("SMOKE-01 not found in compliance-matrix.yaml — matrix structure has drifted", {
      matrix_path: MATRIX_YAML,
    });
  }
  return probe.request;
}

export async function checkStdoutPurity(
  binaryPath: string,
  extraArgs: string[] = [],
): Promise<Result> {
  if (!existsSync(binaryPath)) {
    return failure("binary not found", 0, binaryPath);
  }

  const envelope = loadSmoke01Envelope();
  const payload = JSON.stringify(envelope) + "\n";

  return new Promise<Result>((resolveProbe) => {
    let buf = "";
    let lineCount = 0;
    let firstChunk = true;
    let settled = false;

    const child = spawn("node", [binaryPath, ...extraArgs], {
      env: getDefaultEnvironment(),
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
    child.stderr.resume();

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;

      if (firstChunk) {
        firstChunk = false;
        // BOM detection at start of stream.
        if (chunk.length >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf) {
          settle(failure("BOM detected at start of stdout", 1, chunk.slice(0, 200).toString("utf8")));
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
            failure(`JSON parse failed: ${(e as Error).message}`, lineCount, stripped.slice(0, 200)),
          );
          return;
        }

        // RESEARCH §Pitfall 4 — JSON-valid log lines (e.g. Pino default output)
        // would silently pass without this second check.
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

    child.stdin.write(payload);
    child.stdin.end();
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    logFatal("usage: stdout-purity.ts <binary-path> [<extra-args>...]", {});
  }
  const [binaryPath, ...extraArgs] = args;
  const result = await checkStdoutPurity(binaryPath, extraArgs);
  if (result.passed) {
    logInfo("stdout-purity: PASS", { binaryPath });
    process.exit(0);
  } else {
    logInfo("stdout-purity: FAIL", {
      binaryPath,
      reason: result.reason,
      line: result.line,
      snippet: result.snippet,
    });
    process.exit(1);
  }
}

// Run main() only when this file is the entry point — not when imported by index.ts.
// Without this guard, `import { checkStdoutPurity } from "./probes/stdout-purity.js"`
// also triggers this main(), which consumes the parent's argv and exits prematurely.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    logFatal("unhandled exception", { error: String(e) });
  });
}
