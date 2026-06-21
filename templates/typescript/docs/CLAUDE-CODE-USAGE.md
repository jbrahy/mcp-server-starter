# Using this template with Claude Code

A start-to-finish walkthrough: install the template, register it with Claude
Code, invoke a tool, and read the logs. Follow it in order — no prior knowledge
of this codebase is assumed.

## 1. Install

Clone the repository and build the template. The build produces
`dist/index.js`, which is the file Claude Code registers and runs.

```bash
git clone <this-repo-url>
cd <repo>/templates/typescript
npm install
npm run build      # produces dist/index.js
```

Requires Node `^22.7.5`.

## 2. Register with Claude Code

Claude Code runs the server as a local `stdio` subprocess, so registration
points at the built `dist/index.js` and passes `--transport=stdio`. There are
two equivalent ways to register.

### Option A — the `claude mcp add` CLI

```bash
claude mcp add --transport stdio mcp-server-ts -- node /ABS/PATH/templates/typescript/dist/index.js --transport=stdio
```

- The `--` separator divides Claude Code's own flags (`--transport`, `--scope`,
  `--env`) from the server command and the args passed through to it. Everything
  after `--` runs untouched, so the trailing `--transport=stdio` reaches the
  server.
- `--scope` selects where the registration is stored: `local` (the default —
  per-project, in your user config), `project` (shared via a `.mcp.json` file
  committed to the repo), or `user` (all your projects).
- Replace `/ABS/PATH/...` with the absolute path to your checkout's
  `dist/index.js`.

### Option B — a project-scoped `.mcp.json`

Copy [`examples/claude-code-config.json`](../examples/claude-code-config.json)
to a `.mcp.json` at your project root and replace the placeholder absolute path
with your checkout's `dist/index.js`:

```json
{
  "mcpServers": {
    "mcp-server-ts": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/templates/typescript/dist/index.js", "--transport=stdio"],
      "env": {}
    }
  }
}
```

A project-scoped `.mcp.json` is committable and shared with your team.

### Where config lives

- **Project scope** → a `.mcp.json` file in the project root. Author and commit
  this one yourself.
- **Local / user scope** → `~/.claude.json`, managed by `claude mcp add`. Do not
  hand-edit it; use the CLI.

These are the current locations — config does **not** live at
`~/.claude/config.json` (an older, stale path). See the Claude Code MCP docs at
<https://code.claude.com/docs/en/mcp> for the authoritative reference.

## 3. Invoke a tool

Once registered, ask Claude to use the server's example surfaces:

- **Tool** — ask Claude to call the `add` tool with `a=2` and `b=3`. The
  rendered result is `5`. (The tool deliberately runs a ~5s loop to demonstrate
  progress notifications and cancellation.)
- **Resource** — the `example://greeting` resource returns `Hello from MCP`.
- **Prompt** — the `greet` prompt with `name=World` renders `Hello, World!`.

If `add(2, 3)` returns `5`, the server is registered and working.

## 4. Read the logs

The server emits structured JSON **to stderr** — never to stdout in `stdio`
mode, where stdout is reserved for JSON-RPC. To see the logs, read the
subprocess's stderr stream, or set `MCP_LOG_FILE` to also write them to a file:

```bash
node /ABS/PATH/templates/typescript/dist/index.js --transport=stdio 2>server.log
# or have the server tee logs to a file:
MCP_LOG_FILE=server.log node /ABS/PATH/.../dist/index.js --transport=stdio
```

Each line is one JSON object (`ts`, `level`, `msg`, `component`, `data`).
Adjust verbosity with `MCP_LOG_LEVEL` (`trace` … `fatal`, default `info`).

## 5. Before production

Read this before any deployment or publishing step. This template ships with two
**DEV-ONLY seams that must be replaced before you expose the server**. Both are
intentionally loud — they log a WARN on every request/hit so the omission is
never silent. See
[`shared/docs/02-security-baseline.md`](../../../shared/docs/02-security-baseline.md)
for the full contract.

1. **Authentication hook** — `src/http/auth.ts` (SEC-04). The DEV-ONLY default
   WARNs `auth_hook_dev_only_in_use` on every request and then calls `next()` —
   it does **not** reject anything. This is the #1 production gate. Replace the
   middleware body with real credential validation before exposing the `/mcp`
   data path.
2. **OAuth Protected Resource Metadata stub** — `src/http/oauth-prm.ts`
   (SEC-15). The `GET /.well-known/oauth-protected-resource` route serves a stub
   flagged `_DEV_STUB: true` and WARNs `oauth_prm_dev_stub_in_use` on every hit.
   Replace the placeholder `resource` and `authorization_servers` values with
   your real metadata and remove the `_DEV_STUB` / `_DEV_WARNING` markers before
   production.

Only after both seams are replaced should you proceed to deploy or publish the
server.
