/**
 * v2 Wave 3 dry-run E2E. Extends test-wave-1-2.ts with the 3 wave-3 agents
 * (Service Layer ‖ Auth & Security ‖ RBAC Authorization). Validates that:
 *
 *   - The 5 wave-1+2 artifacts are present (from prior wave)
 *   - The 3 wave-3 artifacts are present and pass schema
 *   - The synthetic workDir compiles tsc with the additional service +
 *     authorization + auth files
 *
 * Modes:
 *   --dry-run (default): drops all 8 fixtures, validates schemas, runs tsc.
 *   --real:              spawns the 3 wave-3 agents (assumes wave-1+2 already
 *                         materialized in workDir).
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
import { validateServices } from "../lib/agents/contracts-v2/services.schema";
import { validateAuthMechanics } from "../lib/agents/contracts-v2/auth-mechanics.schema";
import { validateRbacPolicy } from "../lib/agents/contracts-v2/rbac-policy.schema";

const REPO_ROOT = resolve(__dirname, "..");
const SKELETON_V2 = join(REPO_ROOT, "lib", "skeleton-v2");
const FIXTURES = join(REPO_ROOT, "lib", "agents", "__tests__", "fixtures");

interface ArtifactSlot {
  filename: string;
  fixture: string;
  validate: (a: unknown) => string | null;
}

const ARTIFACTS: ArtifactSlot[] = [
  { filename: "design-system.json", fixture: "yoga-design-system.json", validate: validateDesignSystem },
  { filename: "screens-map.json", fixture: "yoga-screens-map.json", validate: validateScreensMap },
  { filename: "domain-modeler.json", fixture: "yoga-domain-model.json", validate: validateDomainModel },
  { filename: "persistence.json", fixture: "yoga-persistence.json", validate: validatePersistence },
  { filename: "seeds-shape.json", fixture: "yoga-seeds-plan.json", validate: validateSeedsPlan },
  { filename: "service-layer.json", fixture: "yoga-service-layer.json", validate: validateServices },
  { filename: "auth-security.json", fixture: "yoga-auth-mechanics.json", validate: validateAuthMechanics },
  { filename: "rbac-authorization.json", fixture: "yoga-rbac-policy.json", validate: validateRbacPolicy },
];

function log(stage: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${stage}] ${msg}`);
}

async function setupWorkDir(): Promise<string> {
  const workDir = resolve(REPO_ROOT, "out", "test-wave123-workdir");
  if (existsSync(workDir)) await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  log("setup", `cloning skeleton-v2 → ${workDir}`);
  await cp(SKELETON_V2, workDir, {
    recursive: true,
    filter: (src) => !src.includes("node_modules"),
  });
  await mkdir(join(workDir, ".atelier"), { recursive: true });
  await cp(join(FIXTURES, "yoga-discovery.json"), join(workDir, ".atelier", "discovery.json"));
  await cp(join(FIXTURES, "yoga-architect.json"), join(workDir, ".atelier", "architect.json"));
  return workDir;
}

async function dryRun(workDir: string): Promise<void> {
  log("dry-run", "dropping 8 fixture artifacts into .atelier/");
  for (const a of ARTIFACTS) {
    await cp(join(FIXTURES, a.fixture), join(workDir, ".atelier", a.filename));
  }
  log("dry-run", "validating each artifact against its Zod schema");
  for (const a of ARTIFACTS) {
    const text = await readFile(join(workDir, ".atelier", a.filename), "utf-8");
    const json = JSON.parse(text) as unknown;
    const err = a.validate(json);
    if (err) throw new Error(`schema fail for ${a.filename}: ${err}`);
    log("dry-run", `  ✓ ${a.filename} valid`);
  }

  // Synthesize a tiny representative slice of wave 1+2+3 output for tsc.
  log("dry-run", "writing synthetic wave 1+2+3 sample (entity + repo + service + authz)");
  const prismaPath = join(workDir, "prisma", "schema.prisma");
  await writeFile(
    prismaPath,
    [
      `generator client {`,
      `  provider = "prisma-client"`,
      `  output   = "../src/_shared/infrastructure/db/generated"`,
      `}`,
      ``,
      `// Prisma 7: connection URL belongs in prisma.config.ts.`,
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
      `  role         String`,
      `  isActive     Boolean  @default(true)`,
      `  status       String   @default("active")`,
      `  createdAt    DateTime @default(now())`,
      `  updatedAt    DateTime @updatedAt`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  // domain layer
  await mkdir(join(workDir, "src", "auth", "domain", "entity"), { recursive: true });
  await mkdir(join(workDir, "src", "auth", "domain", "dto"), { recursive: true });
  await mkdir(join(workDir, "src", "auth", "infrastructure", "repository"), { recursive: true });
  await mkdir(join(workDir, "src", "auth", "application", "service"), { recursive: true });
  await mkdir(join(workDir, "src", "auth", "application"), { recursive: true });
  await mkdir(join(workDir, "src", "_shared", "domain"), { recursive: true });

  await writeFile(
    join(workDir, "src", "_shared", "domain", "errors.ts"),
    [
      `export class DomainError extends Error {`,
      `  code: string = "DOMAIN_ERROR";`,
      `  httpStatus: number = 500;`,
      `  constructor(message: string) { super(message); this.name = "DomainError"; }`,
      `}`,
      `export class ResourceNotFoundError extends DomainError {`,
      `  constructor(resource: string, id: string) {`,
      `    super(\`\${resource} \${id} not found\`);`,
      `    this.name = "ResourceNotFoundError";`,
      `    this.code = "RESOURCE_NOT_FOUND";`,
      `    this.httpStatus = 404;`,
      `  }`,
      `}`,
      `export class ForbiddenError extends DomainError {`,
      `  constructor(message: string = "Forbidden") {`,
      `    super(message);`,
      `    this.name = "ForbiddenError";`,
      `    this.code = "FORBIDDEN";`,
      `    this.httpStatus = 403;`,
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
      `export interface User {`,
      `  readonly id: string;`,
      `  readonly slug: string;`,
      `  readonly email: string;`,
      `  readonly name: string;`,
      `  readonly passwordHash: string;`,
      `  readonly role: Role;`,
      `  readonly isActive: boolean;`,
      `  readonly status: string;`,
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
      `export interface UserRepository {`,
      `  findById(id: string): Promise<User | null>;`,
      `  findByEmail(email: string): Promise<User | null>;`,
      `  create(input: CreateUserPayload): Promise<User>;`,
      `}`,
      `export interface CreateUserPayload {`,
      `  email: string; name: string; passwordHash: string; role: Role;`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  // wave 3: AuthorizationService (RBAC) + a thin AuthService stub
  await writeFile(
    join(workDir, "src", "auth", "application", "abilities.ts"),
    [
      `import type { Role } from "../domain/entity/User";`,
      `export type AppActions = "manage" | "create" | "read" | "update" | "delete";`,
      `export type AppSubjects = "User" | "Class" | "Booking" | "Membership" | "all";`,
      `export interface UserContext { id: string; role: Role }`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  await writeFile(
    join(workDir, "src", "auth", "application", "AuthorizationService.ts"),
    [
      `import { ForbiddenError } from "../../_shared/domain/errors";`,
      `import type { AppActions, AppSubjects, UserContext } from "./abilities";`,
      ``,
      `export class AuthorizationService {`,
      `  can(_user: UserContext | null, _action: AppActions, _subject: AppSubjects): boolean {`,
      `    return true; // stubbed for typecheck — real impl via CASL`,
      `  }`,
      `  assertCan(user: UserContext | null, action: AppActions, subject: AppSubjects): void {`,
      `    if (!this.can(user, action, subject)) throw new ForbiddenError(\`Cannot \${action} on \${subject}\`);`,
      `  }`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  await writeFile(
    join(workDir, "src", "auth", "application", "service", "AuthService.ts"),
    [
      `import type { UserRepository } from "../../infrastructure/repository/UserRepository";`,
      `import type { UserDTO } from "../../domain/dto/UserDTO";`,
      ``,
      `export class AuthService {`,
      `  constructor(private readonly users: UserRepository) {}`,
      `  async login(input: { email: string; password: string }): Promise<{ user: UserDTO } | null> {`,
      `    const u = await this.users.findByEmail(input.email);`,
      `    if (!u) return null;`,
      `    const { passwordHash: _, ...user } = u;`,
      `    return {`,
      `      user: {`,
      `        ...user,`,
      `        createdAt: u.createdAt.toISOString(),`,
      `        updatedAt: u.updatedAt.toISOString(),`,
      `      } as UserDTO,`,
      `    };`,
      `  }`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  log("dry-run", "installing deps in workDir (cached after 1st run)");
  const install = spawnSync(
    "pnpm",
    ["install", "--ignore-workspace", "--prefer-offline", "--reporter=silent"],
    { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", shell: process.platform === "win32" },
  );
  if (install.status !== 0) {
    console.log(install.stdout); console.log(install.stderr);
    throw new Error(`pnpm install failed (exit ${install.status})`);
  }
  log("dry-run", "running pnpm typecheck");
  const tsc = spawnSync("pnpm", ["typecheck"], {
    cwd: workDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", shell: process.platform === "win32",
  });
  if (tsc.status !== 0) {
    console.log(tsc.stdout); console.log(tsc.stderr);
    throw new Error(`typecheck failed (exit ${tsc.status})`);
  }
  log("dry-run", "  ✓ pnpm typecheck green over wave 1+2+3 synthetic slice");

  log("dry-run", "running prisma format on synthetic schema");
  const prismaFmt = spawnSync(
    "pnpm",
    ["exec", "prisma", "format", "--schema", "prisma/schema.prisma"],
    { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", shell: process.platform === "win32" },
  );
  if (prismaFmt.status !== 0) {
    console.log(prismaFmt.stdout); console.log(prismaFmt.stderr);
    throw new Error(`prisma format failed (exit ${prismaFmt.status})`);
  }
  log("dry-run", "  ✓ prisma schema parses");
}

async function main(): Promise<number> {
  const startedAt = Date.now();
  log("init", "MODE: --dry-run (deterministic, fixture-driven)");
  const workDir = await setupWorkDir();
  log("init", `workDir = ${workDir}`);
  try {
    await dryRun(workDir);
  } catch (err) {
    console.error(`✗ FAIL: ${(err as Error).message}`);
    return 1;
  }
  log("done", `✅ wave 1+2+3 dry-run green in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  log("done", `   workDir preserved at: ${workDir}`);
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => { console.error(e); process.exit(2); },
);
