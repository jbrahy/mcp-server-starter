// fs-roots reject-matrix smoke — proves the path-traversal contract
// (HARD-07 / SEC-05 / SC#7) empirically against the real resolveUnderRoots
// helper from src/security/fs-roots.ts.
//
// Per shared/docs/02-security-baseline.md §Filesystem roots enforcement, the
// helper MUST: accept a path inside a configured root (returning its canonical
// form); reject a null-byte path before any concat; reject a symlink under a
// root that points outside it (after realpath); reject a path outside every
// root; and reject a sibling-prefix directory (/a/safeother when the root is
// /a/safe) via the separator-aware check.
//
// This script builds a fixture tree under an OS temp dir:
//   <tmp>/safe/ok.txt          — a real file inside the root
//   <tmp>/evil/secret.txt      — a real file OUTSIDE the root
//   <tmp>/safe/escape -> evil  — a symlink under the root pointing outside it
//   <tmp>/safeother/secret.txt — a sibling-prefix dir (shares the "safe" prefix)
// asserts the matrix, prints one PASS/FAIL line per case, hard-cleans the tree,
// and exits 1 on any failure / 0 on all-pass. The is-main guard keeps importing
// this module from firing the CLI.

import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolveUnderRoots } from "../src/security/fs-roots.js";

function fail(message: string): never {
  process.stdout.write(`FAIL: ${message}\n`);
  process.exit(1);
}

/** Assert resolveUnderRoots accepts and returns a canonical path containing `expectSubstr`. */
async function expectAccept(
  label: string,
  input: string,
  roots: string[],
  expectSubstr: string,
): Promise<void> {
  let resolved: string;
  try {
    resolved = await resolveUnderRoots(input, roots);
  } catch (err) {
    fail(
      `${label}: expected acceptance but it threw (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (!resolved.includes(expectSubstr)) {
    fail(
      `${label}: accepted but canonical "${resolved}" does not contain "${expectSubstr}"`,
    );
  }
  process.stdout.write(`PASS: ${label} -> ${resolved}\n`);
}

/** Assert resolveUnderRoots rejects (throws) for `input` under `roots`. */
async function expectReject(
  label: string,
  input: string,
  roots: string[],
): Promise<void> {
  try {
    const resolved = await resolveUnderRoots(input, roots);
    fail(`${label}: expected rejection but it accepted -> ${resolved}`);
  } catch {
    process.stdout.write(`PASS: ${label} (rejected)\n`);
  }
}

async function main(): Promise<void> {
  // realpath the tmp base so the expected-substring checks are stable on
  // platforms where tmpdir() itself is a symlink (e.g. macOS /var -> /private/var).
  const base = await realpath(await mkdtemp(resolve(tmpdir(), "p7-fsroots-")));
  const safeRoot = resolve(base, "safe");
  const evilDir = resolve(base, "evil");
  const siblingDir = resolve(base, "safeother");

  try {
    await mkdir(safeRoot, { recursive: true });
    await mkdir(evilDir, { recursive: true });
    await mkdir(siblingDir, { recursive: true });
    await writeFile(resolve(safeRoot, "ok.txt"), "ok\n");
    await writeFile(resolve(evilDir, "secret.txt"), "secret\n");
    await writeFile(resolve(siblingDir, "secret.txt"), "secret\n");
    // Symlink under the root that points outside it.
    await symlink(evilDir, resolve(safeRoot, "escape"));

    // (a) within-root file -> accepted, canonical form returned.
    await expectAccept(
      "within-root file accepted",
      resolve(safeRoot, "ok.txt"),
      [safeRoot],
      `${sep}safe${sep}ok.txt`,
    );

    // (b) outside-roots absolute path -> rejected.
    await expectReject(
      "outside-roots path rejected",
      resolve(evilDir, "secret.txt"),
      [safeRoot],
    );

    // (c) symlink under the root pointing outside -> rejected after realpath.
    await expectReject(
      "symlink-escape rejected (after realpath)",
      resolve(safeRoot, "escape", "secret.txt"),
      [safeRoot],
    );

    // (d) null-byte path -> rejected before any concat.
    await expectReject(
      "null-byte path rejected",
      `${resolve(safeRoot, "ok.txt")}\0.txt`,
      [safeRoot],
    );

    // (e) sibling-prefix dir (safeother) -> rejected by separator-aware check.
    await expectReject(
      "sibling-prefix (safeother) rejected",
      resolve(siblingDir, "secret.txt"),
      [safeRoot],
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }

  process.stdout.write(
    "PASS: fs-roots reject matrix — within-root OK; outside / symlink-escape / null-byte / sibling-prefix all rejected\n",
  );
  process.exit(0);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err: unknown) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}
