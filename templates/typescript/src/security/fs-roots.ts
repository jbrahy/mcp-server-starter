// Roots-aware filesystem path resolver (TS-07 / SEC-05 / HARD-07).
//
// The load-bearing path-traversal defense. Every filesystem-backed resource or
// tool MUST route untrusted path input through resolveUnderRoots before any file
// operation. No file-backed tool ships in this template by default; this helper
// is the contract that future file-backed resources resolve against.
//
// Verbatim semantics (shared/docs/02-security-baseline.md §Filesystem roots
// enforcement §42-52):
//   1. Reject paths containing a null byte (\0) BEFORE any path concatenation.
//   2. Resolve relative input against the process working directory.
//   3. Canonicalize via the OS resolver (fs.realpath) to follow symlinks.
//   4. Assert the canonical path starts with one of the canonicalized roots.
//   5. Reject with a clear error if no root matches.
//
// Ordering is the mitigation: realpath (step 3) runs AFTER resolve and BEFORE
// the containment check (step 4). A path that lexically appears inside a root
// MAY still resolve outside it via a symlink — canonicalizing first is what
// blocks that. CVE-2025-67364
// (https://nvd.nist.gov/vuln/detail/CVE-2025-67364) and CVE-2025-53109
// (https://nvd.nist.gov/vuln/detail/CVE-2025-53109) are both 2025 MCP-server
// filesystem-escape vulnerabilities caused by path checks that ran BEFORE
// symlink resolution rather than after. The canonical-realpath-then-prefix
// check blocks both.
//
// Separator-aware containment: the prefix check compares against
// `canonicalRoot + path.sep` (plus the exact-equal case), so a sibling-prefix
// directory like /a/safeother does NOT match the root /a/safe. A naive
// startsWith(canonicalRoot) would wrongly admit it — this is the single most
// common bug in roots checks.
//
// TOCTOU residual: there is an unavoidable time-of-check/time-of-use gap
// between realpath here and any subsequent file operation by the caller; a
// symlink could be swapped in that window. This helper returns the canonical
// path so callers operate on the resolved path (narrowing the window), but it
// does NOT close it. Full elimination (O_NOFOLLOW / openat-relative resolution)
// is out of scope for this template. realpath on a non-existent path throws
// ENOENT, which surfaces as a rejection — acceptable for the existing-path
// helper this is.

import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

/**
 * Resolve an untrusted path under a set of allowed roots.
 *
 * @param input  Untrusted path string.
 * @param roots  Allowed root directories. The resolved path must canonically
 *               live at or under one of these.
 * @returns      The canonical absolute path (symlinks resolved) on success.
 * @throws       If the input contains a null byte, or the canonical path
 *               resolves outside every configured root, or the path does not
 *               exist (realpath ENOENT).
 */
export async function resolveUnderRoots(
  input: string,
  roots: string[],
): Promise<string> {
  // 1. Reject null byte BEFORE any path concatenation.
  if (input.includes("\0")) {
    throw new Error("path rejected: null byte");
  }
  // 2. Resolve relative input against the process working directory.
  const abs = resolve(input);
  // 3. Canonicalize via OS realpath (follows symlinks). MUST run after step 2
  //    and BEFORE the containment check — this ordering is the
  //    CVE-2025-67364 / CVE-2025-53109 mitigation.
  const canonical = await realpath(abs);
  // 4. Canonicalize each root, then assert containment with a separator-aware
  //    prefix check (the /a/safe vs /a/safeother trap).
  for (const root of roots) {
    const canonicalRoot = await realpath(resolve(root));
    const boundary = canonicalRoot.endsWith(sep)
      ? canonicalRoot
      : canonicalRoot + sep;
    if (canonical === canonicalRoot || canonical.startsWith(boundary)) {
      return canonical;
    }
  }
  // 5. Reject with a clear message.
  throw new Error("path rejected: resolves outside configured roots");
}
