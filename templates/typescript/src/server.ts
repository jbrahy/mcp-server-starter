// MCP server construction + capability advertisement (TS-08).
//
// Declares capabilities in ServerOptions so the SDK answers `initialize` and
// negotiates the protocol version automatically — the template MUST NOT
// hardcode `protocolVersion`; the SDK returns its negotiated value
// (XPORT-06, SMOKE-02).
//
// This slice registers the canonical example surface — the `add` tool
// (SURF-01), the example://greeting resource (SURF-02), and the greet prompt
// (SURF-03) — so the SDK advertises the tools/resources/prompts capabilities at
// initialize (SMOKE-01 requires result.capabilities.{tools,resources,prompts}
// present).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  InitializeRequestSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
  LATEST_PROTOCOL_VERSION,
  type ServerResult,
} from "@modelcontextprotocol/sdk/types.js";
import { type Logger } from "./logger.js";
import { type Config } from "./config.js";
import { registerAddTool } from "./tools/add.js";
import { registerGreetingResource } from "./resources/example.js";
import { registerGreetPrompt } from "./prompts/example.js";

const SERVER_NAME = "mcp-typescript-template";
const SERVER_VERSION = "0.1.0";

/**
 * Wrap the SDK's `initialize` handler to emit `protocol_version_negotiated`
 * (HARD-03 / LOG-06). The SDK computes the negotiated protocol version inline
 * in its private `_oninitialize` and does NOT expose it (research §Pattern 2),
 * so the only seam is to re-register a handler for InitializeRequestSchema —
 * `setRequestHandler` overrides the default by method key.
 *
 * The negotiated version is computed with the SDK's exact rule
 * (`SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST`) — it
 * is NEVER hardcoded; the value depends on the client's requested version.
 *
 * Rather than reproduce the SDK's initialize result (capabilities, serverInfo,
 * instructions), the wrapper DELEGATES to the SDK's original handler so the real
 * handshake — and all its side effects (recording client capabilities/version)
 * — is preserved verbatim. The original is captured from the Protocol's handler
 * map before override. This composition was verified empirically against
 * @modelcontextprotocol/sdk@1.29.0 (research Assumption A2): the handshake still
 * returns the negotiated protocolVersion + capabilities + serverInfo.
 *
 * @param transport the active transport label ("stdio" | "http") for the log line
 */
function instrumentVersionNegotiation(
  server: McpServer,
  logger: Logger,
  transport: "stdio" | "http",
): void {
  const inner = server.server;
  const method = InitializeRequestSchema.shape.method.value;

  // Capture the SDK's default initialize handler (registered in the Server
  // constructor) so the wrapper can delegate to it. Reading the Protocol's
  // handler map is a pinned-SDK seam; if absent, fall back to recomputing the
  // standard result so version-negotiation logging never silently no-ops.
  const handlers = (
    inner as unknown as {
      _requestHandlers: Map<
        string,
        (
          request: { method: "initialize"; params: { protocolVersion: string } },
          extra: unknown,
        ) => Promise<ServerResult>
      >;
    }
  )._requestHandlers;
  const original = handlers.get(method);

  inner.setRequestHandler(InitializeRequestSchema, async (request, extra) => {
    const requested = request.params.protocolVersion;
    const negotiated = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : LATEST_PROTOCOL_VERSION;

    logger.info(
      {
        component: "server",
        transport,
        negotiated_protocol: negotiated,
        data: { client_version: requested, server_version: SERVER_VERSION },
      },
      "protocol_version_negotiated",
    );

    if (original) {
      // Delegate to the SDK's real initialize so the handshake + side effects
      // (client capabilities/version) are preserved exactly.
      return original(request, extra);
    }
    // Fallback (SDK seam moved): reproduce the standard initialize result.
    return {
      protocolVersion: negotiated,
      capabilities: (
        inner as unknown as { getCapabilities(): Record<string, unknown> }
      ).getCapabilities(),
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    };
  });
}

/**
 * Construct the MCP server, advertise capabilities, and register the example
 * surface (add tool, greeting resource, greet prompt). Transport-agnostic — the
 * caller wires a transport afterwards.
 */
export function buildServer(logger: Logger, config: Config): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: { listChanged: true },
        logging: {},
      },
    },
  );

  // Version-negotiation logging (HARD-03): wrap the initialize handler to emit
  // protocol_version_negotiated on every handshake. Transport label comes from
  // validated config (the dispatch target). Registered before the example
  // surface so the wrap is in place before any client can connect.
  instrumentVersionNegotiation(server, logger, config.MCP_TRANSPORT);

  // The example tool (SURF-01): add(a,b) with progress + cancellation.
  registerAddTool(server, logger, config);

  // The example resource (SURF-02): example://greeting → "Hello from MCP".
  registerGreetingResource(server);

  // The example prompt (SURF-03): greet(name) → "Hello, {name}!".
  registerGreetPrompt(server);

  logger.info(
    { component: "server", data: { name: SERVER_NAME, version: SERVER_VERSION } },
    "server_constructed",
  );

  return server;
}
