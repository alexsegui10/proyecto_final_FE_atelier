import { describe, it, expect } from "vitest";

import {
  validateBootstrapOutput,
  validateEnvManifest,
  type BootstrapOutput,
  type EnvManifest,
} from "./bootstrap.schema";

// ─── Fixture builders ───────────────────────────────────────────────

function envVar(over: Partial<EnvManifest["variables"][number]> = {}): EnvManifest["variables"][number] {
  return {
    name: "DATABASE_URL",
    required: true,
    description: "Postgres connection string used by Prisma at runtime",
    category: "database",
    sensitive: true,
    example: "postgresql://user:pass@localhost:5433/app",
    consumedBy: ["persistence"],
    producedBy: "src/_shared/config/env.ts",
    ...over,
  };
}

function manifest(over: Partial<EnvManifest> = {}): EnvManifest {
  return {
    validatorPath: "src/_shared/config/env.ts",
    variables: [envVar()],
    ...over,
  };
}

function fullArtifact(over: Partial<BootstrapOutput> = {}): BootstrapOutput {
  return {
    envManifest: manifest(),
    dockerServices: [
      {
        name: "postgres",
        image: "postgres:16-alpine",
        ports: ["${POSTGRES_HOST_PORT:-5433}:5432"],
        envVars: ["DATABASE_URL"],
        healthcheck: "pg_isready -U $POSTGRES_USER",
      },
    ],
    setupSteps: [
      { order: 1, description: "Start Postgres", command: "docker compose up -d postgres", required: true, os: "all" },
      { order: 2, description: "Apply migrations", command: "pnpm prisma migrate dev", required: true, os: "all" },
      { order: 3, description: "Seed data", command: "pnpm prisma:seed", required: false, os: "all" },
    ],
    checkEnvironmentRules: [
      {
        id: "postgres-reachable",
        description: "Postgres responds to TCP probe on DATABASE_URL host:port",
        detect: "Open TCP connection to host extracted from DATABASE_URL",
        whenFails: "Postgres is unreachable. Docker may be down or the port is blocked.",
        fixSuggestion: "Run `docker compose up -d postgres` OR set NEON_DATABASE_URL to use Neon serverless.",
      },
    ],
    filesProduced: {
      envExample: ".env.example",
      envLocal: ".env.local",
      dockerCompose: "docker-compose.yml",
      setupPs1: "scripts/setup.ps1",
      setupSh: "scripts/setup.sh",
      readme: "README.md",
      checkEnvironment: "src/_shared/config/check-environment.ts",
      envValidator: "src/_shared/config/env.ts",
    },
    invariants: {
      singleSourceOfTruth: true,
      crossPlatformScripts: true,
      healthcheckPresent: true,
    },
    ...over,
  };
}

// ─── envManifest tests ──────────────────────────────────────────────

describe("envManifestSchema", () => {
  it("accepts a minimal valid manifest", () => {
    expect(validateEnvManifest(manifest())).toBeNull();
  });

  it("rejects env var name not in SCREAMING_SNAKE_CASE", () => {
    const m = manifest({ variables: [envVar({ name: "databaseUrl" })] });
    expect(validateEnvManifest(m)).toMatch(/SCREAMING_SNAKE_CASE/);
  });

  it("rejects env var with empty consumedBy", () => {
    const m = manifest({ variables: [envVar({ consumedBy: [] as unknown as ["persistence"] })] });
    expect(validateEnvManifest(m)).toMatch(/at least one consuming agent/);
  });

  it("rejects sensitive var with defaultValue (security invariant)", () => {
    const m = manifest({
      variables: [envVar({ sensitive: true, defaultValue: "supersecret" })],
    });
    expect(validateEnvManifest(m)).toMatch(/sensitive vars must NOT have a defaultValue/);
  });

  it("accepts sensitive var without defaultValue", () => {
    const m = manifest({ variables: [envVar({ sensitive: true, defaultValue: undefined })] });
    expect(validateEnvManifest(m)).toBeNull();
  });

  it("rejects manifest where any producedBy disagrees with validatorPath", () => {
    const m = manifest({
      validatorPath: "src/_shared/config/env.ts",
      variables: [envVar({ producedBy: "src/elsewhere/other-env.ts" })],
    });
    expect(validateEnvManifest(m)).toMatch(/single source of truth/);
  });

  it("rejects duplicate env var names", () => {
    const m = manifest({
      variables: [envVar({ name: "PORT" }), envVar({ name: "PORT" })],
    });
    expect(validateEnvManifest(m)).toMatch(/duplicate env var name/);
  });

  it("rejects validatorPath outside src/", () => {
    const m = manifest({ validatorPath: "lib/config/env.ts" });
    expect(validateEnvManifest(m)).toMatch(/validatorPath/);
  });

  it("rejects consumedBy with unknown agent name", () => {
    const m = manifest({
      variables: [envVar({ consumedBy: ["not-a-real-agent" as unknown as "persistence"] })],
    });
    expect(validateEnvManifest(m)).toMatch(/consumedBy/);
  });
});

// ─── bootstrapOutput tests ──────────────────────────────────────────

describe("bootstrapOutputSchema", () => {
  it("accepts a full valid artifact", () => {
    expect(validateBootstrapOutput(fullArtifact())).toBeNull();
  });

  it("rejects when setupSteps has fewer than 3 entries", () => {
    const art = fullArtifact({
      setupSteps: [{ order: 1, description: "only step", command: "echo hi", required: true, os: "all" }],
    });
    expect(validateBootstrapOutput(art)).toMatch(/at least 3 setup steps/);
  });

  it("rejects when checkEnvironmentRules is empty", () => {
    const art = fullArtifact({ checkEnvironmentRules: [] });
    expect(validateBootstrapOutput(art)).toMatch(/at least one check-environment rule/);
  });

  it("rejects when invariants.singleSourceOfTruth lies about file paths", () => {
    const art = fullArtifact({
      filesProduced: {
        envExample: ".env.example",
        envLocal: ".env.local",
        dockerCompose: "docker-compose.yml",
        setupPs1: "scripts/setup.ps1",
        setupSh: "scripts/setup.sh",
        readme: "README.md",
        checkEnvironment: "src/_shared/config/check-environment.ts",
        envValidator: "src/_shared/config/env-NEW.ts", // disagrees with manifest.validatorPath
      },
      invariants: {
        singleSourceOfTruth: true, // claim is wrong → schema rejects
        crossPlatformScripts: true,
        healthcheckPresent: true,
      },
    });
    expect(validateBootstrapOutput(art)).toMatch(/singleSourceOfTruth/);
  });

  it("rejects when a docker service references an unknown env var", () => {
    const art = fullArtifact({
      dockerServices: [
        {
          name: "redis",
          image: "redis:7-alpine",
          ports: ["6379:6379"],
          envVars: ["REDIS_URL"], // not declared in manifest
        },
      ],
    });
    expect(validateBootstrapOutput(art)).toMatch(
      /reference env vars that aren't declared in the manifest/,
    );
  });

  it("accepts an artifact with multiple categories of env vars", () => {
    const art = fullArtifact({
      envManifest: manifest({
        variables: [
          envVar(),
          envVar({
            name: "AUTH_JWT_SECRET",
            category: "auth",
            description: "HMAC secret used to sign access tokens",
            sensitive: true,
            example: "change-me-32-bytes-base64",
            defaultValue: undefined,
            consumedBy: ["auth-security", "api-backend"],
          }),
          envVar({
            name: "PORT",
            category: "runtime",
            description: "Port the Next.js dev server listens on",
            sensitive: false,
            defaultValue: "3000",
            consumedBy: ["bootstrap-devops"],
          }),
        ],
      }),
    });
    expect(validateBootstrapOutput(art)).toBeNull();
  });

  it("rejects setup step with order = 0", () => {
    const art = fullArtifact({
      setupSteps: [
        { order: 0, description: "broken", command: "noop", required: true, os: "all" },
        { order: 1, description: "ok", command: "noop", required: true, os: "all" },
        { order: 2, description: "ok", command: "noop", required: true, os: "all" },
      ],
    });
    expect(validateBootstrapOutput(art)).toMatch(/order/);
  });

  it("rejects docker service name that isn't lowercase", () => {
    const art = fullArtifact({
      dockerServices: [
        { name: "Postgres", image: "postgres:16-alpine", ports: ["5432:5432"], envVars: [] },
      ],
    });
    expect(validateBootstrapOutput(art)).toMatch(/service name/);
  });
});
