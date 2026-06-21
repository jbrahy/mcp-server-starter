// Unit coverage for resolveUnderRoots (TS-07 / SEC-05 / HARD-07 / threat
// T-08-05 EoP). Mirrors the proven 5-case matrix from
// scripts/smoke-fs-roots.ts against the real helper.
//
// Each test builds its OWN mkdtemp fixture tree (parallel-safe: no shared path,
// no shared symlink — 08-RESEARCH §Pitfall 5) and tears it down in a finally.
// The temp base is realpath'd first so the within-root substring assertion is
// stable where tmpdir() is itself a symlink (macOS /var -> /private/var).

import { afterEach, describe, expect, it } from "vitest";
import { resolve, sep } from "node:path";
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolveUnderRoots } from "../../src/security/fs-roots.js";

interface Fixture {
  base: string;
  safeRoot: string;
  evilDir: string;
  siblingDir: string;
}

const created: string[] = [];

/** Build a fresh per-test fixture tree under a realpath'd mkdtemp base. */
async function makeFixture(): Promise<Fixture> {
  const base = await realpath(await mkdtemp(resolve(tmpdir(), "u8-fsroots-")));
  created.push(base);
  const safeRoot = resolve(base, "safe");
  const evilDir = resolve(base, "evil");
  const siblingDir = resolve(base, "safeother");
  await mkdir(safeRoot, { recursive: true });
  await mkdir(evilDir, { recursive: true });
  await mkdir(siblingDir, { recursive: true });
  await writeFile(resolve(safeRoot, "ok.txt"), "ok\n");
  await writeFile(resolve(evilDir, "secret.txt"), "secret\n");
  await writeFile(resolve(siblingDir, "secret.txt"), "secret\n");
  // Symlink UNDER the root that points OUTSIDE it.
  await symlink(evilDir, resolve(safeRoot, "escape"));
  return { base, safeRoot, evilDir, siblingDir };
}

afterEach(async () => {
  // Tear down every fixture this run created (no shared path across tests).
  while (created.length > 0) {
    const dir = created.pop() as string;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("resolveUnderRoots reject matrix (T-08-05)", () => {
  it("accepts a within-root file and returns its canonical path", async () => {
    const { safeRoot } = await makeFixture();
    const resolved = await resolveUnderRoots(resolve(safeRoot, "ok.txt"), [safeRoot]);
    expect(resolved).toContain(`${sep}safe${sep}ok.txt`);
  });

  it("rejects an outside-roots absolute path", async () => {
    const { safeRoot, evilDir } = await makeFixture();
    await expect(
      resolveUnderRoots(resolve(evilDir, "secret.txt"), [safeRoot]),
    ).rejects.toThrow();
  });

  it("rejects a symlink-escape path after realpath canonicalization", async () => {
    const { safeRoot } = await makeFixture();
    await expect(
      resolveUnderRoots(resolve(safeRoot, "escape", "secret.txt"), [safeRoot]),
    ).rejects.toThrow();
  });

  it("rejects a null-byte path before any concatenation", async () => {
    const { safeRoot } = await makeFixture();
    await expect(
      resolveUnderRoots(`${resolve(safeRoot, "ok.txt")}\0.txt`, [safeRoot]),
    ).rejects.toThrow(/null byte/);
  });

  it("rejects a sibling-prefix directory (safeother vs safe)", async () => {
    const { safeRoot, siblingDir } = await makeFixture();
    await expect(
      resolveUnderRoots(resolve(siblingDir, "secret.txt"), [safeRoot]),
    ).rejects.toThrow();
  });
});
