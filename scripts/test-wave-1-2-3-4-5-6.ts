/**
 * v2 cumulative dry-run E2E (Wave 1 → 6 — full pipeline).
 *
 * Validates that all 16 artifacts produced by the 16 v2 agents pass their
 * Zod schemas, the synthetic workDir compiles tsc + lints + prisma format,
 * and the file structure invariants hold for the full pipeline:
 *
 *   wave 1: discovery + architect + design-system + screens-map + ux-ui-designer
 *   wave 2: domain-modeler + persistence + seeds-shape
 *   wave 3: service-layer + auth-security + rbac-authorization
 *   wave 4: api-backend + frontend-architect + ui-components + forms-validations + pages-routing
 *   wave 5: seeds-fixtures + tests-writer
 *   wave 6: qa-report
 */
import { mkdir, rm, readFile, writeFile, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { validateDiscovery } from "../lib/agents/contracts-v2/discovery.schema";
import { validateArchitect } from "../lib/agents/contracts-v2/architect.schema";
import { validateDesignSystem } from "../lib/agents/contracts-v2/design-system.schema";
import { validateScreensMap } from "../lib/agents/contracts-v2/screens-map.schema";
import { validateDomainModel } from "../lib/agents/contracts-v2/domain-model.schema";
import { validatePersistence } from "../lib/agents/contracts-v2/persistence.schema";
import { validateSeedsPlan } from "../lib/agents/contracts-v2/seeds-plan.schema";
import { validateServices } from "../lib/agents/contracts-v2/services.schema";
import { validateAuthMechanics } from "../lib/agents/contracts-v2/auth-mechanics.schema";
import { validateRbacPolicy } from "../lib/agents/contracts-v2/rbac-policy.schema";
import { validateApiContract } from "../lib/agents/contracts-v2/api-contract.schema";
import { validateFrontendArchitecture } from "../lib/agents/contracts-v2/frontend-architecture.schema";
import { validateComponentsCatalog } from "../lib/agents/contracts-v2/components-catalog.schema";
import { validateFormsValidations } from "../lib/agents/contracts-v2/forms-validations.schema";
import { validatePagesRouting } from "../lib/agents/contracts-v2/pages-routing.schema";
import { validateSeedsFixtures } from "../lib/agents/contracts-v2/seeds-fixtures.schema";
import { validateTestsWriter } from "../lib/agents/contracts-v2/tests-writer.schema";
import { validateQaReport } from "../lib/agents/contracts-v2/qa-report.schema";

const REPO_ROOT = resolve(__dirname, "..");
const SKELETON_V2 = join(REPO_ROOT, "lib", "skeleton-v2");
const FIXTURES = join(REPO_ROOT, "lib", "agents", "__tests__", "fixtures");

interface ArtifactSlot {
  filename: string;
  fixture: string;
  validate: (a: unknown) => string | null;
  wave: 1 | 2 | 3 | 4 | 5 | 6;
}

const ARTIFACTS: ArtifactSlot[] = [
  // wave 1
  { filename: "discovery.json", fixture: "yoga-discovery.json", validate: validateDiscovery, wave: 1 },
  { filename: "architect.json", fixture: "yoga-architect.json", validate: validateArchitect, wave: 1 },
  { filename: "design-system.json", fixture: "yoga-design-system.json", validate: validateDesignSystem, wave: 1 },
  { filename: "screens-map.json", fixture: "yoga-screens-map.json", validate: validateScreensMap, wave: 1 },
  // wave 2
  { filename: "domain-modeler.json", fixture: "yoga-domain-model.json", validate: validateDomainModel, wave: 2 },
  { filename: "persistence.json", fixture: "yoga-persistence.json", validate: validatePersistence, wave: 2 },
  { filename: "seeds-shape.json", fixture: "yoga-seeds-plan.json", validate: validateSeedsPlan, wave: 2 },
  // wave 3
  { filename: "service-layer.json", fixture: "yoga-service-layer.json", validate: validateServices, wave: 3 },
  { filename: "auth-security.json", fixture: "yoga-auth-mechanics.json", validate: validateAuthMechanics, wave: 3 },
  { filename: "rbac-authorization.json", fixture: "yoga-rbac-policy.json", validate: validateRbacPolicy, wave: 3 },
  // wave 4
  { filename: "api-backend.json", fixture: "yoga-api-contract.json", validate: validateApiContract, wave: 4 },
  { filename: "frontend-architect.json", fixture: "yoga-frontend-architecture.json", validate: validateFrontendArchitecture, wave: 4 },
  { filename: "ui-components.json", fixture: "yoga-components-catalog.json", validate: validateComponentsCatalog, wave: 4 },
  { filename: "forms-validations.json", fixture: "yoga-forms-validations.json", validate: validateFormsValidations, wave: 4 },
  { filename: "pages-routing.json", fixture: "yoga-pages-routing.json", validate: validatePagesRouting, wave: 4 },
  // wave 5
  { filename: "seeds-fixtures.json", fixture: "yoga-seeds-fixtures.json", validate: validateSeedsFixtures, wave: 5 },
  { filename: "tests-writer.json", fixture: "yoga-tests-writer.json", validate: validateTestsWriter, wave: 5 },
  // wave 6
  { filename: "qa-report.json", fixture: "yoga-qa-report.json", validate: validateQaReport, wave: 6 },
];

function log(stage: string, msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${stage}] ${msg}`);
}

async function setupWorkDir(): Promise<string> {
  const workDir = resolve(REPO_ROOT, "out", "test-wave123456-workdir");
  if (existsSync(workDir)) await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  log("setup", `cloning skeleton-v2 → ${workDir}`);
  await cp(SKELETON_V2, workDir, {
    recursive: true,
    filter: (src) => !src.includes("node_modules"),
  });
  await mkdir(join(workDir, ".atelier"), { recursive: true });
  return workDir;
}

async function dryRun(workDir: string): Promise<void> {
  log("dry-run", `dropping ${ARTIFACTS.length} fixture artifacts into .atelier/`);
  for (const a of ARTIFACTS) {
    await cp(join(FIXTURES, a.fixture), join(workDir, ".atelier", a.filename));
  }
  log("dry-run", "validating each artifact against its Zod schema");
  for (const a of ARTIFACTS) {
    const text = await readFile(join(workDir, ".atelier", a.filename), "utf-8");
    const json = JSON.parse(text) as unknown;
    const err = a.validate(json);
    if (err) throw new Error(`schema fail for ${a.filename}: ${err}`);
    log("dry-run", `  ✓ wave ${a.wave}: ${a.filename}`);
  }

  // Synthesize a representative slice covering all 6 waves.
  log("dry-run", "writing synthetic wave 1→6 sample (entity + repo + service + authz + controller + component + page + seed + test + qa-report)");

  // wave 2 — prisma schema
  await writeFile(
    join(workDir, "prisma", "schema.prisma"),
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
      `  id String @id @default(cuid())`,
      `  slug String @unique`,
      `  email String @unique`,
      `  name String`,
      `  passwordHash String`,
      `  role String`,
      `  isActive Boolean @default(true)`,
      `  status String @default("active")`,
      `  createdAt DateTime @default(now())`,
      `  updatedAt DateTime @updatedAt`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  // wave 2 — domain + dto + repo skeleton
  await mkdir(join(workDir, "src", "auth", "domain", "entity"), { recursive: true });
  await mkdir(join(workDir, "src", "auth", "domain", "dto"), { recursive: true });
  await mkdir(join(workDir, "src", "auth", "infrastructure", "repository"), { recursive: true });
  await mkdir(join(workDir, "src", "auth", "application", "service"), { recursive: true });
  await mkdir(join(workDir, "src", "auth", "application"), { recursive: true });
  await mkdir(join(workDir, "src", "auth", "presentation", "controller"), { recursive: true });
  await mkdir(join(workDir, "src", "_shared", "domain"), { recursive: true });
  await mkdir(join(workDir, "src", "_shared", "presentation", "errors"), { recursive: true });

  await writeFile(
    join(workDir, "src", "_shared", "domain", "errors.ts"),
    [
      `export class DomainError extends Error {`,
      `  code: string = "DOMAIN_ERROR";`,
      `  httpStatus: number = 500;`,
      `  constructor(m: string) { super(m); this.name = "DomainError"; }`,
      `}`,
      `export class ResourceNotFoundError extends DomainError {`,
      `  constructor(r: string, id: string) { super(\`\${r} \${id} not found\`); this.name = "ResourceNotFoundError"; this.code = "RESOURCE_NOT_FOUND"; this.httpStatus = 404; }`,
      `}`,
      `export class ForbiddenError extends DomainError {`,
      `  constructor(m = "Forbidden") { super(m); this.name = "ForbiddenError"; this.code = "FORBIDDEN"; this.httpStatus = 403; }`,
      `}`,
      `export class UnauthorizedError extends DomainError {`,
      `  constructor(m = "Unauthorized") { super(m); this.name = "UnauthorizedError"; this.code = "UNAUTHORIZED"; this.httpStatus = 401; }`,
      `}`,
      `export class ValidationError extends DomainError {`,
      `  constructor(m: string) { super(m); this.name = "ValidationError"; this.code = "VALIDATION_ERROR"; this.httpStatus = 422; }`,
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
      `  readonly id: string; readonly slug: string; readonly email: string; readonly name: string;`,
      `  readonly passwordHash: string; readonly role: Role;`,
      `  readonly isActive: boolean; readonly status: string;`,
      `  readonly createdAt: Date; readonly updatedAt: Date;`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  await writeFile(
    join(workDir, "src", "auth", "domain", "dto", "UserDTO.ts"),
    [
      `export interface UserDTO {`,
      `  readonly id: string; readonly slug: string; readonly email: string; readonly name: string;`,
      `  readonly role: string; readonly isActive: boolean; readonly status: string;`,
      `  readonly createdAt: string; readonly updatedAt: string;`,
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
      `export interface CreateUserPayload { email: string; name: string; passwordHash: string; role: Role; }`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  // wave 3 — services + authz
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
      `export class AuthorizationService {`,
      `  can(user: UserContext | null, action: AppActions, subject: AppSubjects): boolean {`,
      `    void user; void action; void subject;`,
      `    return true;`,
      `  }`,
      `  assertCan(u: UserContext | null, a: AppActions, s: AppSubjects): void {`,
      `    if (!this.can(u, a, s)) throw new ForbiddenError(\`Cannot \${a} on \${s}\`);`,
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
      `export class AuthService {`,
      `  constructor(private readonly users: UserRepository) {}`,
      `  async login(input: { email: string; password: string }): Promise<{ user: UserDTO } | null> {`,
      `    const u = await this.users.findByEmail(input.email);`,
      `    if (!u) return null;`,
      `    return {`,
      `      user: {`,
      `        id: u.id, slug: u.slug, email: u.email, name: u.name, role: u.role,`,
      `        isActive: u.isActive, status: u.status,`,
      `        createdAt: u.createdAt.toISOString(),`,
      `        updatedAt: u.updatedAt.toISOString(),`,
      `      },`,
      `    };`,
      `  }`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  // wave 4 — controller + react component + page
  await writeFile(
    join(workDir, "src", "_shared", "presentation", "errors", "GlobalExceptionHandler.ts"),
    [
      `import { NextResponse } from "next/server";`,
      `import { DomainError } from "../../domain/errors";`,
      `export const GlobalExceptionHandler = {`,
      `  toResponse(err: unknown): Response {`,
      `    if (err instanceof DomainError) {`,
      `      return NextResponse.json({ error: err.code, message: err.message }, { status: err.httpStatus });`,
      `    }`,
      `    return NextResponse.json({ error: "INTERNAL", message: "Internal" }, { status: 500 });`,
      `  },`,
      `};`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  await writeFile(
    join(workDir, "src", "auth", "presentation", "controller", "AuthController.ts"),
    [
      `import { NextResponse } from "next/server";`,
      `import { AuthService } from "../../application/service/AuthService";`,
      `import { GlobalExceptionHandler } from "../../../_shared/presentation/errors/GlobalExceptionHandler";`,
      `export class AuthController {`,
      `  constructor(private readonly service: AuthService) {}`,
      `  async login(req: Request): Promise<Response> {`,
      `    try {`,
      `      const body = await req.json() as { email: string; password: string };`,
      `      const result = await this.service.login(body);`,
      `      if (!result) return NextResponse.json({ error: "INVALID_CREDENTIALS" }, { status: 401 });`,
      `      return NextResponse.json(result);`,
      `    } catch (err) {`,
      `      return GlobalExceptionHandler.toResponse(err);`,
      `    }`,
      `  }`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  await mkdir(join(workDir, "client", "components", "Shared"), { recursive: true });
  await writeFile(
    join(workDir, "client", "components", "Shared", "EmptyState.tsx"),
    [
      `interface EmptyStateProps { title: string; description?: string }`,
      `export function EmptyState({ title, description }: EmptyStateProps) {`,
      `  return (`,
      `    <div className="flex flex-col items-center gap-2 p-8 text-center">`,
      `      <p className="text-lg font-semibold">{title}</p>`,
      `      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}`,
      `    </div>`,
      `  );`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  await mkdir(join(workDir, "app", "(public)", "shop"), { recursive: true });
  await writeFile(
    join(workDir, "app", "(public)", "shop", "page.tsx"),
    [
      `import type { Metadata } from "next";`,
      `import { EmptyState } from "@client/components/Shared/EmptyState";`,
      `export const metadata: Metadata = { title: "Shop — Test" };`,
      `export default function ShopPage() {`,
      `  return <EmptyState title="Sin clases" description="Aún no hay clases programadas" />;`,
      `}`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  // wave 5 — prisma/seed.ts + tests scaffolding
  await writeFile(
    join(workDir, "prisma", "seed.ts"),
    [
      `// Atelier-generated seed script (representative slice for dry-run).`,
      `// Hand-curated demo data per Seeds & Fixtures agent contract.`,
      `import { PrismaClient } from "../src/_shared/infrastructure/db/generated/client";`,
      `import { PrismaPg } from "@prisma/adapter-pg";`,
      ``,
      `const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" });`,
      `const prisma = new PrismaClient({ adapter });`,
      ``,
      `async function main(): Promise<void> {`,
      `  console.log("🌱 Seeding...");`,
      `  await prisma.user.upsert({`,
      `    where: { email: "admin@demo.yoga" },`,
      `    update: {},`,
      `    create: {`,
      `      slug: "admin-demo",`,
      `      email: "admin@demo.yoga",`,
      `      name: "Admin Demo",`,
      `      passwordHash: "$2b$12$placeholder",`,
      `      role: "admin",`,
      `    },`,
      `  });`,
      `  console.log("✅ Seed complete");`,
      `}`,
      ``,
      `main().catch(console.error).finally(() => prisma.$disconnect());`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  await mkdir(join(workDir, "tests", "unit", "auth"), { recursive: true });
  await mkdir(join(workDir, "tests", "integration"), { recursive: true });
  await mkdir(join(workDir, "tests", "e2e"), { recursive: true });
  await mkdir(join(workDir, "tests", "fixtures"), { recursive: true });
  await mkdir(join(workDir, "tests", "helpers"), { recursive: true });

  await writeFile(
    join(workDir, "tests", "unit", "auth", "AuthService.test.ts"),
    [
      `import { describe, it, expect } from "vitest";`,
      `describe("AuthService.login", () => {`,
      `  it("returns null for unknown email", async () => {`,
      `    expect(true).toBe(true); // placeholder for cumulative dry-run`,
      `  });`,
      `});`,
      ``,
    ].join("\n"),
    "utf-8",
  );

  log("dry-run", "installing deps in workDir");
  const install = spawnSync(
    "pnpm",
    ["install", "--ignore-workspace", "--prefer-offline", "--reporter=silent"],
    { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", shell: process.platform === "win32" },
  );
  if (install.status !== 0) {
    console.log(install.stdout); console.log(install.stderr);
    throw new Error(`pnpm install failed (exit ${install.status})`);
  }

  log("dry-run", "running prisma generate to materialize the client (needed by seed.ts typecheck)");
  const prismaGen = spawnSync(
    "pnpm",
    ["exec", "prisma", "generate", "--schema", "prisma/schema.prisma"],
    { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", shell: process.platform === "win32" },
  );
  if (prismaGen.status !== 0) {
    console.log(prismaGen.stdout); console.log(prismaGen.stderr);
    throw new Error(`prisma generate failed (exit ${prismaGen.status})`);
  }

  log("dry-run", "running pnpm typecheck on cumulative wave 1-6 slice");
  const tsc = spawnSync("pnpm", ["typecheck"], {
    cwd: workDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", shell: process.platform === "win32",
  });
  if (tsc.status !== 0) {
    console.log(tsc.stdout); console.log(tsc.stderr);
    throw new Error(`typecheck failed (exit ${tsc.status})`);
  }
  log("dry-run", "  ✓ pnpm typecheck green over wave 1+2+3+4+5+6 synthetic slice");

  log("dry-run", "running prisma format");
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

  log("dry-run", "running pnpm lint");
  const lint = spawnSync("pnpm", ["lint"], {
    cwd: workDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", shell: process.platform === "win32",
  });
  if (lint.status !== 0) {
    console.log(lint.stdout); console.log(lint.stderr);
    throw new Error(`lint failed (exit ${lint.status})`);
  }
  log("dry-run", "  ✓ pnpm lint green");

  // wave 5 + wave 6 file-presence invariants
  log("dry-run", "checking wave 5+6 structural invariants");
  const must = [
    "prisma/seed.ts",
    "tests/unit/auth/AuthService.test.ts",
    "tests/integration",
    "tests/e2e",
    "tests/fixtures",
    "tests/helpers",
  ];
  for (const p of must) {
    if (!existsSync(join(workDir, p))) {
      throw new Error(`missing required path: ${p}`);
    }
    log("dry-run", `  ✓ ${p}`);
  }
}

async function main(): Promise<number> {
  const startedAt = Date.now();
  log("init", "MODE: --dry-run cumulative wave 1→6 (full pipeline)");
  const workDir = await setupWorkDir();
  log("init", `workDir = ${workDir}`);
  try {
    await dryRun(workDir);
  } catch (err) {
    console.error(`✗ FAIL: ${(err as Error).message}`);
    return 1;
  }
  log("done", `✅ wave 1→6 cumulative dry-run green in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  log("done", `   workDir preserved at: ${workDir}`);
  log("done", `   18 artifacts validated (16 agents + discovery + architect), tsc + lint + prisma all green`);
  log("done", `   wave 5+6 file invariants present (seed.ts, tests/{unit,integration,e2e,fixtures,helpers})`);
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => { console.error(e); process.exit(2); },
);
