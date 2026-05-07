/**
 * v2 Day 2 E2E test — Wave 1 (UX/UI Designer) + Wave 2 (Domain Modeler ‖
 * Persistence ‖ Seeds Shape Designer).
 *
 * Two run modes (controlled by CLI flag or env):
 *
 *   --dry-run  (default)
 *     Wires the runner against pre-recorded fixtures: drops the expected-shape
 *     JSON artifacts into the workDir's .atelier/, then validates each one
 *     against its Zod schema, parses the would-be prisma/schema.prisma, and
 *     runs `pnpm typecheck` over a synthetic domain + repository pair to
 *     prove the v2 wiring lands on disk correctly.
 *     Time: ~30 seconds. No claude binary required. Free.
 *
 *   --real
 *     Spawns the actual `claude` CLI for each of the 4 agents in sequence.
 *     Reads no fixtures; the agents write their own artifacts. Takes ~20-30
 *     min wallclock per generation. Costs LLM tokens. Requires `claude`
 *     in PATH.
 *
 * The dry-run mode is what runs in `pnpm agents:test:wave12` to keep CI
 * deterministic. To exercise the real LLM agents, run:
 *   pnpm agents:test:wave12 -- --real
 */
import { mkdir, rm, readFile, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { validateDesignSystem } from "../lib/agents/contracts-v2/design-system.schema";
import { validateScreensMap } from "../lib/agents/contracts-v2/screens-map.schema";
import { validateDomainModel } from "../lib/agents/contracts-v2/domain-model.schema";
import { validatePersistence } from "../lib/agents/contracts-v2/persistence.schema";
import { validateSeedsPlan } from "../lib/agents/contracts-v2/seeds-plan.schema";
import { runGeneratorAgentV2 } from "../lib/agents/runtime/runner-generator-v2";
import type { AgentNameV2 } from "../lib/agents/violations-router-v2";

const REPO_ROOT = resolve(__dirname, "..");
const SKELETON_V2 = join(REPO_ROOT, "lib", "skeleton-v2");
const FIXTURES = join(REPO_ROOT, "lib", "agents", "__tests__", "fixtures");
const PROMPTS_V2 = join(REPO_ROOT, "lib", "agents", "prompts-v2");

interface TestArtifacts {
  agent: AgentNameV2;
  filename: string;          // <agent>.json (always under .atelier/)
  fixture: string;           // path to the pre-recorded fixture (relative to FIXTURES)
  validator: (a: unknown) => string | null;
}

const ARTIFACTS: TestArtifacts[] = [
  {
    agent: "ux-ui-designer",
    filename: "ux-ui-designer.json",
    fixture: "yoga-design-system.json",
    validator: validateDesignSystem,
  },
  // The UX/UI Designer actually writes TWO artifacts. We track the second one
  // separately so the dry-run can validate both.
  {
    agent: "ux-ui-designer",
    filename: "screens-map.json",
    fixture: "yoga-screens-map.json",
    validator: validateScreensMap,
  },
  {
    agent: "domain-modeler",
    filename: "domain-modeler.json",
    fixture: "yoga-domain-model.json",
    validator: validateDomainModel,
  },
  {
    agent: "persistence",
    filename: "persistence.json",
    fixture: "yoga-persistence.json",
    validator: validatePersistence,
  },
  {
    agent: "seeds-shape",
    filename: "seeds-shape.json",
    fixture: "yoga-seeds-plan.json",
    validator: validateSeedsPlan,
  },
];

function log(stage: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${stage}] ${msg}`);
}

async function setupWorkDir(): Promise<string> {
  const workDir = resolve(REPO_ROOT, "out", "test-wave12-workdir");
  if (existsSync(workDir)) {
    await rm(workDir, { recursive: true, force: true });
  }
  await mkdir(workDir, { recursive: true });
  // Copy skeleton-v2 (sources only, no node_modules) into workDir.
  log("setup", `cloning skeleton-v2 → ${workDir}`);
  await cp(SKELETON_V2, workDir, {
    recursive: true,
    filter: (src) => !src.includes("node_modules"),
  });
  await mkdir(join(workDir, ".atelier"), { recursive: true });
  // Pre-populate the inputs (discovery.json + architect.json) — they would
  // come from earlier waves in a real generation.
  await cp(join(FIXTURES, "yoga-discovery.json"), join(workDir, ".atelier", "discovery.json"));
  await cp(join(FIXTURES, "yoga-architect.json"), join(workDir, ".atelier", "architect.json"));
  return workDir;
}

async function dryRun(workDir: string): Promise<void> {
  log("dry-run", "dropping fixture artifacts into .atelier/");
  for (const a of ARTIFACTS) {
    const src = join(FIXTURES, a.fixture);
    const dst = join(workDir, ".atelier", a.filename);
    await cp(src, dst);
  }
  log("dry-run", "validating each artifact against its Zod schema");
  for (const a of ARTIFACTS) {
    const text = await readFile(join(workDir, ".atelier", a.filename), "utf-8");
    const json = JSON.parse(text) as unknown;
    const err = a.validator(json);
    if (err) throw new Error(`schema validation failed for ${a.filename}: ${err}`);
    log("dry-run", `  ✓ ${a.filename} valid`);
  }

  // Synthesize a tiny prisma schema + a domain entity + repo interface to
  // prove the v2 layout would compile. Don't run the full agents — just
  // exercise the file paths and tsc strictness on a representative sample.
  log("dry-run", "writing synthetic prisma schema + 1 entity + 1 repo for tsc");
  const prismaPath = join(workDir, "prisma", "schema.prisma");
  await writeFile(
    prismaPath,
    [
      `generator client {`,
      `  provider = "prisma-client"`,
      `  output   = "../src/_shared/infrastructure/db/generated"`,
      `}`,
      ``,
      `// Prisma 7: connection URL belongs in prisma.config.ts, not here.`,
      `datasource db {`,
      `  provider = "postgresql"`,
      `}`,
      ``,
      `model User {`,
      `  id           String   @id @default(cuid())`,
      `  slug         String   @unique`,
      `  email        String   @unique`,
      `  name         String`,
      `  passwordHash String`,
      `  role         String   // allowed: admin, teacher, student`,
      `  isActive     Boolean  @default(true)`,
      `  status       String   @default("active") // allowed: active, inactive`,
      `  createdAt    DateTime @default(now())`,
      `  updatedAt    DateTime @updatedAt`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  // The Persistence agent would write src/auth/infrastructure/repository/UserRepository.ts.
  // For the dry-run we synthesize a minimal interface that exercises the v2
  // import paths and the strict tsconfig.
  await mkdir(join(workDir, "src", "auth", "domain", "entity"), { recursive: true });
  await mkdir(join(workDir, "src", "auth", "domain", "dto"), { recursive: true });
  await mkdir(join(workDir, "src", "auth", "infrastructure", "repository"), { recursive: true });
  await mkdir(join(workDir, "src", "_shared", "domain"), { recursive: true });

  await writeFile(
    join(workDir, "src", "_shared", "domain", "errors.ts"),
    [
      `export class DomainError extends Error {`,
      `  code: string = "DOMAIN_ERROR";`,
      `  httpStatus: number = 500;`,
      `  constructor(message: string) {`,
      `    super(message);`,
      `    this.name = "DomainError";`,
      `  }`,
      `}`,
      ``,
      `export class ResourceNotFoundError extends DomainError {`,
      `  constructor(resource: string, identifier: string) {`,
      `    super(\`\${resource} with identifier "\${identifier}" not found\`);`,
      `    this.name = "ResourceNotFoundError";`,
      `    this.code = "RESOURCE_NOT_FOUND";`,
      `    this.httpStatus = 404;`,
      `  }`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  await writeFile(
    join(workDir, "src", "auth", "domain", "entity", "User.ts"),
    [
      `export type Role = "admin" | "teacher" | "student";`,
      ``,
      `export interface User {`,
      `  readonly id: string;`,
      `  readonly slug: string;`,
      `  readonly email: string;`,
      `  readonly name: string;`,
      `  readonly passwordHash: string;`,
      `  readonly role: Role;`,
      `  readonly isActive: boolean;`,
      `  readonly status: "active" | "inactive";`,
      `  readonly createdAt: Date;`,
      `  readonly updatedAt: Date;`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  await writeFile(
    join(workDir, "src", "auth", "domain", "dto", "UserDTO.ts"),
    [
      `export interface UserDTO {`,
      `  readonly id: string;`,
      `  readonly slug: string;`,
      `  readonly email: string;`,
      `  readonly name: string;`,
      `  readonly role: string;`,
      `  readonly isActive: boolean;`,
      `  readonly status: string;`,
      `  readonly createdAt: string;`,
      `  readonly updatedAt: string;`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  await writeFile(
    join(workDir, "src", "auth", "infrastructure", "repository", "UserRepository.ts"),
    [
      `import type { User, Role } from "../../domain/entity/User";`,
      ``,
      `export interface UserRepository {`,
      `  findById(id: string): Promise<User | null>;`,
      `  findBySlug(slug: string): Promise<User | null>;`,
      `  findByEmail(email: string): Promise<User | null>;`,
      `  create(input: CreateUserPayload): Promise<User>;`,
      `  update(id: string, patch: UpdateUserPayload): Promise<User>;`,
      `  softDelete(id: string): Promise<void>;`,
      `}`,
      ``,
      `export interface CreateUserPayload {`,
      `  email: string;`,
      `  name: string;`,
      `  passwordHash: string;`,
      `  role: Role;`,
      `}`,
      ``,
      `export interface UpdateUserPayload {`,
      `  email?: string;`,
      `  name?: string;`,
      `  role?: Role;`,
      `  isActive?: boolean;`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  log("dry-run", "installing deps in workDir (uses pnpm content-addressed cache, ~5s after first run)");
  const install = spawnSync(
    "pnpm",
    ["install", "--ignore-workspace", "--prefer-offline", "--reporter=silent"],
    {
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      shell: process.platform === "win32",
    },
  );
  if (install.status !== 0) {
    console.log(install.stdout);
    console.log(install.stderr);
    throw new Error(`pnpm install failed in workDir (exit ${install.status})`);
  }
  log("dry-run", "running pnpm typecheck on the synthetic workDir");
  const tsc = spawnSync("pnpm", ["typecheck"], {
    cwd: workDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
    shell: process.platform === "win32",
  });
  if (tsc.status !== 0) {
    console.log(tsc.stdout);
    console.log(tsc.stderr);
    throw new Error(`typecheck failed (exit ${tsc.status}) — synthetic workDir does NOT pass strict tsc`);
  }
  log("dry-run", "  ✓ pnpm typecheck green");

  // Validate the prisma schema parses. We don't need a running DB — `prisma format`
  // is a syntactic check that exits non-zero on invalid schemas.
  log("dry-run", "running pnpm exec prisma format -- --check on synthetic schema");
  const prismaFmt = spawnSync(
    "pnpm",
    ["exec", "prisma", "format", "--schema", "prisma/schema.prisma"],
    {
      cwd: workDir,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      shell: process.platform === "win32",
    },
  );
  if (prismaFmt.status !== 0) {
    console.log(prismaFmt.stdout);
    console.log(prismaFmt.stderr);
    throw new Error(`prisma format failed (exit ${prismaFmt.status})`);
  }
  log("dry-run", "  ✓ prisma schema parses");
}

async function realRun(workDir: string): Promise<void> {
  log("real", "running 4 v2 agents against claude — this takes ~25 minutes");

  const sequence: Array<{
    agent: AgentNameV2;
    promptFile: string;
    contextKeys: string[];
  }> = [
    { agent: "ux-ui-designer", promptFile: "ux-ui-designer.md", contextKeys: ["discovery", "architect"] },
    { agent: "domain-modeler", promptFile: "domain-modeler.md", contextKeys: ["discovery", "architect"] },
    { agent: "persistence", promptFile: "persistence.md", contextKeys: ["discovery", "architect", "domain-modeler"] },
    { agent: "seeds-shape", promptFile: "seeds-shape.md", contextKeys: ["discovery", "domain-modeler"] },
  ];

  for (const step of sequence) {
    const systemPrompt = await readFile(join(PROMPTS_V2, step.promptFile), "utf-8");
    const contextArtifacts: Record<string, unknown> = {};
    for (const k of step.contextKeys) {
      const path = join(workDir, ".atelier", `${k}.json`);
      if (existsSync(path)) {
        contextArtifacts[k] = JSON.parse(await readFile(path, "utf-8"));
      }
    }

    log("real", `→ launching ${step.agent}`);
    const result = await runGeneratorAgentV2({
      agent: step.agent,
      systemPrompt,
      contextArtifacts,
      workDir,
      emitEvent: (e) => {
        if (e.type === "completed") log("real", `   ✓ ${step.agent} done — ${e.stopSentinel}`);
        else if (e.type === "failed") log("real", `   ✗ ${step.agent} FAILED — ${e.reason}`);
        else if (e.type === "timeout")
          log("real", `   ⏰ ${step.agent} TIMEOUT — artifactSurvived=${e.artifactSurvived}`);
        else if (e.type === "file_created") log("real", `       wrote ${e.path} (${e.lines} lines)`);
      },
    });
    if (result.status === "failed") {
      throw new Error(`agent ${step.agent} failed: ${result.error}`);
    }
  }

  log("real", "validating all 5 artifacts against schemas");
  for (const a of ARTIFACTS) {
    const path = join(workDir, ".atelier", a.filename);
    if (!existsSync(path)) throw new Error(`artifact missing: ${a.filename}`);
    const text = await readFile(path, "utf-8");
    const json = JSON.parse(text) as unknown;
    const err = a.validator(json);
    if (err) throw new Error(`schema validation failed for ${a.filename}: ${err}`);
    log("real", `  ✓ ${a.filename} valid`);
  }
}

async function main(): Promise<number> {
  const real = process.argv.includes("--real");
  const startedAt = Date.now();

  log("init", real ? "MODE: --real (live LLM agents)" : "MODE: --dry-run (default; deterministic, fixture-driven)");

  const workDir = await setupWorkDir();
  log("init", `workDir = ${workDir}`);

  try {
    if (real) await realRun(workDir);
    else await dryRun(workDir);
  } catch (err) {
    console.error(`✗ FAIL: ${(err as Error).message}`);
    return 1;
  }

  const totalMs = Date.now() - startedAt;
  log("done", `✅ wave 1+2 ${real ? "real" : "dry-run"} green in ${(totalMs / 1000).toFixed(1)}s`);
  log("done", `   workDir preserved at: ${workDir}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  },
);
