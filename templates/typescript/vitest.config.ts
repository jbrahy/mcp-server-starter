import { defineConfig } from "vitest/config";

// Vitest reads the template's NodeNext/ESM tsconfig directly (esbuild transform):
// `.js` import specifiers resolve to their `.ts` source with no separate config.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Env isolation: unit tests must NOT inherit the parent shell's real secrets.
    // Provide ONLY explicit test vars to the test process. Spawned children get
    // their env set explicitly at spawn time (test/helpers/env.ts) — never rely
    // on test.env to scrub a child's environment.
    env: {
      MCP_CANCEL_GRACE_MS: "5000",
      MCP_SHUTDOWN_GRACE_MS: "30000",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      reportsDirectory: "coverage",
      include: ["src/**"],
      exclude: [
        // src/http/auth.ts is an intentionally-minimal DEV-ONLY seam: it is not
        // a shipped production auth implementation, so it is excluded from the
        // coverage budget on purpose.
        "src/http/auth.ts",
      ],
      thresholds: { lines: 80 },
    },
  },
});
