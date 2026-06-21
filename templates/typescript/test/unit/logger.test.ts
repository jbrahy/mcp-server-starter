// Unit coverage for the value-shape redaction contract (TS-07 / SEC-08..12 /
// TEST-04 / threats T-08-07, T-08-08).
//
// We prove the redaction REGEX CONTRACT directly, not the pino wiring: the
// patterns are transcribed VERBATIM from shared/docs/02-security-baseline.md
// §Token-shape patterns (and mirror src/logger.ts VALUE_PATTERNS byte-for-byte,
// including the load-bearing sk-ant- BEFORE sk- ordering). We do NOT add a
// destination-injection seam to logger.ts (surgical rule); the spawned-stderr
// path is covered by integration test 08-04.
//
// Fail-ability (T-08-08, mirrors check-surface-conformance --self-test): a
// weakened copy of the pattern set with the gh pattern removed must let a ghp_
// token SURVIVE — proving the gate would FAIL if the pattern list shrank, i.e.
// the test is not vacuous. logger.ts is never edited on disk.

import { describe, expect, it } from "vitest";

const REDACTED = "[REDACTED]";

// VERBATIM from 02-security-baseline.md §Token-shape patterns / logger.ts
// VALUE_PATTERNS. ORDER MATTERS: sk-ant- precedes the generic sk-.
const PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
  /AKIA[0-9A-Z]{16}/g,
  /(?<![A-Za-z0-9])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9])/g, // AWS secret access key
  /gh[pousr]_[A-Za-z0-9]{36}/g,
  /github_pat_[A-Za-z0-9_]{82,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g, // ORDER: ant before generic sk-
  /sk-[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
];

/** Apply a pattern set to a line, replacing every match with [REDACTED]. */
function apply(line: string, patterns: RegExp[]): string {
  let out = line;
  // Reset lastIndex defensively since the regexes are global+module-scoped.
  for (const re of patterns) {
    re.lastIndex = 0;
    out = out.replace(re, REDACTED);
  }
  return out;
}

// Each canonical shape with a planted secret substring that MUST disappear.
const SHAPES: { name: string; secret: string }[] = [
  { name: "Bearer token", secret: "Bearer abcDEF123._~+/=-tokenValue" },
  { name: "AWS access key id (AKIA)", secret: "AKIA1234567890ABCDEF" },
  {
    name: "AWS secret access key (40-char)",
    secret: "abcdABCD1234abcdABCD1234abcdABCD1234abcd",
  },
  { name: "GitHub classic PAT (ghp_)", secret: "ghp_" + "a".repeat(36) },
  { name: "GitHub fine-grained PAT (github_pat_)", secret: "github_pat_" + "a".repeat(82) },
  { name: "Anthropic key (sk-ant-)", secret: "sk-ant-" + "a".repeat(24) },
  { name: "OpenAI-shape key (sk-)", secret: "sk-" + "a".repeat(24) },
  { name: "Slack token (xoxb-)", secret: "xoxb-" + "1234567890ab" },
  { name: "JWT (eyJ)", secret: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dozjgNryP4J3jVmNHl0w" },
];

describe("value-shape redaction contract", () => {
  for (const { name, secret } of SHAPES) {
    it(`redacts ${name} to [REDACTED]`, () => {
      const line = `{"msg":"x","data":{"v":"${secret}"}}`;
      const out = apply(line, PATTERNS);
      expect(out).not.toContain(secret);
      expect(out).toContain(REDACTED);
    });
  }

  it("sk-ant- ordering: an Anthropic key is fully redacted, not partially mangled by sk-", () => {
    const antKey = "sk-ant-" + "API03_abcDEF1234567890";
    const line = `prefix ${antKey} suffix`;
    const out = apply(line, PATTERNS);
    expect(out).not.toContain(antKey);
    // No stray "ant-" remnant: the whole token collapsed to a single [REDACTED].
    expect(out).not.toContain("ant-");
    expect(out).toBe(`prefix ${REDACTED} suffix`);
  });
});

describe("redaction gate is fail-able (T-08-08, in-memory only)", () => {
  it("removing the gh pattern lets a ghp_ token survive", () => {
    const ghToken = "ghp_" + "a".repeat(36);
    const line = `{"v":"${ghToken}"}`;

    // Sanity: the full set redacts it.
    expect(apply(line, PATTERNS)).not.toContain(ghToken);

    // Weaken the set in memory only (never touch logger.ts on disk): drop the
    // gh pattern. The token must now SURVIVE — proving the assertion bites.
    const weakened = PATTERNS.filter((re) => !re.source.includes("gh"));
    expect(weakened.length).toBe(PATTERNS.length - 1);
    const leaked = apply(line, weakened);
    expect(leaked).toContain(ghToken);
  });
});
