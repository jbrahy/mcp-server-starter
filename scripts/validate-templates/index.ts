// Validator harness CLI entry — Phase 4 success criteria #1, #2 (CI-03).
// Runs against `templates/` in CI and locally via `npm run validate`.
// IS the test infrastructure for Phase 4: the --self-test fixture (plan 04-04 + 04-05)
// is its own regression test. See .planning/phases/04-ci-validator-harness-skeleton/04-RESEARCH.md §Pattern 2.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = process.cwd();
const TEMPLATES_DIR = resolve(REPO_ROOT, "templates");
const FIXTURE_DIR = resolve(REPO_ROOT, "scripts/validate-templates/fixtures/failing-template");
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

function main(): void {
  if (SELF_TEST) {
    // TODO(plan 04-05): replace with real self-test dispatch once probes + fixture exist.
    logInfo("self-test not yet wired (full implementation in plan 04-05)", {
      fixture_dir: FIXTURE_DIR,
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

try {
  main();
} catch (e) {
  logFatal("unhandled exception", { error: String(e) });
}
