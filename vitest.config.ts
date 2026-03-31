import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ["packages/*/src/**/*.test.{ts,mts}", "packages/*/src/**/*.test.{js,mjs}"],
  },
});
