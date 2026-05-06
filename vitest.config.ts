import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "app/**/*.test.ts",
      "components/**/*.test.ts",
      "components/**/*.test.tsx",
    ],
  },
  resolve: {
    alias: {
      "@": resolve(here, "."),
    },
  },
});
