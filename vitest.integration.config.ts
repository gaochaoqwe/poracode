import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Standalone config for live-CLI integration tests. The repository carries its
// integration assets next to the code under `src/**/*.integration.test.ts`
// (self-contained fake-agent fixtures, plus the SSH manager); the original
// `tests/integration/` directory never materialized, so the include covers both
// so the command discovers the real assets. Kept out of the default
// `vitest run` glob's fast/hermetic guarantees only by the node project
// include — invoke explicitly via `pnpm test:integration:providers`.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    name: "integration",
    environment: "node",
    include: ["tests/integration/**/*.test.ts", "src/**/*.integration.test.ts"],
    // Each provider spins up a real CLI process, waits for session
    // discovery, then resumes. Five minutes per test gives slower providers
    // (Antigravity, OpenCode) headroom on a cold machine.
    testTimeout: 300_000,
    hookTimeout: 60_000,
    // Run sequentially — concurrent real CLIs would compete for terminal
    // resources, auth tokens, and (most importantly) provider rate limits.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
