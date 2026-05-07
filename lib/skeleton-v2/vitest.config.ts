import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "client/**/*.test.ts",
      "client/**/*.test.tsx",
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
      "tests/integration/**/*.test.tsx",
    ],
    exclude: ["node_modules", "tests/e2e/**"],
    // Skeleton ships with no tests; agents add them. Don't fail the QA gate
    // on an empty repo.
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": resolve(here, "."),
      "@app": resolve(here, "app"),
      "@client": resolve(here, "client"),
      "@src": resolve(here, "src"),
    },
  },
});
