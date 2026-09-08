import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    bail: 1,
    sequence: { concurrent: false },
    testTimeout: 15_000,
    hookTimeout: 20_000,
  },
});
