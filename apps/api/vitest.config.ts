import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Database-backed suites share one database, so files run one at a time.
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
