#!/usr/bin/env tsx
/**
 * `atelier` CLI — v3 step-by-step decision tool.
 *
 * Used in tandem with the orchestrator running in `--step-by-step` mode.
 * The orchestrator pauses after every wave and waits for a decision file
 * to appear inside the workDir. This CLI writes that decision.
 *
 * Commands:
 *   atelier approve <wave> [--workdir <path>]
 *   atelier reject  <wave> --reason "..." [--workdir <path>]
 *   atelier inspect <wave> [--workdir <path>]
 *   atelier waiting [--workdir <path>]      # list waves currently paused
 *
 * The --workdir flag defaults to the most recent `out/*-regen-v3-*` directory
 * (falls back to `out/v3-dryrun-tmp` for the dry-run). If multiple candidates
 * exist and --workdir isn't passed, the CLI prints them and exits 64.
 *
 * Wave names are the ones used by orchestrator-v3 (WAVES_V3):
 *   wave-1-discovery, wave-1-bootstrap, wave-1-planning,
 *   wave-2-design, wave-2-domain, wave-3-app-security,
 *   wave-4-presentation, wave-5-data-tests,
 *   wave-6-static-qa, wave-7-runtime-qa
 */
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  readPendingApproval,
  writeDecision,
} from "../lib/agents/runtime/file-based-approval";
import type { WaveNameV3 } from "../lib/agents/orchestrator-v3";

const WAVE_NAMES: readonly WaveNameV3[] = [
  "wave-1-discovery",
  "wave-1-bootstrap",
  "wave-1-planning",
  "wave-2-design",
  "wave-2-domain",
  "wave-3-app-security",
  "wave-4a-api",
  "wave-4b-frontend-arch",
  "wave-4c-components",
  "wave-4d-routing-forms-adapter",
  "wave-5-data-tests",
  "wave-6-static-qa",
  "wave-7-runtime-qa",
];

interface ParsedArgs {
  command: "approve" | "reject" | "inspect" | "waiting" | "help" | null;
  wave?: WaveNameV3;
  reason?: string;
  workDir?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) return { command: "help" };
  const cmd = argv[0];
  const out: ParsedArgs = { command: null };

  if (cmd === "approve" || cmd === "reject" || cmd === "inspect" || cmd === "waiting" || cmd === "help") {
    out.command = cmd;
  } else {
    return { command: null };
  }

  // Positional: wave name (everything except `waiting` and `help`)
  if (cmd !== "waiting" && cmd !== "help") {
    const wave = argv[1];
    if (wave && isWaveName(wave)) out.wave = wave;
  }

  // Flags
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reason") out.reason = argv[++i];
    else if (a === "--workdir") out.workDir = argv[++i];
  }

  return out;
}

function isWaveName(s: string): s is WaveNameV3 {
  return (WAVE_NAMES as readonly string[]).includes(s);
}

async function resolveWorkDir(explicit?: string): Promise<string> {
  if (explicit) return resolve(explicit);
  const outDir = resolve(__dirname, "..", "out");
  let entries: string[] = [];
  try {
    entries = await readdir(outDir);
  } catch {
    throw new Error("no out/ directory yet — start an orchestrator run first");
  }
  // Match any v3-flavoured workDir (covers test-v3-dry-run and future real runs).
  const candidates: Array<{ path: string; mtime: number }> = [];
  for (const e of entries) {
    if (!/-v3-|v3-dryrun-tmp/.test(e)) continue;
    const full = join(outDir, e);
    try {
      const s = await stat(full);
      if (s.isDirectory()) candidates.push({ path: full, mtime: s.mtimeMs });
    } catch {
      /* skip */
    }
  }
  if (candidates.length === 0) {
    throw new Error(
      "no v3 workDir found in out/. Pass --workdir <path> explicitly.",
    );
  }
  if (candidates.length > 1) {
    candidates.sort((a, b) => b.mtime - a.mtime);
    // If the freshest is much more recent (>1 min) than the next, pick it
    // automatically. Otherwise force the user to choose.
    const [first, second] = candidates;
    if (!first) throw new Error("internal: no candidate found");
    if (!second || first.mtime - second.mtime > 60_000) return first.path;
    console.error("Multiple recent v3 workDirs found — pass --workdir explicitly:");
    for (const c of candidates) console.error(`  - ${c.path}`);
    process.exit(64);
  }
  // Asserted above that candidates.length >= 1.
  const only = candidates[0];
  if (!only) throw new Error("internal: no candidate found");
  return only.path;
}

function printHelp(): void {
  console.log(
    [
      "atelier — v3 step-by-step decision tool",
      "",
      "Commands:",
      "  atelier approve <wave>          [--workdir <path>]",
      "  atelier reject  <wave> --reason \"text\" [--workdir <path>]",
      "  atelier inspect <wave>          [--workdir <path>]",
      "  atelier waiting                 [--workdir <path>]",
      "",
      "Waves:",
      `  ${WAVE_NAMES.join(", ")}`,
      "",
      "Default workDir is auto-detected from out/. Pass --workdir to override.",
    ].join("\n"),
  );
}

async function cmdApprove(workDir: string, wave: WaveNameV3): Promise<number> {
  await ensureWavePending(workDir, wave);
  const file = await writeDecision(workDir, wave, { kind: "approve" });
  console.log(`✓ approve recorded for ${wave}`);
  console.log(`  ${file}`);
  return 0;
}

async function cmdReject(workDir: string, wave: WaveNameV3, reason: string): Promise<number> {
  await ensureWavePending(workDir, wave);
  const file = await writeDecision(workDir, wave, { kind: "reject", reason });
  console.log(`✗ reject recorded for ${wave}`);
  console.log(`  reason: ${reason}`);
  console.log(`  ${file}`);
  return 0;
}

async function cmdInspect(workDir: string, wave: WaveNameV3): Promise<number> {
  const pending = await readPendingApproval(workDir, wave);
  if (!pending) {
    console.error(`No pending approval found for ${wave} in ${workDir}.`);
    console.error("Either the wave hasn't started yet or it was already decided.");
    return 1;
  }
  console.log(`▣ ${wave} (paused since ${pending.createdAt})`);
  console.log(`  agents: ${pending.agents.join(", ")}`);
  console.log(`  results:`);
  for (const r of pending.results) {
    console.log(`    - ${r.agent}: ${r.status}`);
  }
  console.log(`  hint: ${pending.hint}`);
  // Also write an "inspect" decision so the orchestrator emits wave.paused
  // and re-asks (useful when running headless — the human can keep looking
  // at the on-disk artifacts and run inspect again).
  await writeDecision(workDir, wave, { kind: "inspect" });
  return 0;
}

async function cmdWaiting(workDir: string): Promise<number> {
  console.log(`workDir: ${workDir}`);
  const found: WaveNameV3[] = [];
  for (const wave of WAVE_NAMES) {
    const pending = await readPendingApproval(workDir, wave);
    if (pending) found.push(wave);
  }
  if (found.length === 0) {
    console.log("(no waves currently paused)");
    return 0;
  }
  for (const w of found) console.log(`  ⏸  ${w}`);
  return 0;
}

async function ensureWavePending(workDir: string, wave: WaveNameV3): Promise<void> {
  const pending = await readPendingApproval(workDir, wave);
  if (pending) return;
  // Soft-warn: we still write the decision (the orchestrator may consume it
  // when it reaches the wave), but flag the situation.
  console.error(
    `⚠  ${wave} is not currently paused. Writing decision anyway — it will be picked up when the wave finishes (or ignored if it already completed).`,
  );
  if (!existsSync(workDir)) {
    throw new Error(`workDir does not exist: ${workDir}`);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === null) {
    console.error("Unknown command. Try `atelier help`.");
    return 64;
  }
  if (args.command === "help") {
    printHelp();
    return 0;
  }

  let workDir: string;
  try {
    workDir = await resolveWorkDir(args.workDir);
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    return 64;
  }

  switch (args.command) {
    case "waiting":
      return cmdWaiting(workDir);
    case "approve":
      if (!args.wave) {
        console.error("approve requires a wave name");
        return 64;
      }
      return cmdApprove(workDir, args.wave);
    case "reject":
      if (!args.wave) {
        console.error("reject requires a wave name");
        return 64;
      }
      if (!args.reason || args.reason.length === 0) {
        console.error("reject requires --reason \"text\"");
        return 64;
      }
      return cmdReject(workDir, args.wave, args.reason);
    case "inspect":
      if (!args.wave) {
        console.error("inspect requires a wave name");
        return 64;
      }
      return cmdInspect(workDir, args.wave);
  }
  return 64;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(99);
  },
);
