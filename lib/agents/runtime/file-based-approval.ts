/**
 * File-based ApprovalResolver for the v3 step-by-step mode.
 *
 * The orchestrator runs in one terminal; the human types
 * `atelier approve <wave>` (or reject/inspect) in another. The two
 * processes communicate through two JSON files inside the workDir:
 *
 *   .atelier/_pending-approval-<wave>.json
 *     Written by the orchestrator AT every wave boundary. Contains the
 *     wave summary the human needs to make a call.
 *
 *   .atelier/_decision-<wave>.json
 *     Written by the human via the `atelier` CLI. Read by the orchestrator
 *     by polling. Deleted by the orchestrator once consumed.
 *
 * The decision file is the single source of truth. The orchestrator polls
 * with a configurable interval (default 1s).
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type {
  ApprovalDecision,
  ApprovalResolver,
  WaveCompletedPayload,
  WaveNameV3,
} from "../orchestrator-v3";

const APPROVAL_DIR = ".atelier";

export function pendingApprovalPath(workDir: string, wave: WaveNameV3): string {
  return join(workDir, APPROVAL_DIR, `_pending-approval-${wave}.json`);
}

export function decisionPath(workDir: string, wave: WaveNameV3): string {
  return join(workDir, APPROVAL_DIR, `_decision-${wave}.json`);
}

export interface PendingApproval {
  wave: WaveNameV3;
  agents: readonly string[];
  results: ReadonlyArray<{ agent: string; status: "ok" | "failed" }>;
  // Help text reminding the human what to type.
  hint: string;
  createdAt: string;
}

export interface CreateFileBasedResolverOptions {
  workDir: string;
  /** Poll interval in ms (default 1000). */
  pollMs?: number;
  /** Maximum time to wait for a decision before giving up (default 24h). */
  timeoutMs?: number;
  /** Optional logger — receives progress lines for user feedback. */
  log?: (msg: string) => void;
}

/**
 * Build the resolver the orchestrator will use in step-by-step mode.
 *
 * Behaviour:
 *   1. Write `_pending-approval-<wave>.json` with the wave summary.
 *   2. Poll for `_decision-<wave>.json`.
 *   3. When the file appears, parse it as ApprovalDecision and return.
 *   4. Delete both files on the way out (so the next wave starts clean).
 *
 * If the decision JSON is malformed, the file is rotated to
 * `_decision-<wave>.invalid-<timestamp>.json` and polling resumes — the
 * human can re-run the CLI to retry.
 */
export function createFileBasedApprovalResolver(
  opts: CreateFileBasedResolverOptions,
): ApprovalResolver {
  const pollMs = opts.pollMs ?? 1000;
  const timeoutMs = opts.timeoutMs ?? 24 * 60 * 60_000;
  const log = opts.log ?? (() => {});

  return async (
    wave: WaveNameV3,
    summary: WaveCompletedPayload,
  ): Promise<ApprovalDecision> => {
    await mkdir(join(opts.workDir, APPROVAL_DIR), { recursive: true });
    const pending: PendingApproval = {
      wave,
      agents: summary.agents,
      results: summary.results,
      hint: `Run: atelier approve ${wave}  |  atelier reject ${wave} --reason "..."  |  atelier inspect ${wave}`,
      createdAt: new Date().toISOString(),
    };
    const pendingFile = pendingApprovalPath(opts.workDir, wave);
    const decisionFile = decisionPath(opts.workDir, wave);

    // If an old decision lingers from a previous run, drop it.
    if (existsSync(decisionFile)) await rm(decisionFile, { force: true });

    await writeFile(pendingFile, JSON.stringify(pending, null, 2), "utf-8");
    log(`⏸  Wave "${wave}" paused. Waiting for decision via the atelier CLI.`);
    log(`    ${pending.hint}`);

    const decision = await pollForDecision({
      decisionFile,
      pollMs,
      timeoutMs,
      log,
    });

    // Always consume the decision file so future iterations don't see it
    // again. The pending file is only cleaned for approve/reject — inspect
    // leaves it because the orchestrator will re-call this resolver
    // immediately and we want the pending state to remain visible.
    if (existsSync(decisionFile)) await rm(decisionFile, { force: true });
    if (decision.kind !== "inspect") {
      if (existsSync(pendingFile)) await rm(pendingFile, { force: true });
    }

    return decision;
  };
}

interface PollOptions {
  decisionFile: string;
  pollMs: number;
  timeoutMs: number;
  log: (msg: string) => void;
}

async function pollForDecision(opts: PollOptions): Promise<ApprovalDecision> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(opts.decisionFile)) {
      try {
        const raw = await readFile(opts.decisionFile, "utf-8");
        const parsed = parseDecision(raw);
        if (parsed) return parsed;
        // Malformed → rotate and keep polling.
        const rotated = opts.decisionFile.replace(
          /\.json$/,
          `.invalid-${Date.now()}.json`,
        );
        await renameOrSwallow(opts.decisionFile, rotated);
        opts.log(
          `⚠  Decision file was malformed — rotated to ${rotated}. Re-run the atelier CLI.`,
        );
      } catch {
        // file might have been deleted between exists() and read() — keep polling
      }
    }
    await new Promise<void>((res) => setTimeout(res, opts.pollMs));
  }
  throw new Error(
    `file-based approval timed out after ${opts.timeoutMs}ms — no decision written to ${opts.decisionFile}`,
  );
}

async function renameOrSwallow(from: string, to: string): Promise<void> {
  try {
    const { rename } = await import("node:fs/promises");
    await rename(from, to);
  } catch {
    /* best effort */
  }
}

/**
 * Parse a JSON string into an ApprovalDecision. Returns null for malformed
 * input so the resolver can rotate the file and keep polling.
 */
export function parseDecision(raw: string): ApprovalDecision | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const v = json as { kind?: unknown; reason?: unknown };
  if (v.kind === "approve") return { kind: "approve" };
  if (v.kind === "inspect") return { kind: "inspect" };
  if (v.kind === "reject" && typeof v.reason === "string" && v.reason.length > 0) {
    return { kind: "reject", reason: v.reason };
  }
  return null;
}

/**
 * Write a decision file from the CLI side. Returns the absolute path
 * written so the CLI can echo it. Throws if the workDir does not
 * exist (the user is trying to decide on a wave that wasn't started).
 */
export async function writeDecision(
  workDir: string,
  wave: WaveNameV3,
  decision: ApprovalDecision,
): Promise<string> {
  const file = decisionPath(workDir, wave);
  await mkdir(join(workDir, APPROVAL_DIR), { recursive: true });
  await writeFile(file, JSON.stringify(decision, null, 2), "utf-8");
  return file;
}

/**
 * Read the pending approval written by the orchestrator. Used by the
 * `atelier inspect` subcommand. Returns null if no wave is pending.
 */
export async function readPendingApproval(
  workDir: string,
  wave: WaveNameV3,
): Promise<PendingApproval | null> {
  const file = pendingApprovalPath(workDir, wave);
  if (!existsSync(file)) return null;
  try {
    const raw = await readFile(file, "utf-8");
    return JSON.parse(raw) as PendingApproval;
  } catch {
    return null;
  }
}
