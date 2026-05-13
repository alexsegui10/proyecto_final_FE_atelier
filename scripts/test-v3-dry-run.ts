/**
 * Atelier v3 — orchestrator dry-run.
 *
 * Validates that orchestrator-v3 recognises all 23 agents and walks through
 * the 10-slice wave graph end-to-end without invoking LLMs. Used as the
 * "v3 pipeline reconocido" gate before any real-LLM v3 run.
 *
 * What's tested:
 *   1. Every wave runs (10 wave.completed events).
 *   2. Every agent runs exactly once (23 agent.completed events).
 *   3. Bootstrap & DevOps fixture artifact passes `validateBootstrapOutput`.
 *   4. qa-reviewer "go" decision lets generation.completed fire.
 *
 * What's NOT tested here (out of scope — comes later in step 1/2):
 *   - Real LLM behaviour for any agent (no `claude` subprocess).
 *   - Schemas of the 5 unfinished v3 agents (layout-architect, brand-identity,
 *     animation-choreographer, accessibility, visual-qa). They're stubbed
 *     with a trivial fixture so the orchestrator can complete the walk.
 *   - File-system side effects (the fake runner reports no filesCreated).
 *
 * Usage:
 *   tsx scripts/test-v3-dry-run.ts
 */
import { resolve } from "node:path";

import {
  runGenerationV3,
  type AgentRunnerV3,
  type AgentRunInputV3,
  type AgentRunResultV3,
  type OrchestratorV3Event,
  type QaArtifactV3,
} from "../lib/agents/orchestrator-v3";
import { AGENT_NAMES_V3, type AgentNameV3 } from "../lib/agents/contracts-v3/agent-names";
import {
  validateBootstrapOutput,
  type BootstrapOutput,
} from "../lib/agents/contracts-v3/bootstrap.schema";

// ─── Synthetic Bootstrap fixture (the only v3 agent with full schema today) ─

const BOOTSTRAP_FIXTURE: BootstrapOutput = {
  envManifest: {
    validatorPath: "src/_shared/config/env.ts",
    variables: [
      {
        name: "DATABASE_URL",
        required: true,
        description: "Postgres connection string used by Prisma",
        category: "database",
        sensitive: true,
        example: "postgresql://user:pass@localhost:5433/app",
        validation: "url",
        consumedBy: ["persistence", "seeds-fixtures"],
        producedBy: "src/_shared/config/env.ts",
      },
      {
        name: "AUTH_JWT_SECRET",
        required: true,
        description: "HMAC secret used to sign JWT access tokens",
        category: "auth",
        sensitive: true,
        example: "change-me-32-bytes-hex",
        validation: "non-empty-string",
        consumedBy: ["auth-security", "api-backend"],
        producedBy: "src/_shared/config/env.ts",
      },
      {
        name: "POSTGRES_HOST_PORT",
        required: false,
        defaultValue: "5433",
        description: "Host port mapped to the Postgres container 5432",
        category: "database",
        sensitive: false,
        consumedBy: ["bootstrap-devops"],
        producedBy: "src/_shared/config/env.ts",
      },
    ],
  },
  dockerServices: [
    {
      name: "postgres",
      image: "postgres:16-alpine",
      ports: ["${POSTGRES_HOST_PORT:-5433}:5432"],
      envVars: ["POSTGRES_HOST_PORT"],
      volumes: ["postgres_data:/var/lib/postgresql/data"],
      healthcheck: "pg_isready -U $POSTGRES_USER -d $POSTGRES_DB",
    },
  ],
  setupSteps: [
    { order: 1, description: "Start Postgres container", command: "docker compose up -d postgres", required: true, os: "all" },
    { order: 2, description: "Wait for Postgres healthcheck", command: "docker compose exec postgres pg_isready", required: true, os: "all" },
    { order: 3, description: "Apply Prisma migrations", command: "pnpm prisma migrate dev", required: true, os: "all" },
    { order: 4, description: "Seed demo data", command: "pnpm prisma:seed", required: false, os: "all" },
  ],
  checkEnvironmentRules: [
    {
      id: "postgres-reachable",
      description: "Postgres responds to TCP probe on DATABASE_URL host:port",
      detect: "Open TCP connection to host extracted from DATABASE_URL",
      whenFails: "Postgres is unreachable. Docker may be down or the port is blocked.",
      fixSuggestion: "Run `docker compose up -d postgres` OR set NEON_DATABASE_URL to use Neon serverless.",
    },
    {
      id: "jwt-secret-set",
      description: "AUTH_JWT_SECRET is at least 32 chars",
      detect: "process.env.AUTH_JWT_SECRET.length >= 32",
      whenFails: "AUTH_JWT_SECRET is missing or too short.",
      fixSuggestion: "Generate one with `openssl rand -hex 32` and paste in .env.local",
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
};

// ─── Fake runner — synthesises an artifact per agent ────────────────

function fakeArtifactFor(agent: AgentNameV3): unknown {
  if (agent === "bootstrap-devops") return BOOTSTRAP_FIXTURE;
  if (agent === "qa-reviewer") {
    return {
      decision: "go",
      violations: [],
      summary: "Dry-run synthetic qa-report (all gates skipped).",
    } satisfies QaArtifactV3;
  }
  return { agent, synthetic: true };
}

function makeFakeRunnerV3(): AgentRunnerV3 {
  return async (input: AgentRunInputV3): Promise<AgentRunResultV3> => ({
    artifact: fakeArtifactFor(input.agent),
    filesCreated: [],
    summary: `${input.agent.toUpperCase()}_DONE (dry-run)`,
  });
}

// ─── Pretty console logger ──────────────────────────────────────────

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(stage: string, msg: string): void {
  console.log(`[${ts()}] [${stage}] ${msg}`);
}

function describeEvent(e: OrchestratorV3Event): { stage: string; msg: string } | null {
  switch (e.type) {
    case "generation.started":
      return { stage: "orchestrator", msg: `▶ generation.started id=${e.generationId}` };
    case "generation.completed":
      return { stage: "orchestrator", msg: `✓ generation.completed — ${e.summary}` };
    case "generation.failed":
      return { stage: "orchestrator", msg: `✗ generation.failed — ${e.reason}` };
    case "wave.started":
      return { stage: "wave", msg: `▶ ${e.wave} — agents: [${e.agents.join(", ")}]` };
    case "wave.completed":
      return { stage: "wave", msg: `✓ ${e.wave} (${(e.durationMs / 1000).toFixed(2)}s) — ${e.results.map((r) => `${r.agent}:${r.status}`).join(" ")}` };
    case "agent.started":
      return { stage: e.agent, msg: `▶ started (${e.wave})` };
    case "agent.completed":
      return { stage: e.agent, msg: `✓ ${e.summary}` };
    case "agent.failed":
      return { stage: e.agent, msg: `✗ ${e.reason}` };
    case "agent.file_created":
      return { stage: e.agent, msg: `  + ${e.path} (${e.lines} lines)` };
    default:
      return null;
  }
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<number> {
  log("init", "v3 dry-run: orchestrator-v3 + fake runner");
  log("init", `agent count expected: ${AGENT_NAMES_V3.length}`);

  // Pre-flight: validate the Bootstrap fixture against the schema.
  const bootstrapErr = validateBootstrapOutput(BOOTSTRAP_FIXTURE);
  if (bootstrapErr) {
    log("init", `✗ bootstrap fixture fails schema: ${bootstrapErr}`);
    return 2;
  }
  log("init", "✓ bootstrap fixture passes validateBootstrapOutput");

  const events: OrchestratorV3Event[] = [];
  const runner = makeFakeRunnerV3();

  const start = Date.now();
  const result = await runGenerationV3({
    generationId: `v3-dryrun-${Date.now()}`,
    prd: { domain: "synthetic", roles: ["admin"], entities: [], useCases: [] },
    workDir: resolve(__dirname, "..", "out", "v3-dryrun-tmp"),
    runner,
    emit: async (e) => {
      events.push(e);
      const d = describeEvent(e);
      if (d) log(d.stage, d.msg);
    },
  });
  const durationMs = Date.now() - start;

  // ─── Invariants ────────────────────────────────────────────────────

  const failures: string[] = [];

  const waveCompletedCount = events.filter((e) => e.type === "wave.completed").length;
  if (waveCompletedCount !== 10) {
    failures.push(`expected 10 wave.completed events, got ${waveCompletedCount}`);
  }

  const agentCompletedCount = events.filter((e) => e.type === "agent.completed").length;
  if (agentCompletedCount !== AGENT_NAMES_V3.length) {
    failures.push(
      `expected ${AGENT_NAMES_V3.length} agent.completed events, got ${agentCompletedCount}`,
    );
  }

  if (result.failedAt) {
    failures.push(`unexpected failedAt: wave=${result.failedAt.wave} agent=${result.failedAt.agent}`);
  }

  if (result.qa?.decision !== "go") {
    failures.push(`qa.decision should be "go", got ${result.qa?.decision ?? "null"}`);
  }

  // Every agent should appear in artifacts.
  for (const agent of AGENT_NAMES_V3) {
    if (!(agent in result.artifacts)) {
      failures.push(`artifact missing for agent: ${agent}`);
    }
  }

  // Specifically: bootstrap-devops artifact must still validate.
  const bootstrapArtifact = result.artifacts["bootstrap-devops"];
  const bootErr = validateBootstrapOutput(bootstrapArtifact);
  if (bootErr) {
    failures.push(`bootstrap-devops artifact in result.artifacts fails schema: ${bootErr}`);
  }

  log(
    "done",
    failures.length === 0
      ? `▣ v3 DRY-RUN GREEN — ${agentCompletedCount}/23 agents, ${waveCompletedCount}/10 waves, ${durationMs}ms`
      : `▣ v3 DRY-RUN FAIL — ${failures.length} invariant(s) violated`,
  );

  if (failures.length > 0) {
    for (const f of failures) log("fail", `✗ ${f}`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(99);
  },
);
