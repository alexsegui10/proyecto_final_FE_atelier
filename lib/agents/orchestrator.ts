import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  AGENT_INPUT_DEPENDENCIES,
  GENERATOR_AGENT_ORDER,
  type GeneratorAgentName,
  type PRD,
  type SharedState,
} from "./shared-state";
import {
  runGeneratorAgent,
  type GeneratorEvent,
} from "./runner-generator";

export type OrchestratorEvent =
  | GeneratorEvent
  | {
      type: "agent.handoff";
      from: GeneratorAgentName;
      to: GeneratorAgentName;
    }
  | {
      type: "agent.file_created";
      agent: GeneratorAgentName;
      path: string;
      lines: number;
    }
  | { type: "generation.started"; generationId: string }
  | { type: "generation.completed"; generationId: string; summary: string }
  | { type: "generation.failed"; generationId: string; reason: string };

export interface RunGenerationOptions {
  generationId: string;
  projectId: string;
  prd: PRD;
  workDir: string;
  promptsDir: string;
  onEvent: (event: OrchestratorEvent) => void | Promise<void>;
  /** Subset of agents to run; defaults to all 6 in order. */
  agents?: readonly GeneratorAgentName[];
}

export interface GenerationResult {
  state: SharedState;
  durationMs: number;
  filesCreated: Array<{ agent: GeneratorAgentName; path: string; lines: number }>;
  failedAt?: GeneratorAgentName;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".atelier",
  "out",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
]);

async function listFiles(root: string): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name));
        continue;
      }
      if (entry.isFile()) {
        const full = join(dir, entry.name);
        try {
          const s = await stat(full);
          result.set(relative(root, full), s.mtimeMs);
        } catch {
          /* ignore */
        }
      }
    }
  }
  await walk(root);
  return result;
}

async function countLines(path: string): Promise<number> {
  try {
    const text = await readFile(path, "utf-8");
    return text.split("\n").length;
  } catch {
    return 0;
  }
}

function buildUserPrompt(
  agent: GeneratorAgentName,
  prd: PRD,
  workDir: string,
): string {
  const dependencies = AGENT_INPUT_DEPENDENCIES[agent];
  const lines: string[] = [];
  lines.push(`Estás trabajando en el directorio actual (workDir = ${workDir}).`);
  lines.push("");
  lines.push("## PRD del proyecto");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(prd, null, 2));
  lines.push("```");
  lines.push("");
  if (dependencies.length > 0) {
    lines.push("## Artifacts ya producidos por agentes anteriores");
    lines.push("");
    lines.push("Leélos con tu tool Read antes de empezar:");
    for (const dep of dependencies) {
      lines.push(`- \`.atelier/${dep}.json\``);
    }
    lines.push("");
  }
  lines.push("## Qué tenés que hacer");
  lines.push("");
  lines.push(
    "Lee el system prompt para conocer tu rol exacto, los inputs que tenés que leer, y los archivos que tenés que escribir. Tu artifact final va en `.atelier/" +
      agent +
      ".json`. Cuando termines, imprimí la línea de stop condition exacta documentada en tu system prompt y exit.",
  );
  lines.push("");
  lines.push(
    "Recordá: los archivos los podés leer con Read, escribir con Write, editar con Edit. Bash está disponible si lo necesitás (ej. para correr `pnpm typecheck` desde QA).",
  );
  return lines.join("\n");
}

export async function runGeneration(opts: RunGenerationOptions): Promise<GenerationResult> {
  const { generationId, prd, workDir, promptsDir, onEvent } = opts;
  const agentsToRun = opts.agents ?? GENERATOR_AGENT_ORDER;
  const startedAt = Date.now();
  const state: SharedState = { prd };
  const filesCreated: GenerationResult["filesCreated"] = [];

  await onEvent({ type: "generation.started", generationId });

  let prevAgent: GeneratorAgentName | undefined;
  for (let i = 0; i < agentsToRun.length; i++) {
    const agent = agentsToRun[i];

    if (prevAgent !== undefined) {
      await onEvent({ type: "agent.handoff", from: prevAgent, to: agent });
    }

    let systemPrompt: string;
    try {
      systemPrompt = await readFile(join(promptsDir, `${agent}.md`), "utf-8");
    } catch (err) {
      const reason = `cannot read system prompt for ${agent}: ${(err as Error).message}`;
      await onEvent({ type: "generation.failed", generationId, reason });
      return {
        state,
        durationMs: Date.now() - startedAt,
        filesCreated,
        failedAt: agent,
      };
    }

    const userPrompt = buildUserPrompt(agent, prd, workDir);

    const before = await listFiles(workDir);

    let artifact;
    try {
      artifact = await runGeneratorAgent({
        agent,
        systemPrompt,
        userPrompt,
        workDir,
        onEvent,
      });
    } catch (err) {
      const reason = (err as Error).message;
      await onEvent({ type: "generation.failed", generationId, reason });
      return {
        state,
        durationMs: Date.now() - startedAt,
        filesCreated,
        failedAt: agent,
      };
    }

    const after = await listFiles(workDir);
    for (const [path, mtime] of after.entries()) {
      const beforeMtime = before.get(path);
      if (beforeMtime === undefined || mtime > beforeMtime + 50) {
        const lines = await countLines(join(workDir, path));
        filesCreated.push({ agent, path, lines });
        await onEvent({ type: "agent.file_created", agent, path, lines });
      }
    }

    switch (agent) {
      case "architect":
        state.architect = artifact.artifact as SharedState["architect"];
        break;
      case "domain-persistence":
        state.domainPersistence = artifact.artifact as SharedState["domainPersistence"];
        break;
      case "use-cases":
        state.useCases = artifact.artifact as SharedState["useCases"];
        break;
      case "auth-rbac":
        state.authRbac = artifact.artifact as SharedState["authRbac"];
        break;
      case "api-frontend":
        state.apiFrontend = artifact.artifact as SharedState["apiFrontend"];
        break;
      case "qa-reviewer":
        state.qa = artifact.artifact as SharedState["qa"];
        break;
    }

    prevAgent = agent;
  }

  const summary = state.qa?.summary ?? "completed";
  await onEvent({ type: "generation.completed", generationId, summary });

  return {
    state,
    durationMs: Date.now() - startedAt,
    filesCreated,
  };
}
