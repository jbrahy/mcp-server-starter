// The `greet` prompt — the canonical example prompt (SURF-03).
//
// A single parameterized prompt with one required string argument `name`. Its
// rendered output is byte-normative: prompts/get with name=World yields a user
// message whose text is exactly "Hello, World!", sourced from the render
// template in shared/example-surface.yaml.
//
// SECURITY / THREAT NOTES (see shared threat register, T-06-06):
//   - `name` is Zod-string-validated and length-capped (max 256) before it
//     reaches the template — a benign greeting with no executable surface. The
//     cap is a defensive bound, not part of the advertised contract: prompts/list
//     exposes only the arg name/description/required, so SURF-03 byte-conformance
//     is unaffected. Production prompts that feed untrusted text to a downstream
//     LLM MUST additionally escape/constrain the input for that LLM's context
//     (prompt-injection mitigation).

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Register the `greet` prompt on the given server.
 *
 * `argsSchema` is a Zod RAW SHAPE ({ name: z.string()... }) — not a wrapped
 * z.object — which is what registerPrompt consumes. `name` is required by
 * construction (no .optional / .default). The callback renders the locked
 * greeting template, producing "Hello, World!" for name=World.
 *
 * @param server the McpServer to register on
 */
export function registerGreetPrompt(server: McpServer): void {
  server.registerPrompt(
    "greet",
    { argsSchema: { name: z.string().max(256) } },
    ({ name }) => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `Hello, ${name}!` },
        },
      ],
    }),
  );
}
