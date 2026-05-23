// Validator harness CLI entry — Phase 4 success criteria #1, #2 (CI-03).
// Runs against `templates/` in CI and locally via `npm run validate`.
// IS the test infrastructure for Phase 4: the --self-test fixture (plan 04-04 + 04-05)
// is its own regression test. See .planning/phases/04-ci-validator-harness-skeleton/04-RESEARCH.md §Pattern 2.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkStdoutPurity } from "./probes/stdout-purity.js";

const REPO_ROOT = process.cwd();
const TEMPLATES_DIR = resolve(REPO_ROOT, "templates");
const FIXTURE_DIR = resolve(REPO_ROOT, "scripts/validate-templates/fixtures/failing-template");
const FIXTURE_BIN = resolve(FIXTURE_DIR, "server.js");
const SELF_TEST = process.argv.includes("--self-test");

function logInfo(msg: string, data: Record<string, unknown> = {}): void {
  // Plain line first so CI greps for load-bearing strings (RESEARCH §Pitfall 1)
  // without parsing JSON; structured envelope follows for log aggregators.
  process.stderr.write(msg + "\n");
  const line = {
    ts: new Date().toISOString(),
    level: "info",
    msg,
    component: "validate-templates",
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
    component: "validate-templates",
    data,
  };
  process.stderr.write(JSON.stringify(line) + "\n");
  process.exit(1);
}

function discoverTemplates(): string[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR)
    .map((entry) => join(TEMPLATES_DIR, entry))
    .filter((path) => {
      try {
        return statSync(path).isDirectory() && existsSync(join(path, "package.json"));
      } catch {
        return false;
      }
    });
}

async function main(): Promise<void> {
  if (SELF_TEST) {
    // Per RESEARCH §Pitfall 1: --self-test is the regression test for the
    // validator-can-fail invariant. The fixture deliberately violates stdout-purity;
    // the probe MUST reject it. If the probe says "passed", the validator has
    // regressed and CI MUST fail.
    const result = await checkStdoutPurity(FIXTURE_BIN);
    if (result.passed) {
      process.stderr.write("self-test FAIL: failing-template fixture passed (validator is not biting)\n");
      logInfo("self-test regression", {
        fixture: FIXTURE_BIN,
        expected: "failure",
        actual: "pass",
      });
      process.exit(1);
    }
    process.stderr.write("self-test OK: failing-template was correctly rejected\n");
    logInfo("self-test passed", {
      fixture: FIXTURE_BIN,
      rejected_reason: result.reason,
      rejected_line: result.line,
    });
    process.exit(0);
  }

  if (!existsSync(TEMPLATES_DIR)) {
    logInfo("0 templates validated (no templates/ directory)", {
      templates_dir: TEMPLATES_DIR,
    });
    process.exit(0);
  }

  const templates = discoverTemplates();
  if (templates.length === 0) {
    logInfo("0 templates validated", { templates_dir: TEMPLATES_DIR });
    process.exit(0);
  }

  // TODO(Phase 5): wire per-template probe dispatch (stdout-purity + smoke probes).
  logInfo(`${templates.length} template(s) validated, 0 failure(s)`, {
    count: templates.length,
    templates,
  });
  process.exit(0);
}

main().catch((e) => logFatal("unhandled exception", { error: String(e) }));
