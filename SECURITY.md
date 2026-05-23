# Security Policy

## Supported versions

The MCP Server Template Suite is pre-release. Until the first tagged version
ships, the `main` branch is the only supported tree. Security fixes are
applied to `main` and noted in `CHANGELOG.md` under the `Security` heading.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately via GitHub's private vulnerability advisory workflow:

  https://github.com/jbrahy/mcp-server-starter/security/advisories/new

You should receive an acknowledgement within **3 business days**. If you do
not, please re-submit the advisory — it may have been missed.

When reporting, please include:

- A description of the issue and which templates / shared components it
  affects (TypeScript template, shared docs, compliance matrix, validator
  harness, CI workflow, governance file).
- Steps to reproduce, including the MCP transport (`stdio` or `http`) and
  any relevant environment variables.
- The impact you believe the issue has (information disclosure, command
  execution, denial of service, protocol corruption, etc.).
- Suggested mitigations, if any.

## Disclosure window

We follow a **90-day coordinated disclosure** policy:

- Day 0: Report received and acknowledged.
- Day 0–14: Triage and reproduction.
- Day 14–75: Fix developed, reviewed, and prepared for release.
- Day 75–90: Coordinated release of the fix and advisory.
- Day 90: Public disclosure, including credit to the reporter unless they
  request otherwise.

If a fix is not feasible within 90 days, we will contact the reporter to
agree on an extended timeline before public disclosure.

## Security baseline

Every template in this suite is held to a shared security baseline:

- `stdio` transport: stdout carries only MCP JSON-RPC messages; logs go to
  stderr.
- HTTP transport: binds `127.0.0.1` by default, validates the `Origin`
  header against an explicit allowlist, ships a DEV-ONLY auth hook seam
  documented as MUST-REPLACE before production use, and exposes a stub
  OAuth Protected Resource Metadata endpoint clearly marked as a stub.
- Filesystem access is constrained to allowed roots with canonical-path
  validation post-symlink-resolution.
- Shell execution is disabled by default.
- Outbound network access ships allowlist-ready (deny by default).
- Secrets are redacted from log output before emission.

The full baseline lives in `shared/docs/02-security-baseline.md` (added in
the shared-foundation milestone).

## Scope

In scope for security reports:

- Any template under `templates/`.
- Shared documents under `shared/docs/`.
- The compliance matrix (`shared/compliance-matrix.yaml`,
  `shared/example-surface.yaml`).
- The validator harness under `scripts/validate-templates/`.
- CI workflow at `.github/workflows/ci.yml`.
- Container images produced from per-template `Dockerfile`s.

Out of scope:

- Vulnerabilities in upstream dependencies whose impact is not made worse
  by template defaults. Please report those to the upstream maintainers.
- Issues that require an attacker with pre-existing local code execution
  on the host running the template.

Thank you for helping keep the suite safe.
