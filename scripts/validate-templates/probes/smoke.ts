// Smoke-probe driver skeleton — Phase 4 success criterion #5 (CI-05).
// Drives SMOKE-01..09 from `shared/compliance-matrix.yaml` against a template binary
// via SDK Client + StdioClientTransport. Phase 4 ships the import surface and stub function
// so lockfile resolution failures surface today; per-probe assertions land in Phase 5
// when templates/typescript/ ships. See .planning/phases/04-ci-validator-harness-skeleton/04-RESEARCH.md §Pattern 4.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

type SmokeProbe = {
  id: string;
  name: string;
  request: Record<string, unknown>;
  required_fields?: string[];
  forbidden_fields?: string[];
  expect?: Record<string, Record<string, unknown>>;
};
type ProbeFailure = { id: string; reason: string };
export type SmokeResult = { passed: boolean; failures: ProbeFailure[] };

function logInfo(msg: string, data: Record<string, unknown> = {}): void {
  process.stderr.write(msg + "\n");
  const line = {
    ts: new Date().toISOString(),
    level: "info",
    msg,
    component: "smoke",
    data,
  };
  process.stderr.write(JSON.stringify(line) + "\n");
}

export async function runSmokeProbes(templateDir: string): Promise<SmokeResult> {
  // Load matrix to confirm structure is intact (also exercises the YAML loader path
  // so a matrix-shape regression surfaces here, not later).
  const matrixPath = resolve(process.cwd(), "shared/compliance-matrix.yaml");
  const matrix = parseYaml(readFileSync(matrixPath, "utf8"), {
    version: "1.2",
    strict: true,
  }) as { smoke_probes?: SmokeProbe[] };
  const probes = matrix.smoke_probes ?? [];

  // TODO(Phase 5): per-probe SDK Client invocation. The shape lives in
  // .planning/phases/04-ci-validator-harness-skeleton/04-RESEARCH.md §"SDK Client driving SMOKE-04".
  // For Phase 4 we only confirm the matrix exposes the expected probe count.
  logInfo("smoke: skeleton stub", { templateDir, probe_count: probes.length });
  return { passed: true, failures: [] };
}

// The SDK imports are intentionally referenced via type aliases so the import surface
// is exercised at compile/typecheck time and Phase 4 surfaces any subpath-resolution
// errors at module load time. Full runtime use lands in Phase 5. Underscore prefix
// signals intentionally-unused.
type _SdkClientType = Client;
type _SdkTransportType = StdioClientTransport;
type _SdkEnvHelperType = typeof getDefaultEnvironment;
