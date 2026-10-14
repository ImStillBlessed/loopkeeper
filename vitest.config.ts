import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, whose root is the web/ dashboard.
export default defineConfig({
  test: {
    root: ".",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
