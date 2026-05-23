# Validator harness

## Purpose

The harness validates each template under `templates/` against `shared/compliance-matrix.yaml`. It runs in CI on every push and pull request (`.github/workflows/ci.yml`, landed in Phase 4 plan 04-06) and is safe to run locally via `npm run validate`. Today `templates/` is empty until Phase 5 ships `templates/typescript/`, so the harness logs `0 templates validated` and exits 0. The compliance matrix and example surface (Phase 3 deliverables under `shared/`) define the contract every future template is graded against.

## Usage

```bash
npm run validate            # run against templates/ (default)
npm run validate:self-test  # run against the failing-template fixture; exit 0 means the validator correctly REJECTED it
```

Exit codes:

| Code | Meaning |
|------|---------|
| `0`  | Pass — every template passed OR no templates exist OR self-test correctly rejected the fixture |
| `1`  | Fail — at least one template failed OR self-test fixture wrongly passed (validator is not biting) |
| `2`  | Unhandled exception (top-level error path) |

## Security note: subprocess environment sanitization

The harness spawns each template binary as a child process using `getDefaultEnvironment()` from `@modelcontextprotocol/sdk/client/stdio.js` — **never** `process.env`. Passing `process.env` would inherit `GITHUB_TOKEN`, repo secrets, and any other CI-injected variables into a child process the harness does not fully control; a malicious or buggy template could log or exfiltrate them.

The SDK's allowlist (POSIX) is exactly:

```
PATH, HOME, LANG, SHELL, TERM, USER, LANGUAGE, LC_ALL, TZ, TMPDIR, TMP, TEMP
```

Source: `node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js` — `DEFAULT_INHERITED_ENV_VARS` and the `getDefaultEnvironment()` helper. Using the SDK's helper both stops CI secret leakage and aligns the harness with how real MCP clients spawn servers.

## Self-test fixture

`scripts/validate-templates/fixtures/failing-template/` (created in plan 04-04) holds a synthetic CommonJS Node script that deliberately violates stdout-purity by writing a banner to stdout before any JSON-RPC traffic. The fixture exists solely as the regression test for the validator-can-fail invariant: `npm run validate:self-test` invokes the validator against this fixture and asserts the validator correctly rejects it.

**Do not add `dependencies` to the fixture's `package.json`.** The fixture must stay a single-file CommonJS script with zero non-builtin `require()` calls. Per RESEARCH §Pitfall 6: "fixture must stay invariant under toolchain change so a future tsx/SDK update cannot break the fixture orthogonally." If the fixture grows a dependency, a toolchain change could mask a regression in the validator itself.

## Cross-references

- [`shared/compliance-matrix.yaml`](../../shared/compliance-matrix.yaml) — the matrix the harness reads; the `smoke_probes` section provides the SMOKE-01 `initialize` envelope used by the stdout-purity probe.
- [`shared/docs/02-security-baseline.md`](../../shared/docs/02-security-baseline.md) — SEC-01 stdout-purity discipline (what templates are graded against).
- [`shared/docs/03-observability.md`](../../shared/docs/03-observability.md) — LOG-01 stderr-only logging (the harness self-applies the same discipline).
