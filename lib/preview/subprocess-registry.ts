/**
 * Subprocess registry — singleton that tracks live preview processes.
 *
 * Lives in the Next.js server process (module-level singleton via global).
 * Uses Node.js `net` to allocate a free port in 3001–3999 without any extra
 * dependencies (no get-port, no tree-kill).
 *
 * Windows process killing: child_process.kill() only kills the top-level
 * process on Windows, not the full process tree. We use `taskkill /T /F`
 * to kill the subtree, which handles pnpm → node → next-server chains.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";

// ─── Types ────────────────────────────────────────────────────────────

export interface PreviewEntry {
  process: ChildProcess;
  port: number;
  url: string;
  startedAt: number;
}

// ─── Module-level singleton (survives hot-reload on Next.js dev) ───────

const GLOBAL_KEY = "__atelier_preview_registry__";

function getRegistry(): Map<string, PreviewEntry> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, PreviewEntry>();
  }
  return g[GLOBAL_KEY] as Map<string, PreviewEntry>;
}

export const registry = {
  get: (id: string) => getRegistry().get(id),
  set: (id: string, entry: PreviewEntry) => getRegistry().set(id, entry),
  delete: (id: string) => getRegistry().delete(id),
  has: (id: string) => getRegistry().has(id),
};

// ─── Port allocation ──────────────────────────────────────────────────

const PORT_MIN = 3001;
const PORT_MAX = 3999;

function tryBindPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function allocatePort(): Promise<number> {
  const usedPorts = new Set(
    Array.from(getRegistry().values()).map((e) => e.port),
  );
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (usedPorts.has(p)) continue;
    if (await tryBindPort(p)) return p;
  }
  throw new Error(`No free port in range ${PORT_MIN}–${PORT_MAX}`);
}

// ─── Process killing ──────────────────────────────────────────────────

export async function killProcess(child: ChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) return;
  const pid = child.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    // taskkill /T kills the whole process tree (pnpm → node → next)
    const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      shell: false,
    });
    await new Promise<void>((resolve) => killer.on("close", () => resolve()));
  } else {
    try {
      process.kill(-pid, "SIGKILL"); // kill process group
    } catch {
      child.kill("SIGKILL");
    }
  }
}

// ─── Spawn preview server ─────────────────────────────────────────────

const READY_PATTERN =
  /(?:Local:\s+http:\/\/localhost:\d+|Ready in \d|✓ Ready|ready started server)/i;
const BOOT_TIMEOUT_MS = 60_000;
export interface SpawnPreviewResult {
  url: string;
  port: number;
  process: ChildProcess;
}

export async function spawnPreview(
  generationId: string,
  workDir: string,
): Promise<SpawnPreviewResult> {
  if (!existsSync(workDir)) {
    throw new Error(`workDir does not exist: ${workDir}`);
  }

  const port = await allocatePort();

  // Skip pnpm install if node_modules already exists.
  const nodeModulesExists = existsSync(`${workDir}/node_modules`);
  if (!nodeModulesExists) {
    await runInstall(workDir);
  }

  const child = spawn(
    "pnpm",
    ["dev", "--port", String(port)],
    {
      cwd: workDir,
      env: {
        ...process.env,
        PORT: String(port),
        // Disable Prisma migrations on boot — the generated app needs a real DB.
        // For demo purposes we just boot the dev server (pages will error if DB
        // not configured, but the iframe will at least show the Next.js shell).
        SKIP_DB_MIGRATE: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      // detached only on Unix so we can kill the group; on Windows taskkill handles it
      detached: process.platform !== "win32",
    },
  );

  // Wait for the "ready" signal in stdout/stderr.
  const url = await waitForReady(child, port, BOOT_TIMEOUT_MS);

  const entry: PreviewEntry = {
    process: child,
    port,
    url,
    startedAt: Date.now(),
  };
  registry.set(generationId, entry);

  // Unref so the parent process can exit even if the child is still running.
  if (process.platform !== "win32") {
    child.unref();
  }

  return { url, port, process: child };
}

function runInstall(workDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["install", "--prefer-offline"], {
      cwd: workDir,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("pnpm install timed out (120s)"));
    }, 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`pnpm install exited with code ${code}`));
    });
  });
}

function waitForReady(
  child: ChildProcess,
  port: number,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = "";

    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      output += text;
      if (READY_PATTERN.test(output)) {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        resolve(`http://localhost:${port}`);
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Preview process exited prematurely (code ${code}). Output: ${output.slice(-500)}`,
        ),
      );
    });

    const timer = setTimeout(() => {
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      reject(
        new Error(
          `Preview server did not become ready within ${timeoutMs / 1000}s. ` +
            `Last output: ${output.slice(-300)}`,
        ),
      );
    }, timeoutMs);
  });
}
