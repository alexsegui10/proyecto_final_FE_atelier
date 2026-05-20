/**
 * Atelier v2 generator-agent runner.
 *
 * Spawns a fresh `claude` subprocess per agent inside the workDir, feeds it
 * the agent's system prompt + a user prompt that bundles the context
 * artifacts produced by upstream agents, captures stdout for the stop
 * sentinel, and reads the JSON artifact the agent wrote to .atelier/.
 *
 * Differences vs v1 runner-generator.ts:
 *   - 17 v2 agent names + per-agent timeouts + stop sentinels (AGENT_CONFIG_V2)
 *   - Returns `{ status: 'completed' | 'timeout' | 'failed' }` instead of throwing
 *   - Detects ALL files written by the agent via mtime snapshot before/after
 *   - Optional Zod-style validator on the artifact (validateArtifact callback)
 *   - Test seam (`_executor`) lets unit tests stub the subprocess entirely
 *
 * v1 runner is left untouched per the no-breaking-v1 constraint.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import type { AgentNameV2 } from "../violations-router-v2";

// ─── Public types ───────────────────────────────────────────────────

export type AgentRunStatus = "completed" | "timeout" | "failed";

export type AgentEvent =
  | { type: "started"; agent: AgentNameV2 }
  | { type: "stdout"; agent: AgentNameV2; chunk: string }
  | { type: "file_created"; agent: AgentNameV2; path: string; lines: number }
  | {
      type: "completed";
      agent: AgentNameV2;
      stopSentinel: string | null;
      durationMs: number;
    }
  | { type: "timeout"; agent: AgentNameV2; durationMs: number; artifactSurvived: boolean }
  | { type: "failed"; agent: AgentNameV2; reason: string };

export interface GeneratorAgentInput {
  agent: AgentNameV2;
  /**
   * Inline system prompt text (not a path). The caller loads the .md file from
   * `lib/agents/prompts-v2/<agent>.md` themselves — keeping I/O at the edge
   * makes the runner trivially testable.
   */
  systemPrompt: string;
  /**
   * Artifacts from upstream agents (e.g. {discovery: {...}, architect: {...}}).
   * Serialized into the user prompt as a "Context from previous agents" section.
   */
  contextArtifacts?: Record<string, unknown>;
  /**
   * Workspace root the agent operates in (its cwd inside the subprocess).
   * Files written by the agent are detected here via mtime diff.
   */
  workDir: string;
  /**
   * Where the runner reads `.atelier/<agent>.json` from after the run.
   * Defaults to `<workDir>/.atelier`.
   */
  artifactsDir?: string;
  /**
   * Override the default `<agent>.json` filename. Use when the agent's
   * prompt writes a differently-named primary artifact (e.g. the v2
   * Domain Modeler writes `domain-model.json`). Pass `false` to skip
   * artifact loading entirely — useful for agents that emit multiple
   * sibling files where the validation pass happens outside the runner.
   */
  artifactFile?: string | false;
  generationId?: string;
  emitEvent?: (event: AgentEvent) => Promise<void> | void;
  timeoutMs?: number;
  model?: "opus" | "sonnet";
  /** Returns null if valid, otherwise an error message. */
  validateArtifact?: (artifact: unknown) => string | null;
  /** Test seam — replaces the subprocess executor. */
  _executor?: SubprocessExecutor;
  /** Test seam — replaces the file-tree walker (so tests can fake mtime diffs). */
  _walkFiles?: (root: string) => Promise<Map<string, number>>;
  /** Test seam — replaces fs.readFile when reading the artifact. */
  _readArtifact?: (path: string) => Promise<string>;
  /**
   * v3 escape hatch: forward an explicit per-agent config so the runner can
   * handle agents NOT present in `AGENT_CONFIG_V2` (e.g. v3 net-new agents
   * like `bootstrap-devops`). When set, this overrides the V2 lookup
   * entirely. Existing v2 callers don't pass it — behaviour is unchanged.
   */
  configOverride?: AgentConfigEntry;
}

export interface GeneratorAgentResult {
  agent: AgentNameV2;
  status: AgentRunStatus;
  artifact: unknown;
  filesCreated: Array<{ path: string; lines: number }>;
  durationMs: number;
  stopSentinel: string | null;
  error?: string;
}

// ─── Per-agent config ───────────────────────────────────────────────

export interface AgentConfigEntry {
  timeoutMs: number;
  model: "opus" | "sonnet";
  stopSentinel: string;
}

export const AGENT_CONFIG_V2: Record<AgentNameV2, AgentConfigEntry> = {
  // Wave 1
  discovery: { timeoutMs: 5 * 60_000, model: "opus", stopSentinel: "DISCOVERY_DONE" },
  architect: { timeoutMs: 5 * 60_000, model: "opus", stopSentinel: "ARCHITECT_DONE" },
  "ux-ui-designer": { timeoutMs: 8 * 60_000, model: "opus", stopSentinel: "UX_UI_DESIGNER_DONE" },

  // Wave 2
  "domain-modeler": { timeoutMs: 8 * 60_000, model: "opus", stopSentinel: "DOMAIN_MODELER_DONE" },
  // Bumped 8→15min after Day-5 run 3 timed out at exactly 8m. Persistence
  // generates 4 models + repos + DTOs + mappers + prisma schema; the workload
  // legitimately needs more headroom on yoga-scale PRDs.
  persistence: { timeoutMs: 15 * 60_000, model: "opus", stopSentinel: "PERSISTENCE_DONE" },
  "seeds-shape": { timeoutMs: 4 * 60_000, model: "opus", stopSentinel: "SEEDS_SHAPE_DONE" },

  // Wave 3 — service-layer 15→22 + auth-security 12→18: bumped after
  // F3-run-18 systemic slowness (claude.exe / API latency, observed +50%
  // baseline across the pipeline; both agents landed at 69-73% of their
  // prior caps and would have crossed under further variance).
  "service-layer": { timeoutMs: 22 * 60_000, model: "opus", stopSentinel: "SERVICE_LAYER_DONE" },
  "auth-security": { timeoutMs: 18 * 60_000, model: "opus", stopSentinel: "AUTH_SECURITY_DONE" },
  "rbac-authorization": {
    timeoutMs: 8 * 60_000,
    model: "opus",
    stopSentinel: "RBAC_AUTHORIZATION_DONE",
  },

  // Wave 4 — bumped after Day-5 run 4: frontend-architect, ui-components,
  // forms-validations all timed out at their original limits. UI Components
  // generates ALL shadcn primitives + variants for ~28 components and
  // legitimately needs the bigger envelope.
  // api-backend 20→30: bumped after F3-run-18 hard timeout at 1200s (the
  // agent was still emitting route handlers when killed). Baseline run-16
  // was 571s; run-18 hit the 20min ceiling with 16 routes already written
  // but no api-contract.json / sentinel. Buffer = 1.5× run-18 observed.
  "api-backend": { timeoutMs: 30 * 60_000, model: "opus", stopSentinel: "API_BACKEND_DONE" },
  "frontend-architect": {
    timeoutMs: 18 * 60_000,
    model: "opus",
    stopSentinel: "FRONTEND_ARCHITECT_DONE",
  },
  "ui-components": { timeoutMs: 35 * 60_000, model: "opus", stopSentinel: "UI_COMPONENTS_DONE" },
  // forms-validations 18→24: bumped preemptive after F3-run-19 hit 876s
  // (= 81% of the 18min cap, dangerously close to timeout under any
  // further variance). Sibling agent of ui-components in wave-4c — both
  // share the same parallel slot and have been observed slowest in the
  // run-18/19 systemic-slowdown window.
  "forms-validations": {
    timeoutMs: 24 * 60_000,
    model: "opus",
    stopSentinel: "FORMS_VALIDATIONS_DONE",
  },
  "pages-routing": { timeoutMs: 15 * 60_000, model: "opus", stopSentinel: "PAGES_ROUTING_DONE" },

  // Wave 5 — seeds-fixtures bumped after Day-5 wave-5 timeout (yoga PRD ⇒
  // 16 users + classes + bookings + memberships seed graph is non-trivial).
  "seeds-fixtures": { timeoutMs: 15 * 60_000, model: "opus", stopSentinel: "SEEDS_FIXTURES_DONE" },
  "tests-writer": { timeoutMs: 20 * 60_000, model: "opus", stopSentinel: "TESTS_WRITER_DONE" },

  // Wave 6
  "qa-reviewer": { timeoutMs: 25 * 60_000, model: "opus", stopSentinel: "QA_REVIEWER_DONE" },
};

// ─── Subprocess executor ────────────────────────────────────────────

export interface SubprocessExecutorInput {
  executable: string;
  args: string[];
  workDir: string;
  timeoutMs: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SubprocessExecutorResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  killedByTimeout: boolean;
}

export type SubprocessExecutor = (input: SubprocessExecutorInput) => Promise<SubprocessExecutorResult>;

// Strips both the ESC introducer (\x1b) and the CSI sequence that follows.
const ANSI_ESCAPE_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

/**
 * Default executor: spawn `claude` (or `claude.exe` on Windows) directly,
 * stream stdout/stderr, kill on timeout. Designed so the rest of the runner
 * stays pure and unit-testable via `_executor` injection.
 */
const defaultExecutor: SubprocessExecutor = async (input) => {
  return new Promise<SubprocessExecutorResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let killedByTimeout = false;

    const child: ChildProcess = spawn(input.executable, input.args, {
      cwd: input.workDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");

    child.stdout?.on("data", (chunk: string) => {
      const clean = stripAnsi(chunk);
      stdout += clean;
      input.onStdout?.(clean);
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      input.onStderr?.(chunk);
    });

    const timeout = setTimeout(() => {
      killedByTimeout = true;
      child.kill();
    }, input.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code, stdout, stderr, killedByTimeout });
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ exitCode: null, stdout, stderr, killedByTimeout });
    });
  });
};

// ─── Pure helpers (exported for tests) ──────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "out",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
  ".turbo",
  ".cache",
  "generated", // Prisma client
]);

/**
 * Walk a directory tree, returning a map of POSIX-relative path → mtime.
 * Skips heavy/derived directories. Used for before/after diffing to detect
 * which files an agent wrote.
 */
export async function walkFiles(root: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  async function inner(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
      const childPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await inner(childPath);
        continue;
      }
      if (entry.isFile()) {
        try {
          const s = await stat(childPath);
          out.set(relative(root, childPath).replace(/\\/g, "/"), s.mtimeMs);
        } catch {
          /* ignore — file might have vanished mid-scan */
        }
      }
    }
  }
  await inner(root);
  return out;
}

/**
 * Files written or updated between `before` and `after`. Slack of 50ms
 * absorbs filesystem mtime quantization.
 */
export function diffFiles(
  before: Map<string, number>,
  after: Map<string, number>,
): string[] {
  const out: string[] = [];
  for (const [path, mtime] of after) {
    const prev = before.get(path);
    if (prev === undefined || mtime > prev + 50) out.push(path);
  }
  return out.sort();
}

/**
 * Find the LAST line of stdout starting with `prefix`, trimmed. Returns null
 * if no line matches — that's the "agent didn't emit its sentinel" signal.
 */
export function findStopSentinel(stdout: string, prefix: string): string | null {
  const cleaned = stripAnsi(stdout);
  const lines = cleaned.split("\n").map((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.startsWith(prefix)) return lines[i] ?? null;
  }
  return null;
}

/**
 * Build the `claude` CLI args. Exported for testing the model/sonnet flag.
 * Agent's user prompt is the LAST positional arg.
 */
export function buildClaudeArgs(input: {
  systemPrompt: string;
  userPrompt: string;
  model?: "opus" | "sonnet";
}): string[] {
  const args = [
    "--print",
    "--no-session-persistence",
    "--output-format",
    "text",
    "--system-prompt",
    input.systemPrompt,
    "--permission-mode",
    "bypassPermissions",
  ];
  if (input.model) args.push("--model", input.model);
  args.push(input.userPrompt);
  return args;
}

/**
 * Compose the user-side prompt: a short header pointing at the workDir, a
 * LIST of context artifact PATHS (NOT inline JSON — the agent reads them via
 * its Read tool), and the canonical "do your job + emit sentinel + write
 * artifact" instructions.
 *
 * Why path-list instead of inline JSON: Windows command-line length limit is
 * ~8191 chars. With 4+ context artifacts inlined, the user prompt easily
 * exceeds 30KB and `spawn` fails with ENAMETOOLONG. The agent has a Read
 * tool — it can fetch each artifact itself.
 *
 * `contextArtifacts` keys map to file names in `.atelier/<key>.json`. The
 * VALUES are unused (kept in the type for API compatibility), but if a
 * caller wants to inline a SHORT artifact for tighter loops, the
 * `inlineArtifactsBelowBytes` knob accepts that.
 */
export function buildUserPrompt(input: {
  agent: AgentNameV2;
  workDir: string;
  contextArtifacts?: Record<string, unknown>;
  additionalInstructions?: string;
  /** Inline artifacts whose serialized JSON is shorter than this threshold. Default: 0 (never inline). */
  inlineArtifactsBelowBytes?: number;
  /**
   * Filename (under `.atelier/`) the agent should write its primary artifact
   * to. Defaults to `<agent>.json`. When the caller's `artifactFile` differs
   * from the agent name (e.g. service-layer → services.json), THIS must be
   * forwarded — otherwise the user prompt would override the system prompt
   * and the LLM writes to the wrong file.
   */
  artifactFilename?: string;
}): string {
  const { agent, workDir, contextArtifacts, additionalInstructions } = input;
  const artifactFilename = input.artifactFilename ?? `${agent}.json`;
  const inlineThreshold = input.inlineArtifactsBelowBytes ?? 0;
  const lines: string[] = [];
  lines.push(`Estás trabajando en el directorio actual (workDir = ${workDir}).`);
  lines.push("");
  if (contextArtifacts && Object.keys(contextArtifacts).length > 0) {
    lines.push("## Context from previous agents");
    lines.push("");
    lines.push(
      "Read these files with your Read tool BEFORE writing anything. They contain the upstream artifacts you depend on:",
    );
    lines.push("");
    for (const [key, value] of Object.entries(contextArtifacts)) {
      const serialized = JSON.stringify(value);
      if (inlineThreshold > 0 && serialized.length < inlineThreshold) {
        lines.push(`### \`.atelier/${key}.json\` (inlined for convenience)`);
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(value, null, 2));
        lines.push("```");
      } else {
        lines.push(`- \`.atelier/${key}.json\``);
      }
      lines.push("");
    }
  } else {
    lines.push("## Context");
    lines.push("");
    lines.push("(no previous artifacts — you are the first agent in the wave)");
    lines.push("");
  }
  if (additionalInstructions && additionalInstructions.length > 0) {
    lines.push("## Extra instructions");
    lines.push("");
    lines.push(additionalInstructions);
    lines.push("");
  }
  lines.push("## What to do");
  lines.push("");
  lines.push(
    `Read your system prompt for your role + outputs. Write your artifact to \`.atelier/${artifactFilename}\` (create the directory if needed). When done, print EXACTLY the stop sentinel documented in your system prompt and exit.`,
  );
  lines.push("");
  lines.push(
    "Use Read/Write/Edit/Bash as needed. Bash is available for running pnpm commands inside the workDir.",
  );
  return lines.join("\n");
}

// ─── Main entry ─────────────────────────────────────────────────────

const FAILURE_RESULT = (
  agent: AgentNameV2,
  reason: string,
  durationMs: number,
  stopSentinel: string | null = null,
  filesCreated: GeneratorAgentResult["filesCreated"] = [],
): GeneratorAgentResult => ({
  agent,
  status: "failed",
  artifact: null,
  filesCreated,
  durationMs,
  stopSentinel,
  error: reason,
});

export async function runGeneratorAgentV2(
  input: GeneratorAgentInput,
): Promise<GeneratorAgentResult> {
  // v2 default: read from the static config table by agent name. v3 callers
  // can pass `configOverride` for agents that don't live in V2.
  const config = input.configOverride ?? AGENT_CONFIG_V2[input.agent];
  if (!config) {
    throw new Error(
      `runGeneratorAgentV2: no config for agent "${input.agent}" — pass configOverride for v3 agents`,
    );
  }
  const timeoutMs = input.timeoutMs ?? config.timeoutMs;
  const model = input.model ?? config.model;
  const artifactsDir = input.artifactsDir ?? join(input.workDir, ".atelier");
  const skipArtifactLoad = input.artifactFile === false;
  const artifactFilename =
    typeof input.artifactFile === "string" ? input.artifactFile : `${input.agent}.json`;
  const artifactPath = join(artifactsDir, artifactFilename);
  const emit = input.emitEvent ?? (async () => {});
  const executor = input._executor ?? defaultExecutor;
  const walk = input._walkFiles ?? walkFiles;
  const readArt = input._readArtifact ?? ((p: string) => readFile(p, "utf-8"));
  const startedAt = Date.now();

  await emit({ type: "started", agent: input.agent });

  // Snapshot files BEFORE the agent runs so we can detect what it wrote.
  const before = await walk(input.workDir);

  const userPrompt = buildUserPrompt({
    agent: input.agent,
    workDir: input.workDir,
    ...(input.contextArtifacts ? { contextArtifacts: input.contextArtifacts } : {}),
    // Forward the actual filename so the user prompt doesn't tell the LLM to
    // write to `<agent>.json` when the runner expects a different name (e.g.
    // service-layer→services.json, qa-reviewer→qa-report.json). If the caller
    // passed `false` to skip primary load, fall back to the default name.
    ...(typeof input.artifactFile === "string" ? { artifactFilename: input.artifactFile } : {}),
  });
  const args = buildClaudeArgs({ systemPrompt: input.systemPrompt, userPrompt, model });
  const executable = process.platform === "win32" ? "claude.exe" : "claude";

  const exec = await executor({
    executable,
    args,
    workDir: input.workDir,
    timeoutMs,
    onStdout: (chunk) => void emit({ type: "stdout", agent: input.agent, chunk }),
  });

  const durationMs = Date.now() - startedAt;

  // Tolerant timeout: if the artifact JSON was written and parses, accept the run.
  if (exec.killedByTimeout) {
    let artifactSurvived = false;
    if (skipArtifactLoad) {
      artifactSurvived = true; // we don't care about a primary artifact for this agent
    } else {
      try {
        const raw = await readArt(artifactPath);
        JSON.parse(raw);
        artifactSurvived = true;
      } catch {
        artifactSurvived = false;
      }
    }
    await emit({
      type: "timeout",
      agent: input.agent,
      durationMs,
      artifactSurvived,
    });
    if (!artifactSurvived) {
      return {
        agent: input.agent,
        status: "timeout",
        artifact: null,
        filesCreated: [],
        durationMs,
        stopSentinel: null,
        error: `agent timed out after ${timeoutMs}ms with no artifact on disk`,
      };
    }
    // fall through to read artifact + emit completed (with timeout flag noted in event)
  }

  // Hard failure: subprocess exit != 0 and not a tolerated timeout.
  if (!exec.killedByTimeout && exec.exitCode !== 0) {
    const reason = `agent ${input.agent} exited with code ${exec.exitCode}: ${exec.stderr.slice(0, 600)}`;
    await emit({ type: "failed", agent: input.agent, reason });
    return FAILURE_RESULT(input.agent, reason, durationMs);
  }

  // Read the JSON artifact the agent wrote (skip when artifactFile === false).
  let artifact: unknown = null;
  if (!skipArtifactLoad) {
    try {
      const raw = await readArt(artifactPath);
      artifact = JSON.parse(raw);
    } catch (err) {
      const reason = `agent ${input.agent} did not produce ${artifactPath}: ${(err as Error).message}`;
      await emit({ type: "failed", agent: input.agent, reason });
      return FAILURE_RESULT(input.agent, reason, durationMs);
    }

    // Optional schema validation only when we have an artifact to validate.
    if (input.validateArtifact) {
      const err = input.validateArtifact(artifact);
      if (err) {
        const reason = `artifact failed schema validation: ${err}`;
        await emit({ type: "failed", agent: input.agent, reason });
        return FAILURE_RESULT(input.agent, reason, durationMs);
      }
    }
  }

  // Detect files written by the agent + emit one event per file.
  const after = await walk(input.workDir);
  const changedRel = diffFiles(before, after);
  const filesCreated: GeneratorAgentResult["filesCreated"] = [];
  for (const rel of changedRel) {
    let lines = 0;
    try {
      const text = await readFile(join(input.workDir, rel), "utf-8");
      lines = text.split("\n").length;
    } catch {
      /* if file vanished, count stays 0 */
    }
    filesCreated.push({ path: rel, lines });
    await emit({ type: "file_created", agent: input.agent, path: rel, lines });
  }

  // Stop sentinel detection.
  const stopSentinel = findStopSentinel(exec.stdout, config.stopSentinel);

  // No sentinel + no timeout = the agent didn't follow the contract → failed.
  if (stopSentinel === null && !exec.killedByTimeout) {
    const reason = `agent ${input.agent} did not emit ${config.stopSentinel} on stdout`;
    await emit({ type: "failed", agent: input.agent, reason });
    return FAILURE_RESULT(input.agent, reason, durationMs, null, filesCreated);
  }

  await emit({
    type: "completed",
    agent: input.agent,
    stopSentinel,
    durationMs,
  });

  return {
    agent: input.agent,
    status: "completed",
    artifact,
    filesCreated,
    durationMs,
    stopSentinel,
  };
}
