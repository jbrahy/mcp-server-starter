// Surface byte-conformance gate (SC#5) for SURF-01/02/03.
//
// This is the single command that proves the template's live-registered surface
// has not drifted from the normative contract in shared/example-surface.yaml.
// It parses the YAML as the source of truth, spawns the template over stdio via
// the SDK client, lists/reads/gets all three surfaces, and asserts — field by
// field — that the live registrations match the YAML exactly:
//
//   tool      add        name, description, inputSchema (a/b: number + verbatim
//                        descriptions + both required), and the static
//                        cancel_behavior shape (mode terminate_no_response /
//                        sends_response false). Runtime cancellation itself is
//                        proven separately by smoke-cancellation.ts — here we
//                        only assert the YAML's declared cancel_behavior fields
//                        are present and well-formed (no runtime re-test).
//   resource  greeting   uri example://greeting, mimeType text/plain, body text
//                        "Hello from MCP".
//   prompt    greet      name greet, argument {name, string, required}, and the
//                        rendered message for {name:"World"} equals the YAML
//                        render_template with {{name}} -> "World".
//
// Expected values are READ FROM the YAML at runtime — the contract is never
// hardcoded here. Every mismatch is collected and printed; the gate exits 1 on
// any drift and 0 only when all three surfaces match. A `--self-test` flag
// mutates one expected value in memory and re-runs the assertions to prove the
// gate is able to fail (no vacuous always-pass). A hard timeout exits 1 if the
// server never connects.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parse as parseYaml } from "yaml";

const HARD_TIMEOUT_MS = 30_000;

// templates/typescript/scripts/ -> repo root is three levels up.
const TEMPLATE_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const REPO_ROOT = resolve(TEMPLATE_ROOT, "..", "..");
const SURFACE_YAML = resolve(REPO_ROOT, "shared/example-surface.yaml");

// --- Normative contract shapes (parsed from example-surface.yaml) ----------

interface SurfaceTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  cancel_behavior: {
    mode: string;
    sends_response: boolean;
  };
}

interface SurfaceResource {
  uri: string;
  mimeType: string;
  text: string;
}

interface SurfacePromptArg {
  name: string;
  type: string;
  required: boolean;
}

interface SurfacePrompt {
  name: string;
  arguments: SurfacePromptArg[];
  render_template: string;
}

interface Surface {
  tools: SurfaceTool[];
  resources: SurfaceResource[];
  prompts: SurfacePrompt[];
}

function loadSurface(): Surface {
  return parseYaml(readFileSync(SURFACE_YAML, "utf8"), {
    version: "1.2",
    strict: true,
  }) as Surface;
}

// Render the YAML render_template by substituting {{name}} occurrences. The
// surface uses a single {{name}} placeholder; this mirrors the template's
// `Hello, ${name}!` interpolation without importing a templating engine.
function renderTemplate(template: string, value: string): string {
  return template.replace(/\{\{\s*name\s*\}\}/g, value);
}

// --- Live introspection ----------------------------------------------------

interface LiveSurface {
  tools: Awaited<ReturnType<Client["listTools"]>>["tools"];
  resources: Awaited<ReturnType<Client["listResources"]>>["resources"];
  greetingRead: Awaited<ReturnType<Client["readResource"]>>;
  prompts: Awaited<ReturnType<Client["listPrompts"]>>["prompts"];
  greetGet: Awaited<ReturnType<Client["getPrompt"]>>;
}

async function introspect(surface: Surface): Promise<LiveSurface> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts", "--transport=stdio"],
    cwd: TEMPLATE_ROOT,
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: "check-surface-conformance", version: "0.0.0" });

  await client.connect(transport);

  const greetingUri = surface.resources[0]?.uri ?? "example://greeting";
  const promptArgValue = "World";

  const [tools, resources, greetingRead, prompts, greetGet] = await Promise.all([
    client.listTools(),
    client.listResources(),
    client.readResource({ uri: greetingUri }),
    client.listPrompts(),
    client.getPrompt({ name: surface.prompts[0]?.name ?? "greet", arguments: { name: promptArgValue } }),
  ]);

  await client.close();

  return {
    tools: tools.tools,
    resources: resources.resources,
    greetingRead,
    prompts: prompts.prompts,
    greetGet,
  };
}

// --- Assertions ------------------------------------------------------------

// `expected` is read from the YAML; `actual` from the live server. We collect
// every mismatch as a descriptive expected-vs-actual diff rather than failing
// fast, so one run surfaces all drift at once.
function diffSurface(expected: Surface, live: LiveSurface): string[] {
  const failures: string[] = [];
  const note = (label: string, exp: unknown, act: unknown): void => {
    failures.push(`${label}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`);
  };

  // -- Tool (add) -----------------------------------------------------------
  if (live.tools.length !== expected.tools.length) {
    note("tools count", expected.tools.length, live.tools.length);
  }
  const expTool = expected.tools[0];
  const liveTool = live.tools.find((t) => t.name === expTool.name);
  if (!liveTool) {
    note(`tool "${expTool.name}" present`, true, false);
  } else {
    if (liveTool.description !== expTool.description) {
      note(`tool ${expTool.name} description`, expTool.description, liveTool.description);
    }
    const liveProps = (liveTool.inputSchema.properties ?? {}) as Record<
      string,
      { type?: string; description?: string }
    >;
    const liveRequired = liveTool.inputSchema.required ?? [];
    for (const [propName, expProp] of Object.entries(expTool.inputSchema.properties)) {
      const liveProp = liveProps[propName];
      if (!liveProp) {
        note(`tool ${expTool.name} property "${propName}" present`, true, false);
        continue;
      }
      if (liveProp.type !== expProp.type) {
        note(`tool ${expTool.name}.${propName} type`, expProp.type, liveProp.type);
      }
      if (liveProp.description !== expProp.description) {
        note(`tool ${expTool.name}.${propName} description`, expProp.description, liveProp.description);
      }
    }
    for (const req of expTool.inputSchema.required) {
      if (!liveRequired.includes(req)) {
        note(`tool ${expTool.name} required includes "${req}"`, true, false);
      }
    }
  }
  // cancel_behavior is a STATIC contract field (no runtime re-test here): assert
  // the YAML declares the no-response cancellation shape the template implements.
  if (expTool.cancel_behavior.mode !== "terminate_no_response") {
    note(`tool ${expTool.name} cancel_behavior.mode`, "terminate_no_response", expTool.cancel_behavior.mode);
  }
  if (expTool.cancel_behavior.sends_response !== false) {
    note(`tool ${expTool.name} cancel_behavior.sends_response`, false, expTool.cancel_behavior.sends_response);
  }

  // -- Resource (greeting) --------------------------------------------------
  const expRes = expected.resources[0];
  const liveRes = live.resources.find((r) => r.uri === expRes.uri);
  if (!liveRes) {
    note(`resource "${expRes.uri}" present`, true, false);
  } else if (liveRes.mimeType !== expRes.mimeType) {
    note(`resource ${expRes.uri} mimeType`, expRes.mimeType, liveRes.mimeType);
  }
  const liveContent = live.greetingRead.contents[0];
  const liveText = liveContent && "text" in liveContent ? liveContent.text : undefined;
  if (liveText !== expRes.text) {
    note(`resource ${expRes.uri} text`, expRes.text, liveText);
  }
  if (liveContent && liveContent.uri !== expRes.uri) {
    note(`resource ${expRes.uri} content uri`, expRes.uri, liveContent.uri);
  }

  // -- Prompt (greet) -------------------------------------------------------
  const expPrompt = expected.prompts[0];
  const livePrompt = live.prompts.find((p) => p.name === expPrompt.name);
  if (!livePrompt) {
    note(`prompt "${expPrompt.name}" present`, true, false);
  } else {
    const liveArgs = livePrompt.arguments ?? [];
    for (const expArg of expPrompt.arguments) {
      const liveArg = liveArgs.find((a) => a.name === expArg.name);
      if (!liveArg) {
        note(`prompt ${expPrompt.name} argument "${expArg.name}" present`, true, false);
        continue;
      }
      // The wire exposes name + required for prompt arguments (MCP carries no
      // per-arg JSON type), so we assert those live and assert the declared
      // type from the YAML contract itself.
      if ((liveArg.required ?? false) !== expArg.required) {
        note(`prompt ${expPrompt.name}.${expArg.name} required`, expArg.required, liveArg.required ?? false);
      }
      if (expArg.type !== "string") {
        note(`prompt ${expPrompt.name}.${expArg.name} declared type`, "string", expArg.type);
      }
    }
  }
  const expRendered = renderTemplate(expPrompt.render_template, "World");
  const liveMsg = live.greetGet.messages[0];
  const liveRendered =
    liveMsg && liveMsg.content.type === "text" ? liveMsg.content.text : undefined;
  if (liveRendered !== expRendered) {
    note(`prompt ${expPrompt.name} rendered text`, expRendered, liveRendered);
  }

  return failures;
}

// --- Self-test (fail-ability proof) ----------------------------------------

// Mutate one expected value and confirm the differ reports at least one failure.
// This guards against a vacuous gate that always passes regardless of drift.
function selfTest(expected: Surface, live: LiveSurface): boolean {
  const cleanFailures = diffSurface(expected, live);
  if (cleanFailures.length !== 0) {
    process.stdout.write("SELF-TEST FAIL: clean surface should produce zero failures but did not\n");
    for (const f of cleanFailures) process.stdout.write(`  - ${f}\n`);
    return false;
  }
  const mutated: Surface = JSON.parse(JSON.stringify(expected));
  mutated.tools[0].description = mutated.tools[0].description + " (mutated)";
  const mutatedFailures = diffSurface(mutated, live);
  if (mutatedFailures.length === 0) {
    process.stdout.write("SELF-TEST FAIL: mutated expectation produced no failures — gate cannot fail\n");
    return false;
  }
  process.stdout.write(
    `SELF-TEST PASS: clean surface yields 0 failures; a mutated expectation yields ${mutatedFailures.length} (gate is fail-able)\n`,
  );
  return true;
}

// --- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const isSelfTest = process.argv.includes("--self-test");

  const hardTimer = setTimeout(() => {
    process.stdout.write(
      `FAIL: server did not connect / assertions did not settle within ${HARD_TIMEOUT_MS}ms\n`,
    );
    process.exit(1);
  }, HARD_TIMEOUT_MS);
  hardTimer.unref();

  const expected = loadSurface();
  const live = await introspect(expected);

  if (isSelfTest) {
    clearTimeout(hardTimer);
    process.exit(selfTest(expected, live) ? 0 : 1);
  }

  const failures = diffSurface(expected, live);
  clearTimeout(hardTimer);

  if (failures.length > 0) {
    process.stdout.write(
      `FAIL: ${failures.length} surface conformance mismatch(es) vs shared/example-surface.yaml:\n`,
    );
    for (const f of failures) process.stdout.write(`  - ${f}\n`);
    process.exit(1);
  }

  process.stdout.write(
    "PASS: live surface (add tool, greeting resource, greet prompt) matches shared/example-surface.yaml\n",
  );
  process.exit(0);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    process.stdout.write(`FAIL: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
