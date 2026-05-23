# Contributing to the MCP Server Template Suite

Thank you for your interest in contributing. This document covers how the
project is structured, what makes a change shippable, and the conventions
contributors are expected to follow.

## What this project is

A reusable, production-shaped MCP server template suite. Each language
template (TypeScript, Python, Go, C#, optional Rust) implements the same
contract: MCP protocol version `2025-11-25`, `stdio` + Streamable HTTP
transports, structured logging on stderr, secret redaction, Origin
validation on HTTP, an `add(a, b)` example tool with progress and
cancellation, one example resource, one example prompt, a multi-stage
Dockerfile, tests, and Claude Code usage docs.

Templates are shipped one language at a time, in milestones. Milestone 1
covers the shared foundation and the TypeScript canonical template. Other
languages port from the TypeScript template, not from the PRD directly.

## Source of truth

**The TypeScript template is canonical.** When a contract dimension is
ambiguous, the TypeScript template's observable behavior is the
specification, and other language ports conform to it.

This is not preference — it is sequencing. The TypeScript template ships
first, lands every shared decision (Origin allowlist semantics, log
schema, error envelopes, cancellation final-response contract, OAuth
PRM stub shape, auth hook signature, FS roots resolver), and proves them
against the compliance matrix and validator harness. Later language ports
inherit those decisions rather than re-deriving them.

## The compliance-matrix gate

Every template MUST pass the compliance matrix defined in
`shared/compliance-matrix.yaml` (added in the shared-foundation milestone)
and conform byte-for-byte to `shared/example-surface.yaml`. The validator
harness at `scripts/validate-templates/` enforces this in CI.

Concretely, before a template change can merge:

1. The template's smoke probes (initialize handshake, version negotiation,
   `tools/list`, `tools/call` with progress and cancellation,
   `resources/list`, `resources/read`, `prompts/list`, `prompts/get`)
   pass against the matrix.
2. The stdout-purity probe passes: in `stdio` mode, stdout contains only
   valid JSON-RPC envelopes.
3. The secret-redaction test passes: planted API-key-shaped strings,
   bearer tokens, and known credential patterns do not appear in
   logger output.
4. Unit tests cover tools, resources, prompts, config validation, logger
   redaction, the FS roots helper, and the transports.

A change that breaks any of the above fails CI and is not mergeable.

## How to add a new template

New language templates land one per milestone after the TypeScript
canonical template is stable.

1. Open an issue describing the language target and the milestone the
   template will ship in. Confirm the milestone has space.
2. Create `templates/<language>/` with the same directory shape as
   `templates/typescript/`.
3. Implement every dimension of `shared/compliance-matrix.yaml`. The
   YAML is normative; the Markdown view (`shared/compliance-matrix.md`)
   is generated from it for review-diff visibility.
4. Match `shared/example-surface.yaml` exactly — tool name `add`,
   parameters `a` and `b`, the same intentionally-slow loop with
   progress and cancellation, the same example resource URI, the same
   example prompt name and parameter.
5. Wire the template into the validator harness; ensure
   `npx tsx scripts/validate-templates/index.ts` passes locally.
6. Add a per-template `README.md`, a `Dockerfile`, a Claude Code
   configuration example, and a Claude Code usage document.
7. Update `CODEOWNERS` to add an owner for `templates/<language>/**`.

## Commit and pull request conventions

- **Conventional Commits** for commit messages:
  - `feat(scope): subject` — user-visible behavior change.
  - `fix(scope): subject` — bug fix.
  - `docs(scope): subject` — documentation only.
  - `chore(scope): subject` — repo hygiene, build, tooling.
  - `refactor(scope): subject` — code change with no behavior change.
  - `test(scope): subject` — tests only.
  - `ci(scope): subject` — CI changes only.
  - Scopes mirror directories: `ts`, `shared`, `matrix`, `validator`,
    `ci`, `repo`.
- Keep commit messages descriptive and human-authored. Do not include
  generated attributions or co-author trailers added by tooling.
- One logical change per commit. If a PR touches both `shared/` and
  `templates/typescript/`, split the commits even if the PR is one.
- Pull requests must reference the matrix dimension or requirement ID
  they implement (e.g., "implements HARD-04 correlation IDs") so the
  traceability table can be updated.
- Pull request descriptions should explain the *why* and call out any
  matrix dimension touched, any security baseline impact, and the
  verification commands run locally.

## Code style

- TypeScript code uses ESLint with a rule banning `console.*` in
  `templates/typescript/src/**`. Logger output goes through the
  structured logger only.
- Markdown lines wrap at 80 columns where natural; tables and code
  fences are exempt.
- Shell scripts target `bash` with `set -euo pipefail`.
- Avoid heavy frameworks; the design philosophy is minimal but
  production-shaped. New dependencies require justification in the PR
  description.

## Reporting bugs and security issues

- Functional bugs: open an issue with reproduction steps and the MCP
  transport mode.
- Security issues: do **not** open a public issue. Use the GitHub
  Private Vulnerability Reporting workflow described in `SECURITY.md`.

## License

By contributing, you agree that your contributions will be licensed
under the project's MIT License (`LICENSE`).
