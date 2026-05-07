import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  AGENT_DEFAULT_MODEL,
  AGENT_INPUT_DEPENDENCIES,
  GENERATOR_AGENT_ORDER,
  type GeneratorAgentName,
  type PRD,
  type QaArtifact,
  type SharedState,
} from "./shared-state";
import {
  runGeneratorAgent,
  type GeneratorEvent,
} from "./runner-generator";
import {
  routeViolationsToAgents,
  type Violation,
} from "./violations-router";

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
  | {
      type: "qa.fix_round";
      round: number;
      maxRounds: number;
      violations: number;
    }
  | {
      type: "agent.fix_started";
      agent: GeneratorAgentName;
      round: number;
      violations: number;
    }
  | {
      type: "agent.fix_completed";
      agent: GeneratorAgentName;
      round: number;
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
  /** Max QA fix-loop rounds. Default 3. Set 0 to disable the fix loop. */
  maxFixRounds?: number;
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
  // Prisma client generation output — internal, not a deliverable.
  "generated",
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

/**
 * Run `pnpm exec prisma generate` in the workDir. The Prisma client is
 * auto-generated from `prisma/schema.prisma`; whenever an agent edits the
 * schema, the existing client is stale and downstream agents see TS errors
 * like `Property 'booking' does not exist on type 'PrismaClient'`. The orchestrator
 * runs this implicitly after schema-mutating agents (domain-persistence).
 *
 * Returns `true` on success. On failure, swallows — the next agent will see
 * the stale client and the QA gate will surface it as a typecheck error.
 */
async function runPrismaGenerate(workDir: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "prisma", "generate"], {
      cwd: workDir,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

const SCHEMA_TOUCHING_AGENTS: ReadonlySet<GeneratorAgentName> = new Set([
  "domain-persistence",
]);

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

function buildFixUserPrompt(
  agent: GeneratorAgentName,
  prd: PRD,
  workDir: string,
  violations: Violation[],
  round: number,
  maxRounds: number,
): string {
  const lines: string[] = [];
  lines.push(`Estás trabajando en ${workDir}.`);
  lines.push("");
  lines.push(`## RONDA DE FIX ${round}/${maxRounds} — el QA Reviewer falló`);
  lines.push("");
  lines.push(
    "El primer pase de generación produjo código que NO pasa los gates QA. Tu trabajo ahora es **arreglar SOLO las violaciones listadas abajo** sin romper lo que ya funciona. NO regeneres archivos enteros si no es necesario; usá Edit para cambios puntuales.",
  );
  lines.push("");
  lines.push("## PRD original (referencia)");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(prd, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Violaciones que te tocan a vos");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(violations, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Artifacts existentes (lee solo lo que necesites)");
  lines.push("");
  lines.push("Tu artifact previo está en `.atelier/" + agent + ".json`. Los demás:");
  for (const a of GENERATOR_AGENT_ORDER) {
    if (a !== agent) {
      lines.push(`- \`.atelier/${a}.json\``);
    }
  }
  lines.push("");
  lines.push("## Reglas de la ronda de fix");
  lines.push(
    "- Arreglá CADA violación listada. Para cada una, abrí el archivo en `where`, identificá el problema, aplicá el fix mínimo.",
  );
  lines.push(
    "- Si el fix requiere cambiar otro archivo (ej. para agregar un export), también editalo, pero documentá el cambio.",
  );
  lines.push(
    "- Cuando termines, actualizá `.atelier/" + agent + ".json` con un resumen de qué arreglaste.",
  );
  lines.push(
    "- Imprimí la MISMA línea de stop condition que la primera vez (ej. `DOMAIN_PERSISTENCE_DONE: ...`) para que el orchestrator sepa que terminaste.",
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
        model: AGENT_DEFAULT_MODEL[agent],
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

    // After agents that mutate prisma/schema.prisma, regenerate the Prisma
    // client so downstream agents see all models. Without this, agents like
    // use-cases and api-frontend hit "Property X does not exist on type
    // PrismaClient" because the generated client only knows about the
    // skeleton placeholder User model.
    if (SCHEMA_TOUCHING_AGENTS.has(agent)) {
      await runPrismaGenerate(workDir);
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

  // QA fix loop — only if QA gave no-go and maxFixRounds > 0.
  const maxFixRounds = opts.maxFixRounds ?? 3;
  if (
    state.qa &&
    state.qa.decision === "no-go" &&
    maxFixRounds > 0 &&
    !agentsToRun.includes("qa-reviewer") === false
  ) {
    let qaRound = state.qa;
    for (let round = 1; round <= maxFixRounds; round++) {
      const { byAgent } = routeViolationsToAgents(qaRound);
      if (byAgent.size === 0) break; // nothing routeable to fix; bail.

      const totalRouted = Array.from(byAgent.values()).reduce(
        (n, list) => n + list.length,
        0,
      );
      await onEvent({
        type: "qa.fix_round",
        round,
        maxRounds: maxFixRounds,
        violations: totalRouted,
      });

      // Re-invoke each responsible agent in dependency order so a fix in
      // domain-persistence is visible to use-cases before its fixer runs.
      for (const agent of GENERATOR_AGENT_ORDER) {
        if (agent === "qa-reviewer") continue;
        const violations = byAgent.get(agent);
        if (!violations || violations.length === 0) continue;

        let fixSystemPrompt: string;
        try {
          fixSystemPrompt = await readFile(join(promptsDir, `${agent}.md`), "utf-8");
        } catch {
          continue;
        }
        const fixUserPrompt = buildFixUserPrompt(
          agent,
          prd,
          workDir,
          violations,
          round,
          maxFixRounds,
        );

        await onEvent({
          type: "agent.fix_started",
          agent,
          round,
          violations: violations.length,
        });
        const before = await listFiles(workDir);
        try {
          await runGeneratorAgent({
            agent,
            systemPrompt: fixSystemPrompt,
            userPrompt: fixUserPrompt,
            workDir,
            onEvent,
            model: AGENT_DEFAULT_MODEL[agent],
          });
        } catch (err) {
          // Don't abort the whole fix loop on one agent failure — log and
          // continue. QA will surface the remaining issues.
          await onEvent({
            type: "agent.fix_completed",
            agent,
            round,
          });
          void err;
          continue;
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
        if (SCHEMA_TOUCHING_AGENTS.has(agent)) {
          await runPrismaGenerate(workDir);
        }
        await onEvent({ type: "agent.fix_completed", agent, round });
      }

      // Re-run QA after all fixers finished this round.
      let qaSystemPrompt: string;
      try {
        qaSystemPrompt = await readFile(join(promptsDir, "qa-reviewer.md"), "utf-8");
      } catch (err) {
        const reason = `cannot read qa-reviewer prompt for fix round ${round}: ${(err as Error).message}`;
        await onEvent({ type: "generation.failed", generationId, reason });
        return {
          state,
          durationMs: Date.now() - startedAt,
          filesCreated,
          failedAt: "qa-reviewer",
        };
      }
      try {
        const qaArtifact = await runGeneratorAgent<QaArtifact>({
          agent: "qa-reviewer",
          systemPrompt: qaSystemPrompt,
          userPrompt: buildUserPrompt("qa-reviewer", prd, workDir),
          workDir,
          onEvent,
          model: AGENT_DEFAULT_MODEL["qa-reviewer"],
        });
        qaRound = qaArtifact.artifact;
        state.qa = qaRound;
      } catch (err) {
        // QA itself failed — bail out, the user gets a partial result.
        const reason = `qa-reviewer crashed in fix round ${round}: ${(err as Error).message}`;
        await onEvent({ type: "generation.failed", generationId, reason });
        return {
          state,
          durationMs: Date.now() - startedAt,
          filesCreated,
          failedAt: "qa-reviewer",
        };
      }

      if (qaRound.decision === "go") break;
    }
  }

  const summary = state.qa?.summary ?? "completed";
  await onEvent({ type: "generation.completed", generationId, summary });

  return {
    state,
    durationMs: Date.now() - startedAt,
    filesCreated,
  };
}
