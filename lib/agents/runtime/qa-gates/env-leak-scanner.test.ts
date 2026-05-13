import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { scanProcessEnvLeaks, scanSource } from "./env-leak-scanner";

const FIXTURE_ROOT = resolve(tmpdir(), "atelier-v3-env-leak-tests");

async function makeWorkDir(): Promise<string> {
  const wd = join(FIXTURE_ROOT, "wd-" + Math.random().toString(36).slice(2));
  await mkdir(wd, { recursive: true });
  return wd;
}

async function write(wd: string, rel: string, body: string): Promise<void> {
  const abs = join(wd, rel);
  const parent = abs.substring(0, abs.lastIndexOf(/[\\/]/.test(abs) ? "/" : "\\")).replace(/\/+$/, "");
  // simpler: build parent via split
  const segs = rel.split("/");
  segs.pop();
  if (segs.length > 0) await mkdir(join(wd, segs.join("/")), { recursive: true });
  void parent;
  await writeFile(abs, body, "utf-8");
}

beforeEach(async () => {
  if (existsSync(FIXTURE_ROOT)) await rm(FIXTURE_ROOT, { recursive: true, force: true });
  await mkdir(FIXTURE_ROOT, { recursive: true });
});

afterEach(async () => {
  if (existsSync(FIXTURE_ROOT)) await rm(FIXTURE_ROOT, { recursive: true, force: true });
});

// ─── Test 1 — positive match in a service file ─────────────────────

describe("env-leak scanner — positive matches", () => {
  it("flags a process.env.X read in a service file (bug class A reproduction)", async () => {
    const wd = await makeWorkDir();
    await write(wd, "src/auth/application/service/AuthService.ts", [
      `import { sign } from "jose";`,
      ``,
      `export class AuthService {`,
      `  signToken(payload: object) {`,
      `    const secret = process.env.AUTH_JWT_SECRET;`,
      `    return sign(payload, new TextEncoder().encode(secret));`,
      `  }`,
      `}`,
      ``,
    ].join("\n"));

    const violations = await scanProcessEnvLeaks({ workDir: wd });
    expect(violations).toHaveLength(1);
    const v = violations[0]!;
    expect(v.rule).toBe("env-leak");
    expect(v.severity).toBe("error");
    expect(v.agent).toBe("bootstrap-devops");
    expect(v.file).toBe("src/auth/application/service/AuthService.ts");
    expect(v.line).toBe(5);
    expect(v.message).toContain("AUTH_JWT_SECRET");
    expect(v.recommendedFix).toContain("env.AUTH_JWT_SECRET");
    expect(v.recommendedFix).toContain('@/_shared/config/env');
  });
});

// ─── Test 2 — allowlist (env.ts + next.config.*) ──────────────────

describe("env-leak scanner — allowlist", () => {
  it("ignores reads inside src/_shared/config/env.ts (single source of truth)", async () => {
    const wd = await makeWorkDir();
    await write(wd, "src/_shared/config/env.ts", [
      `import { z } from "zod";`,
      `const schema = z.object({`,
      `  DATABASE_URL: z.string().url(),`,
      `  AUTH_JWT_SECRET: z.string().min(32),`,
      `});`,
      `const parsed = schema.safeParse(process.env);`,
      `const url = process.env.DATABASE_URL;`,
      `void url;`,
      `export const env = parsed.success ? parsed.data : ({} as never);`,
      ``,
    ].join("\n"));

    const violations = await scanProcessEnvLeaks({ workDir: wd });
    expect(violations).toHaveLength(0);
  });

  it("ignores reads inside next.config.ts / .mjs / .js", async () => {
    const wd = await makeWorkDir();
    await write(wd, "next.config.ts", [
      `const config = {`,
      `  images: {`,
      `    remotePatterns: [{ protocol: "https", hostname: process.env.NEXT_PUBLIC_CDN_HOST! }],`,
      `  },`,
      `};`,
      `export default config;`,
      ``,
    ].join("\n"));
    // Also ensure that .mjs and .js are NOT scanned at all (only .ts/.tsx scanner targets)
    // — but if they were, the allowlist would still cover them.
    await write(wd, "next.config.mjs", `export default { reactStrictMode: true };\n`);

    const violations = await scanProcessEnvLeaks({ workDir: wd });
    expect(violations).toHaveLength(0);
  });
});

// ─── Test 3 — UI component (NEXT_PUBLIC_* counts too) ─────────────

describe("env-leak scanner — UI components", () => {
  it("flags process.env.NEXT_PUBLIC_X in a client component (R0 is no-exception)", async () => {
    const wd = await makeWorkDir();
    await write(wd, "client/components/Layout/Header.tsx", [
      `"use client";`,
      ``,
      `export function Header() {`,
      `  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "/";`,
      `  return <a href={appUrl}>Home</a>;`,
      `}`,
      ``,
    ].join("\n"));

    const violations = await scanProcessEnvLeaks({ workDir: wd });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("client/components/Layout/Header.tsx");
    expect(violations[0]?.line).toBe(4);
    expect(violations[0]?.message).toContain("NEXT_PUBLIC_APP_URL");
  });
});

// ─── Test 4 — false-positive resistance (comments + interpolation) ──

describe("env-leak scanner — false-positive resistance", () => {
  it("4a) ignores process.env.X inside a line comment", async () => {
    const wd = await makeWorkDir();
    await write(wd, "src/_shared/utils/notes.ts", [
      `// Historically we read process.env.LEGACY_FLAG here. Removed in v3.`,
      `export const NOTE = "legacy comment, not a leak";`,
      ``,
    ].join("\n"));

    const violations = await scanProcessEnvLeaks({ workDir: wd });
    expect(violations).toHaveLength(0);
  });

  it("4b) ignores process.env.X inside a block comment spanning multiple lines", async () => {
    const wd = await makeWorkDir();
    await write(wd, "src/_shared/utils/notes-block.ts", [
      `/*`,
      `  Migration note: replace process.env.OLD_KEY with`,
      `  env.NEW_KEY when the agent runs the v3 fix loop.`,
      `*/`,
      `export const NOTE = "block comment, not a leak";`,
      ``,
    ].join("\n"));

    const violations = await scanProcessEnvLeaks({ workDir: wd });
    expect(violations).toHaveLength(0);
  });

  it("4c) ignores process.env.X inside JSDoc / TSDoc", async () => {
    const wd = await makeWorkDir();
    await write(wd, "src/services/Token.ts", [
      `/**`,
      ` * Issues a JWT signed with the AUTH_JWT_SECRET.`,
      ` * @example const t = issue("u1") // reads env.AUTH_JWT_SECRET, never process.env.AUTH_JWT_SECRET`,
      ` */`,
      `export function issue(_userId: string) {`,
      `  return "stub";`,
      `}`,
      ``,
    ].join("\n"));

    const violations = await scanProcessEnvLeaks({ workDir: wd });
    expect(violations).toHaveLength(0);
  });

  it("4d) ignores template-literal interpolation `process.env.${VAR}` (regex's [A-Z] anchor)", async () => {
    const wd = await makeWorkDir();
    await write(wd, "src/_shared/utils/dynamic-lookup.ts", [
      `export function lookup(key: string) {`,
      `  // The string below builds a key NAME dynamically; we do NOT read`,
      `  // process.env directly here.`,
      `  return \`process.env.\${key.toUpperCase()}\`;`,
      `}`,
      ``,
    ].join("\n"));

    const violations = await scanProcessEnvLeaks({ workDir: wd });
    expect(violations).toHaveLength(0);
  });

  it("4d-bis) DOES flag a real read inside a template-literal interpolation slot", async () => {
    // Sanity check that the lenient template handling doesn't miss real
    // reads. Inside ${...} we're in real code, so process.env.X must be
    // flagged.
    const wd = await makeWorkDir();
    await write(wd, "src/_shared/utils/logger.ts", [
      `export function log(msg: string) {`,
      `  console.log(\`[\${process.env.NODE_ENV}] \${msg}\`);`,
      `}`,
      ``,
    ].join("\n"));

    const violations = await scanProcessEnvLeaks({ workDir: wd });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("NODE_ENV");
  });
});

// ─── Direct scanSource tests (faster, no fs) ───────────────────────

describe("scanSource (pure)", () => {
  it("captures the var name correctly", () => {
    const hits = scanSource(`const x = process.env.MY_VAR;`);
    expect(hits).toEqual([{ line: 1, varName: "MY_VAR" }]);
  });

  it("returns multiple hits on the same line", () => {
    const hits = scanSource(`const a = process.env.A; const b = process.env.B;`);
    expect(hits.map((h) => h.varName)).toEqual(["A", "B"]);
  });

  it("does NOT match lowercase identifiers (must start with [A-Z])", () => {
    const hits = scanSource(`const x = process.env.lowercase;`);
    expect(hits).toHaveLength(0);
  });

  it("does NOT match when prefixed by a word boundary character", () => {
    const hits = scanSource(`const obj = { Webprocess: { env: { X: 1 } } };`);
    expect(hits).toHaveLength(0);
  });
});
