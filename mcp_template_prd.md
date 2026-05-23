# MCP Server Template Suite PRD

Build a reusable, production-oriented MCP server template suite for future MCP server projects.

Target MCP protocol version: 2025-11-25.

Primary deliverables:
- TypeScript / Node.js canonical template
- Python / FastMCP template
- Go template
- C# / .NET template
- Optional Rust template
- Shared documentation
- Shared security baseline
- Shared MCP compliance matrix
- Claude Code configuration examples
- MCP Inspector smoke-test instructions
- Cross-template validation scripts

Core features every template should support:
- MCP tools
- MCP resources
- MCP prompts
- stdio transport
- Streamable HTTP transport at /mcp
- config/env validation
- structured logging
- progress notifications
- cancellation
- roots-aware filesystem safety
- optional elicitation scaffolding
- optional task scaffolding
- Dockerfile
- unit tests
- protocol smoke tests
- examples for Claude Code

Security requirements:
- stdout must contain only MCP JSON-RPC messages in stdio mode
- logs must go to stderr or files in stdio mode
- validate all tool inputs
- reject unexpected input fields by default
- redact secrets in logs
- do not log API keys, tokens, PII, or credentials
- HTTP mode must include Origin validation
- HTTP mode must bind to 127.0.0.1 by default for local development
- HTTP mode must include auth middleware hooks
- filesystem access must be root/allowlist constrained
- shell execution disabled by default
- network access must be allowlist-ready

Build strategy:
- Do not build all languages in one phase.
- Phase 1: repo, docs, compliance matrix, CI, generator skeleton.
- Phase 2: TypeScript canonical template.
- Phase 3: Python template.
- Phase 4: Go template.
- Phase 5: C# template.
- Phase 6: Rust template only after the first four are stable.
- Phase 7: cross-template consistency review and smoke tests.

Acceptance criteria:
- Each template can start over stdio.
- Each template can start over Streamable HTTP.
- Each template exposes one example tool, one example resource, and one example prompt.
- Each template has tests.
- Each template documents Claude Code usage.
- Generated code is minimal but production-shaped.
