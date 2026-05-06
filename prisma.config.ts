import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env first, then .env.local so the local override wins.
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
