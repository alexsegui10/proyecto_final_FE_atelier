/**
 * D2 — Deterministic `pnpm format` rescue.
 *
 * Closes the F3-run-16 dead-end (B-w6-1) where the qa-reviewer fix loop
 * sat through 3 rounds unable to dispatch a `FormatError` violation:
 * prettier --check flagged 145 files across the workspace; the fix is
 * mechanical (`pnpm format`, a one-shot command) and routing it as a
 * normal LLM-driven violation made no sense.
 *
 * The orchestrator wires this helper as a post-fix-loop step: when the
 * loop terminates `no-go` and the ONLY remaining error-severity
 * violations are `FormatError`, run `pnpm format` against the workDir
 * and re-evaluate qa-reviewer once. Converts the prettier-divergence
 * case from a no-go terminal into go without escalating to human
 * review.
 *
 * Pure-ish: spawns a subprocess against `cwd = workDir`. Test seam is
 * the `_spawn` parameter (defaults to `node:child_process.spawn`) — so
 * unit tests can inject a fake without touching the filesystem.
 */
import { spawn as defaultSpawn, type ChildProcess } from "node:child_process";

export interface FormatRescueOptions {
  /** Hard timeout in ms before SIGTERM. Default 120_000 (2 min). */
  timeoutMs?: number;
  /**
   * Subprocess spawner — defaults to `node:child_process.spawn`. The
   * narrow signature is enough for the rescue (binary + argv + cwd).
   * Tests inject a fake here to avoid touching the host machine.
   */
  _spawn?: typeof defaultSpawn;
}

/**
 * Run `pnpm format` against `workDir`. Resolves on exit code 0; rejects
 * with a descriptive Error on non-zero exit, spawn error, or timeout.
 *
 * Uses `shell: true` on the spawn call because on Windows pnpm is a
 * `.cmd` shim — without the shell flag the spawn fails with ENOENT.
 * The cost (parameter quoting) is irrelevant: workDir is an absolute
 * path the orchestrator built; pnpm format takes no user input.
 */
export async function runDeterministicFormat(
  workDir: string,
  opts: FormatRescueOptions = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const spawnFn = opts._spawn ?? defaultSpawn;

  return new Promise<void>((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawnFn("pnpm", ["format"], { cwd: workDir, shell: true });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // best-effort kill — the close/error handler still fires
      }
    }, timeoutMs);

    proc.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      // Cap accumulated stderr so a runaway prettier doesn't OOM us.
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`pnpm format timed out after ${timeoutMs}ms`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pnpm format exit ${code ?? "null"}: ${stderr.slice(0, 500)}`));
    });
  });
}
