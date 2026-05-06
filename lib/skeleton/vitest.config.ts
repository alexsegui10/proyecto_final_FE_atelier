import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
    ],
    exclude: ["node_modules", "tests/e2e/**"],
    // Skeleton ships with no tests; agents add them. Don't fail the QA gate
    // on an empty repo.
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": resolve(here, "."),
    },
  },
});
