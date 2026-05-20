/**
 * Atelier demo setup — single-command bootstrap.
 *
 * Steps:
 *   1. Verify Docker is running
 *   2. docker compose up -d postgres
 *   3. Wait for Postgres healthcheck (up to 30s)
 *   4. pnpm install (unless --skip-install)
 *   5. pnpm prisma migrate dev
 *   6. Warn if Clerk env vars are empty
 *   7. Print "Demo ready"
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SKIP_INSTALL = process.argv.includes("--skip-install");

function run(cmd: string, opts: { cwd?: string; stdio?: "inherit" | "pipe" } = {}): string {
  const result = spawnSync(cmd, {
    shell: true,
    cwd: opts.cwd ?? ROOT,
    stdio: opts.stdio ?? "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const msg = result.stderr?.trim() || `Command failed: ${cmd}`;
    console.error(`\n[demo-setup] ERROR: ${msg}`);
    process.exit(1);
  }
  return result.stdout ?? "";
}

function step(label: string) {
  console.log(`\n[demo-setup] ${label}`);
}

// ── 1. Check Docker ──────────────────────────────────────────────────────────

step("Checking Docker...");
const dockerCheck = spawnSync("docker info", { shell: true, stdio: "pipe", encoding: "utf8" });
if (dockerCheck.status !== 0) {
  console.error("[demo-setup] Docker is not running. Start Docker Desktop and retry.");
  process.exit(1);
}
console.log("[demo-setup] Docker OK");

// ── 2. Boot Postgres ─────────────────────────────────────────────────────────

step("Starting Postgres (docker compose up -d postgres)...");
run("docker compose up -d postgres");

// ── 3. Wait for healthcheck (up to 30s) ──────────────────────────────────────

step("Waiting for Postgres to be ready...");
const deadline = Date.now() + 30_000;
let ready = false;

while (Date.now() < deadline) {
  const check = spawnSync(
    `docker compose exec postgres pg_isready -U atelier -d atelier`,
    { shell: true, cwd: ROOT, stdio: "pipe", encoding: "utf8" },
  );
  if (check.status === 0) {
    ready = true;
    break;
  }
  // 2s poll
  execSync("node -e \"setTimeout(()=>{},2000)\"", { cwd: ROOT });
}

if (!ready) {
  console.error("[demo-setup] Postgres did not become ready within 30s. Check `docker compose logs postgres`.");
  process.exit(1);
}
console.log("[demo-setup] Postgres ready");

// ── 4. pnpm install ───────────────────────────────────────────────────────────

if (!SKIP_INSTALL) {
  step("Installing dependencies (pnpm install)...");
  run("pnpm install");
} else {
  step("Skipping pnpm install (--skip-install)");
}

// ── 5. Prisma migrate ─────────────────────────────────────────────────────────

step("Running Prisma migrations (pnpm prisma migrate dev)...");
run("pnpm prisma migrate dev --name init");

// ── 6. Clerk env warning ──────────────────────────────────────────────────────

const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf8");
  const hasPublishable = /^CLERK_PUBLISHABLE_KEY=.+/m.test(envContent);
  const hasSecret = /^CLERK_SECRET_KEY=.+/m.test(envContent);
  if (!hasPublishable || !hasSecret) {
    console.warn(
      "\n[demo-setup] WARNING: CLERK_PUBLISHABLE_KEY or CLERK_SECRET_KEY is empty in .env.\n" +
      "  Get them at https://dashboard.clerk.com — your app -> API Keys.",
    );
  }
} else {
  console.warn(
    "\n[demo-setup] WARNING: .env not found. Copy .env.example to .env and fill in CLERK_* keys.\n" +
    "  cp .env.example .env",
  );
}

// ── 7. Done ───────────────────────────────────────────────────────────────────

console.log(
  "\n[demo-setup] Demo ready.\n" +
  "  Run `pnpm dev` and open http://localhost:3000\n",
);
