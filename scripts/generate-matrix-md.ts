// Generator: renders shared/compliance-matrix.md from shared/compliance-matrix.yaml.
// Single-process validator + renderer per Phase 3 CONTEXT D-19..D-26.
// Validates both YAMLs against their JSON Schema 2020-12 contracts via Ajv (D-20),
// applies D-25 cross-checks (duplicate IDs, sequential suffixes, level enum,
// doc_anchor target-file existence), then writes a deterministic Markdown view
// that is idempotent on re-run (D-24). Runs via tsx; no build step (D-23).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";
import type { ErrorObject } from "ajv";

const REPO_ROOT = process.cwd();
const MATRIX_YAML = resolve(REPO_ROOT, "shared/compliance-matrix.yaml");
const MATRIX_SCHEMA = resolve(REPO_ROOT, "shared/compliance-matrix.schema.json");
const SURFACE_YAML = resolve(REPO_ROOT, "shared/example-surface.yaml");
const SURFACE_SCHEMA = resolve(REPO_ROOT, "shared/example-surface.schema.json");
const OUTPUT_MD = resolve(REPO_ROOT, "shared/compliance-matrix.md");

const SECTION_ORDER = [
  "protocol",
  "transports",
  "capabilities",
  "errors",
  "progress_cancellation",
  "log_schema",
  "surface",
  "security",
  "smoke_probes",
  "inspector_commands",
] as const;

const SECTION_TITLES: Record<string, string> = {
  protocol: "Protocol",
  transports: "Transports",
  capabilities: "Capabilities",
  errors: "Errors",
  progress_cancellation: "Progress and Cancellation",
  log_schema: "Log Schema",
  surface: "Surface",
  security: "Security",
  smoke_probes: "Smoke Probes",
  inspector_commands: "Inspector Commands",
};

const SECTION_SLUGS: Record<string, string> = {
  protocol: "protocol",
  transports: "transports",
  capabilities: "capabilities",
  errors: "errors",
  progress_cancellation: "progress-and-cancellation",
  log_schema: "log-schema",
  surface: "surface",
  security: "security",
  smoke_probes: "smoke-probes",
  inspector_commands: "inspector-commands",
};

const TABLE_SECTIONS = [
  "transports",
  "capabilities",
  "errors",
  "progress_cancellation",
  "log_schema",
  "security",
] as const;

const ORIENTATION: Record<string, string> = {
  transports:
    "Templates ship a single binary that speaks MCP over stdio (default) and Streamable HTTP. Each row below pins one transport-level invariant.",
  capabilities:
    "Initialize-time capability advertisement. Every row below must be observable in the negotiated capabilities object.",
  errors:
    "Two error envelopes coexist: protocol-level (JSON-RPC) and tool-level (`isError`). They are not interchangeable.",
  progress_cancellation:
    "Long-running tools emit progress notifications and honor cancellation by sending a final response — never by going silent.",
  log_schema:
    "Structured JSON log lines written to stderr. The schema is closed; additions go inside `data:{}`.",
  security:
    "The non-negotiables. Each row cites a baseline anchor and the implementation surface that owns it.",
};

type Checkpoint = {
  id: string;
  level: "MUST" | "SHOULD" | "MAY";
  check: string;
  doc_anchor: string;
  code_anchor: string;
  applies_to?: ("stdio" | "streamable_http")[];
  notes?: string;
};

type SmokeProbe = {
  id: string;
  name: string;
  request: Record<string, unknown>;
  required_fields: string[];
  forbidden_fields?: string[];
  expect?: Record<string, Record<string, unknown>>;
};

type InspectorCommand = {
  id: string;
  label: string;
  cmd: string;
  expect: string;
};

type MatrixData = {
  protocol: { version: string };
  transports: Checkpoint[];
  capabilities: Checkpoint[];
  errors: Checkpoint[];
  progress_cancellation: Checkpoint[];
  log_schema: Checkpoint[];
  surface: { yaml_path: string; checkpoints: Checkpoint[] };
  security: Checkpoint[];
  smoke_probes: SmokeProbe[];
  inspector_commands: InspectorCommand[];
};

function logFatal(msg: string, data: Record<string, unknown> = {}): never {
  const line = {
    ts: new Date().toISOString(),
    level: "error",
    msg,
    component: "generate-matrix-md",
    data,
  };
  process.stderr.write(JSON.stringify(line) + "\n");
  process.exit(1);
}

function loadAndValidate(): MatrixData {
  const matrixSchema = JSON.parse(readFileSync(MATRIX_SCHEMA, "utf8"));
  const surfaceSchema = JSON.parse(readFileSync(SURFACE_SCHEMA, "utf8"));
  // Strict mode + allErrors per D-20. allowUnionTypes permits the
  // JSON-RPC `id` field's legitimate ["integer","string"] union in the
  // smoke_probes schema (JSON-RPC 2.0 §4); strict mode still catches
  // unknown keywords, missing types, and every other shape mismatch.
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  const validateMatrix = ajv.compile(matrixSchema);
  const validateSurface = ajv.compile(surfaceSchema);

  // yaml v2.x: version "1.2" forces YAML 1.2 core schema (no 1.1 legacy
  // booleans like yes/no/on/off). strict: true raises on duplicate keys.
  const matrixData = parseYaml(readFileSync(MATRIX_YAML, "utf8"), {
    version: "1.2",
    strict: true,
  }) as MatrixData;
  const surfaceData = parseYaml(readFileSync(SURFACE_YAML, "utf8"), {
    version: "1.2",
    strict: true,
  });

  if (!validateMatrix(matrixData)) {
    logFatal("compliance-matrix.yaml schema validation failed", {
      errors: (validateMatrix.errors as ErrorObject[]).map((e) => ({
        instancePath: e.instancePath,
        schemaPath: e.schemaPath,
        message: e.message,
      })),
    });
  }
  if (!validateSurface(surfaceData)) {
    logFatal("example-surface.yaml schema validation failed", {
      errors: (validateSurface.errors as ErrorObject[]).map((e) => ({
        instancePath: e.instancePath,
        schemaPath: e.schemaPath,
        message: e.message,
      })),
    });
  }
  return matrixData;
}

function collectCheckpoints(m: MatrixData): Checkpoint[] {
  return [
    ...m.transports,
    ...m.capabilities,
    ...m.errors,
    ...m.progress_cancellation,
    ...m.log_schema,
    ...m.surface.checkpoints,
    ...m.security,
  ];
}

function crossCheck(m: MatrixData): void {
  const checkpoints = collectCheckpoints(m);

  // Duplicate IDs across all sections.
  const seen = new Map<string, number>();
  for (const cp of checkpoints) {
    seen.set(cp.id, (seen.get(cp.id) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  if (dupes.length > 0) {
    logFatal("duplicate checkpoint IDs found across sections", { duplicated: dupes });
  }

  // Group by prefix, assert sequential 01..N.
  const byPrefix = new Map<string, number[]>();
  for (const cp of checkpoints) {
    const m2 = cp.id.match(/^([A-Z]+)-(\d{2})$/);
    if (!m2) {
      logFatal("malformed checkpoint ID", { id: cp.id });
    }
    const prefix = m2![1];
    const num = parseInt(m2![2], 10);
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix)!.push(num);
  }
  for (const [prefix, nums] of byPrefix.entries()) {
    const sorted = [...nums].sort((a, b) => a - b);
    const expected = Array.from({ length: sorted.length }, (_, i) => i + 1);
    if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
      logFatal("non-sequential checkpoint numbering within prefix", {
        prefix,
        actual: sorted,
        expected,
      });
    }
  }

  // Level enum (schema enforces but double-check per D-25).
  const validLevels = new Set(["MUST", "SHOULD", "MAY"]);
  for (const cp of checkpoints) {
    if (!validLevels.has(cp.level)) {
      logFatal("unknown level value", { id: cp.id, level: cp.level });
    }
  }

  // doc_anchor target-file existence.
  for (const cp of checkpoints) {
    const filePath = cp.doc_anchor.split("#")[0];
    if (!existsSync(resolve(REPO_ROOT, filePath))) {
      logFatal("doc_anchor target file does not exist", {
        id: cp.id,
        doc_anchor: cp.doc_anchor,
        missing_file: filePath,
      });
    }
  }

  // Smoke probe sequential numbering.
  const smokeNums = m.smoke_probes.map((p) => {
    const m2 = p.id.match(/^SMOKE-(\d{2})$/);
    if (!m2) logFatal("malformed smoke probe ID", { id: p.id });
    return parseInt(m2![1], 10);
  });
  const smokeSorted = [...smokeNums].sort((a, b) => a - b);
  const smokeExpected = Array.from({ length: smokeSorted.length }, (_, i) => i + 1);
  if (JSON.stringify(smokeSorted) !== JSON.stringify(smokeExpected)) {
    logFatal("non-sequential smoke probe numbering", {
      actual: smokeSorted,
      expected: smokeExpected,
    });
  }

  // Inspector command sequential numbering.
  const inspNums = m.inspector_commands.map((c) => {
    const m2 = c.id.match(/^INSP-(\d{2})$/);
    if (!m2) logFatal("malformed inspector command ID", { id: c.id });
    return parseInt(m2![1], 10);
  });
  const inspSorted = [...inspNums].sort((a, b) => a - b);
  const inspExpected = Array.from({ length: inspSorted.length }, (_, i) => i + 1);
  if (JSON.stringify(inspSorted) !== JSON.stringify(inspExpected)) {
    logFatal("non-sequential inspector command numbering", {
      actual: inspSorted,
      expected: inspExpected,
    });
  }
}

// --- Renderer --------------------------------------------------------------

function fmtAppliesTo(applies?: string[]): string {
  if (!applies || applies.length === 0) return "stdio, streamable_http";
  return [...applies].sort().join(", ");
}

function renderCheckpointTable(rows: Checkpoint[]): string {
  const header =
    "| ID | Level | Check | Doc | Code | Applies to |\n" +
    "|----|-------|-------|-----|------|------------|";
  const body = rows
    .map((cp) => {
      const idCell = `<a id="${cp.id}"></a>\`${cp.id}\``;
      const docCell = `[${cp.doc_anchor}](${cp.doc_anchor})`;
      const codeCell = `\`${cp.code_anchor}\``;
      return `| ${idCell} | ${cp.level} | ${cp.check} | ${docCell} | ${codeCell} | ${fmtAppliesTo(cp.applies_to)} |`;
    })
    .join("\n");
  return `${header}\n${body}`;
}

function renderSection(key: string, rows: Checkpoint[]): string {
  const title = `## ${SECTION_TITLES[key]}`;
  const orient = ORIENTATION[key] ?? "";
  const table = renderCheckpointTable(rows);
  return `${title}\n\n${orient}\n\n${table}\n`;
}

function renderSurface(s: MatrixData["surface"]): string {
  const intro =
    "Canonical surface defined in [`shared/example-surface.yaml`](example-surface.yaml). Every template implements these bytes verbatim.";
  return `## Surface\n\n${intro}\n\n${renderCheckpointTable(s.checkpoints)}\n`;
}

function renderSmokeProbes(probes: SmokeProbe[]): string {
  const lines: string[] = ["## Smoke Probes", ""];
  lines.push(
    "Each probe is a JSON-RPC request plus shape assertions executed by Phase 4 CI against every template.",
  );
  lines.push("");
  for (const p of probes) {
    lines.push(`### <a id="${p.id}"></a>${p.id}: ${p.name}`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(p.request, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("**Required fields:**");
    lines.push("");
    for (const f of p.required_fields) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
    if (p.forbidden_fields && p.forbidden_fields.length > 0) {
      lines.push("**Forbidden fields:**");
      lines.push("");
      for (const f of p.forbidden_fields) {
        lines.push(`- \`${f}\``);
      }
      lines.push("");
    }
    if (p.expect && Object.keys(p.expect).length > 0) {
      lines.push("**Expect:**");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(p.expect, null, 2));
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}

function renderInspectorCommands(cmds: InspectorCommand[]): string {
  const header =
    "| ID | Label | Command | Expected output |\n" +
    "|----|-------|---------|-----------------|";
  const body = cmds
    .map((c) => {
      const idCell = `<a id="${c.id}"></a>\`${c.id}\``;
      return `| ${idCell} | ${c.label} | \`${c.cmd}\` | ${c.expect} |`;
    })
    .join("\n");
  return `## Inspector Commands\n\nEach command is a one-line MCP Inspector CLI invocation against the TS template's stdio entry point. Forward-reference: \`templates/typescript/src/index.ts\` lands in Phase 5.\n\n${header}\n${body}\n`;
}

function renderToc(): string {
  const items = SECTION_ORDER.map(
    (k) => `- [${SECTION_TITLES[k]}](#${SECTION_SLUGS[k]})`,
  ).join("\n");
  return `## Table of Contents\n\n${items}\n`;
}

function renderHeader(): string {
  return [
    "# MCP Server Template Compliance Matrix",
    "",
    "The single source of truth for what every MCP server template in this suite must do. Each row below cites the documentation anchor that defines the rule and the code anchor in the canonical TypeScript template that owns the implementation. Downstream language ports (Python, Go, C#, Rust) implement the same rows.",
    "",
    "> Generated from shared/compliance-matrix.yaml — do not edit directly.",
    "",
  ].join("\n");
}

function renderProtocol(p: { version: string }): string {
  return `## Protocol\n\nProtocol version: \`${p.version}\`.\n`;
}

function render(m: MatrixData): string {
  const parts: string[] = [];
  parts.push(renderHeader());
  parts.push(renderToc());
  parts.push("");
  parts.push(renderProtocol(m.protocol));
  parts.push("");
  parts.push(renderSection("transports", m.transports));
  parts.push(renderSection("capabilities", m.capabilities));
  parts.push(renderSection("errors", m.errors));
  parts.push(renderSection("progress_cancellation", m.progress_cancellation));
  parts.push(renderSection("log_schema", m.log_schema));
  parts.push(renderSurface(m.surface));
  parts.push(renderSection("security", m.security));
  parts.push(renderSmokeProbes(m.smoke_probes));
  parts.push(renderInspectorCommands(m.inspector_commands));

  // Strip trailing whitespace on every line; ensure single trailing newline.
  const raw = parts.join("\n");
  const cleaned = raw
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n");
  // Collapse 3+ consecutive blank lines to exactly 2, then ensure file ends
  // with exactly one trailing newline.
  const collapsed = cleaned.replace(/\n{3,}/g, "\n\n");
  return collapsed.endsWith("\n") ? collapsed : collapsed + "\n";
}

// --- Main ------------------------------------------------------------------

function main(): void {
  const matrix = loadAndValidate();
  crossCheck(matrix);
  TABLE_SECTIONS.forEach(() => {}); // referenced for future contributors

  const newContent = render(matrix);
  const existingContent = existsSync(OUTPUT_MD) ? readFileSync(OUTPUT_MD, "utf8") : "";
  if (newContent !== existingContent) {
    writeFileSync(OUTPUT_MD, newContent, "utf8");
    process.stdout.write(`Updated ${OUTPUT_MD}\n`);
  } else {
    process.stdout.write(`No changes (idempotent): ${OUTPUT_MD}\n`);
  }
}

main();
