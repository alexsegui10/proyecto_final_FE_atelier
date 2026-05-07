import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentModel, GeneratorAgentName } from "./shared-state";

export type GeneratorEvent =
  | { type: "agent.started"; agent: GeneratorAgentName }
  | { type: "agent.stdout"; agent: GeneratorAgentName; chunk: string }
  | { type: "agent.completed"; agent: GeneratorAgentName; summary: string }
  | { type: "agent.failed"; agent: GeneratorAgentName; reason: string };

export interface RunGeneratorAgentOptions {
  agent: GeneratorAgentName;
  systemPrompt: string;
  userPrompt: string;
  workDir: string;
  onEvent: (event: GeneratorEvent) => void | Promise<void>;
  /** Per-agent timeout in ms. Default 6 minutes. */
  timeoutMs?: number;
  /**
   * Model alias to pass to `claude --model`. Sonnet is ~5x faster than Opus
   * at lower quality; use it for mechanical agents. Omit to use the user's
   * default (typically Opus).
   */
  model?: AgentModel;
}

export interface AgentArtifact<T = unknown> {
  agent: GeneratorAgentName;
  artifact: T;
  /** Final stop-condition line emitted on stdout (e.g. "ARCHITECT_DONE: 4 features"). */
  summary: string;
  /** Path to the `.atelier/<agent>.json` file. */
  artifactPath: string;
  /** Wall-clock duration of the agent run in ms. */
  durationMs: number;
}

const ANSI_ESCAPE_RE = /\[[0-9;?]*[A-Za-z]/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

function expectedSummaryPrefix(agent: GeneratorAgentName): string {
  switch (agent) {
    case "architect":
      return "ARCHITECT_DONE";
    case "domain-persistence":
      return "DOMAIN_PERSISTENCE_DONE";
    case "use-cases":
      return "USE_CASES_DONE";
    case "auth-rbac":
      return "AUTH_RBAC_DONE";
    case "api-frontend":
      return "API_FRONTEND_DONE";
    case "qa-reviewer":
      return "QA_REVIEWER_DONE";
  }
}

/**
 * Run a single generator agent as a fresh `claude` subprocess inside `workDir`.
 *
 * The agent has Claude Code's default tool set available (Read/Write/Edit/Bash)
 * scoped to its cwd, so it can edit skeleton files and write the artifact JSON
 * itself.
 */
export async function runGeneratorAgent<T = unknown>(
  opts: RunGeneratorAgentOptions,
): Promise<AgentArtifact<T>> {
  const { agent, systemPrompt, userPrompt, workDir, onEvent } = opts;
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
  const startedAt = Date.now();

  await onEvent({ type: "agent.started", agent });

  const executable = process.platform === "win32" ? "claude.exe" : "claude";
  const args = [
    "--print",
    "--no-session-persistence",
    "--output-format",
    "text",
    "--system-prompt",
    systemPrompt,
    "--permission-mode",
    "bypassPermissions",
  ];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  args.push(userPrompt);

  const child = spawn(executable, args, {
    cwd: workDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuf = "";
  let stderrBuf = "";

  child.stdout.setEncoding("utf-8");
  child.stderr.setEncoding("utf-8");

  child.stdout.on("data", async (chunk: string) => {
    const clean = stripAnsi(chunk);
    if (clean.length === 0) return;
    stdoutBuf += clean;
    await onEvent({ type: "agent.stdout", agent, chunk: clean });
  });
  child.stderr.on("data", (chunk: string) => {
    stderrBuf += chunk;
  });

  let killedByTimeout = false;
  const timeout = setTimeout(() => {
    killedByTimeout = true;
    child.kill();
  }, timeoutMs);

  const exitCode = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode);
    else child.once("close", (code) => resolve(code));
  });
  clearTimeout(timeout);

  // Tolerant timeout: if the artifact JSON exists and parses, the agent
  // finished its work — claude was just slow to print trailing tokens or
  // exit cleanly. Treat as success-with-warning rather than failing the
  // whole generation. Empirically this catches api-frontend at ~15-18 min
  // when the work itself is done by minute 13-14.
  if (killedByTimeout) {
    const artifactPath = join(workDir, ".atelier", `${agent}.json`);
    let artifactSurvived = false;
    try {
      const raw = await readFile(artifactPath, "utf-8");
      JSON.parse(raw);
      artifactSurvived = true;
    } catch {
      artifactSurvived = false;
    }
    if (!artifactSurvived) {
      const reason = `agent ${agent} timed out after ${timeoutMs}ms (no artifact written)`;
      await onEvent({ type: "agent.failed", agent, reason });
      throw new Error(reason);
    }
    await onEvent({
      type: "agent.stdout",
      agent,
      chunk: `[atelier] ${agent} timed out after ${timeoutMs}ms but artifact JSON is on disk and parseable; accepting as success.\n`,
    });
  }
  if (!killedByTimeout && exitCode !== 0) {
    const reason = `agent ${agent} exited with code ${exitCode}: ${stderrBuf.slice(0, 600)}`;
    await onEvent({ type: "agent.failed", agent, reason });
    throw new Error(reason);
  }

  // Find the stop-condition line (last line starting with the expected prefix).
  const prefix = expectedSummaryPrefix(agent);
  const summaryLine =
    stdoutBuf
      .split("\n")
      .map((l) => l.trim())
      .reverse()
      .find((l) => l.startsWith(prefix)) ?? "";

  const artifactPath = join(workDir, ".atelier", `${agent}.json`);
  let artifact: T;
  try {
    const raw = await readFile(artifactPath, "utf-8");
    artifact = JSON.parse(raw) as T;
  } catch (err) {
    const reason = `agent ${agent} did not produce ${artifactPath}: ${(err as Error).message}`;
    await onEvent({ type: "agent.failed", agent, reason });
    throw new Error(reason);
  }

  await onEvent({
    type: "agent.completed",
    agent,
    summary: summaryLine || `${prefix}: (no summary line)`,
  });

  return {
    agent,
    artifact,
    summary: summaryLine,
    artifactPath,
    durationMs: Date.now() - startedAt,
  };
}
