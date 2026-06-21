// The `example://greeting` resource — the canonical example resource (SURF-02).
//
// A single static resource whose body is byte-normative: it returns the exact
// text "Hello from MCP" with mimeType text/plain, sourced verbatim from
// shared/example-surface.yaml. resources/list advertises it; resources/read
// returns its body.
//
// SECURITY / THREAT NOTES (see shared threat register, T-06-05):
//   - The URI is hardcoded ("example://greeting") with NO user-controlled path
//     component, so there is no path-injection surface in this slice. Future
//     file-backed resources that map a client-supplied path to disk MUST route
//     through fs-roots (Phase 7) — never interpolate untrusted input into a
//     filesystem path here.

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// The advertised resource URI. Custom-scheme URLs are not normalized by WHATWG
// URL, so new URL(GREETING_URI).href === GREETING_URI (RESEARCH A1). We emit
// this literal constant for the contents uri rather than uri.href, so the bytes
// are locked even if a future runtime ever normalizes the parsed href.
const GREETING_URI = "example://greeting";

/**
 * Register the `example://greeting` resource on the given server.
 *
 * The read callback returns the locked greeting bytes ("Hello from MCP",
 * mimeType text/plain) sourced from shared/example-surface.yaml.
 *
 * @param server the McpServer to register on
 */
export function registerGreetingResource(server: McpServer): void {
  server.registerResource(
    "greeting",
    GREETING_URI,
    { mimeType: "text/plain" },
    () => ({
      contents: [
        { uri: GREETING_URI, mimeType: "text/plain", text: "Hello from MCP" },
      ],
    }),
  );
}
