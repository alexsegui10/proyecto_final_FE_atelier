/**
 * Atelier v2 orchestrator — coordinates 17 specialized agents across 6 waves.
 *
 * Lives alongside the v1 orchestrator (`./orchestrator.ts`); the v1 path is
 * untouched so the existing fix-and-deploy pipeline keeps working. Switch
 * callers to `runGenerationV2` when ready.
 *
 * Wave dependency graph (declared in WAVES_V2):
 *
 *   wave-1-discovery     ← chat phase output (consumed, not produced here)
 *      ↓
 *   wave-1-planning      (architect)
 *      ↓
 *   wave-1-design        (ux-ui-designer)
 *      ↓
 *   wave-2-domain        (domain-modeler ‖ persistence ‖ seeds-shape)
 *      ↓
 *   wave-3-app-security  (service-layer ‖ auth-security ‖ rbac-authorization)
 *      ↓
 *   wave-4-presentation  (api-backend ‖ frontend-architect ‖ ui-components ‖
 *                         forms-validations ‖ pages-routing)
 *      ↓
 *   wave-5-data-tests    (seeds-fixtures ‖ tests-writer)
 *      ↓
 *   wave-6-validation    (qa-reviewer + fix loop)
 *
 * Agents within a wave run in PARALLEL via Promise.all. The orchestrator
 * waits for the entire wave to settle before moving on; this trades a bit of
 * critical-path lat for simpler dependency reasoning.
 */
import {
  routeViolationToAgent,
  type AgentNameV2,
} from "./violations-router-v2";

export type WaveName =
  | "wave-1-discovery"
  | "wave-1-planning"
  | "wave-1-design"
  | "wave-2-domain"
  | "wave-3-app-security"
  | "wave-4-presentation"
  | "wave-5-data-tests"
  | "wave-6-validation";

export interface Wave {
  readonly name: WaveName;
  readonly agents: readonly AgentNameV2[];
  readonly dependsOn: readonly WaveName[];
}

export const WAVES_V2: readonly Wave[] = [
  {
    name: "wave-1-discovery",
    agents: ["discovery"],
    dependsOn: [],
  },
  {
    name: "wave-1-planning",
    agents: ["architect"],
    dependsOn: ["wave-1-discovery"],
  },
  {
    name: "wave-1-design",
    agents: ["ux-ui-designer"],
    dependsOn: ["wave-1-planning"],
  },
  {
    name: "wave-2-domain",
    agents: ["domain-modeler", "persistence", "seeds-shape"],
    dependsOn: ["wave-1-design"],
  },
  {
    name: "wave-3-app-security",
    agents: ["service-layer", "auth-security", "rbac-authorization"],
    dependsOn: ["wave-2-domain"],
  },
  {
    name: "wave-4-presentation",
    agents: [
      "api-backend",
      "frontend-architect",
      "ui-components",
      "forms-validations",
      "pages-routing",
    ],
    dependsOn: ["wave-3-app-security"],
  },
  {
    name: "wave-5-data-tests",
    agents: ["seeds-fixtures", "tests-writer"],
    dependsOn: ["wave-4-presentation"],
  },
  {
    name: "wave-6-validation",
    agents: ["qa-reviewer"],
    dependsOn: ["wave-5-data-tests"],
  },
] as const;

/** Returns the canonical execution order of all v2 agents. */
export function generatorAgentOrderV2(): readonly AgentNameV2[] {
  const seen = new Set<AgentNameV2>();
  const out: AgentNameV2[] = [];
  for (const wave of WAVES_V2) {
    for (const agent of wave.agents) {
      if (seen.has(agent)) continue;
      seen.add(agent);
      out.push(agent);
    }
  }
  return out;
}

// ─── Events ──────────────────────────────────────────────────────────

export type OrchestratorV2Event =
  | { type: "generation.started"; generationId: string }
  | { type: "generation.completed"; generationId: string; summary: string }
  | { type: "generation.failed"; generationId: string; reason: string }
  | {
      type: "wave.started";
      wave: WaveName;
      agents: readonly AgentNameV2[];
      startedAt: number;
    }
  | {
      type: "wave.completed";
      wave: WaveName;
      durationMs: number;
      results: ReadonlyArray<{ agent: AgentNameV2; status: "ok" | "failed" }>;
    }
  | { type: "agent.started"; agent: AgentNameV2; wave: WaveName }
  | {
      type: "agent.completed";
      agent: AgentNameV2;
      wave: WaveName;
      summary: string;
    }
  | { type: "agent.failed"; agent: AgentNameV2; wave: WaveName; reason: string }
  | {
      type: "agent.file_created";
      agent: AgentNameV2;
      wave: WaveName;
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
      agent: AgentNameV2;
      round: number;
      violations: number;
    }
  | { type: "agent.fix_completed"; agent: AgentNameV2; round: number };

export type EmitEvent = (event: OrchestratorV2Event) => void | Promise<void>;

// ─── Runner DI ───────────────────────────────────────────────────────

export interface AgentRunInput {
  agent: AgentNameV2;
  wave: WaveName;
  workDir: string;
  prd: unknown;
  /** Round 0 for first pass; ≥1 for fix-loop rounds. */
  fixRound: number;
  /** Violations being targeted in a fix round; empty for round 0. */
  violations: ReadonlyArray<QaViolation>;
}

export interface AgentRunResult {
  artifact: unknown;
  filesCreated: ReadonlyArray<{ path: string; lines: number }>;
  summary: string;
}

export type AgentRunner = (input: AgentRunInput) => Promise<AgentRunResult>;

// ─── QA artifact shape (slimmed down) ────────────────────────────────

export type QaDecision = "go" | "no-go";

export interface QaViolation {
  rule: string;
  severity: "error" | "warn";
  where?: string;
  message?: string;
  recommendedFix?: string;
}

export interface QaArtifactV2 {
  decision: QaDecision;
  violations: ReadonlyArray<QaViolation>;
  gates?: Record<string, { status: "pass" | "fail"; detail?: string }>;
  summary?: string;
}

// ─── Orchestrator entry ──────────────────────────────────────────────

export interface RunGenerationV2Options {
  generationId: string;
  prd: unknown;
  workDir: string;
  emit: EmitEvent;
  runner: AgentRunner;
  /** Override the wave list (useful for tests / dry runs). */
  waves?: readonly Wave[];
  /** Max fix-loop rounds when QA decides no-go. Default 3. 0 disables. */
  maxFixRounds?: number;
}

export interface GenerationV2Result {
  durationMs: number;
  artifacts: Partial<Record<AgentNameV2, unknown>>;
  files: Array<{ agent: AgentNameV2; path: string; lines: number }>;
  qa: QaArtifactV2 | null;
  failedAt?: { wave: WaveName; agent: AgentNameV2; reason: string };
}

interface WaveRunResult {
  ok: boolean;
  failed?: { agent: AgentNameV2; reason: string };
  results: Array<{ agent: AgentNameV2; outcome: AgentRunResult } | { agent: AgentNameV2; failed: string }>;
}

async function runWave(
  wave: Wave,
  runner: AgentRunner,
  emit: EmitEvent,
  ctx: { workDir: string; prd: unknown },
): Promise<WaveRunResult> {
  const startedAt = Date.now();
  await emit({ type: "wave.started", wave: wave.name, agents: wave.agents, startedAt });

  const settled = await Promise.allSettled(
    wave.agents.map(async (agent) => {
      await emit({ type: "agent.started", agent, wave: wave.name });
      const out = await runner({
        agent,
        wave: wave.name,
        workDir: ctx.workDir,
        prd: ctx.prd,
        fixRound: 0,
        violations: [],
      });
      for (const f of out.filesCreated) {
        await emit({
          type: "agent.file_created",
          agent,
          wave: wave.name,
          path: f.path,
          lines: f.lines,
        });
      }
      await emit({ type: "agent.completed", agent, wave: wave.name, summary: out.summary });
      return { agent, outcome: out };
    }),
  );

  const results: WaveRunResult["results"] = [];
  let firstFailure: { agent: AgentNameV2; reason: string } | undefined;
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const agent = wave.agents[i];
    if (!s || agent === undefined) continue;
    if (s.status === "fulfilled") {
      results.push({ agent: s.value.agent, outcome: s.value.outcome });
    } else {
      const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
      results.push({ agent, failed: reason });
      await emit({ type: "agent.failed", agent, wave: wave.name, reason });
      if (!firstFailure) firstFailure = { agent, reason };
    }
  }

  await emit({
    type: "wave.completed",
    wave: wave.name,
    durationMs: Date.now() - startedAt,
    results: results.map((r) =>
      "outcome" in r ? { agent: r.agent, status: "ok" as const } : { agent: r.agent, status: "failed" as const },
    ),
  });

  return { ok: !firstFailure, failed: firstFailure, results };
}

function ensureWavesAreInDependencyOrder(waves: readonly Wave[]): void {
  const seen = new Set<WaveName>();
  for (const wave of waves) {
    for (const dep of wave.dependsOn) {
      if (!seen.has(dep)) {
        throw new Error(
          `Wave "${wave.name}" depends on "${dep}" which has not run yet. Reorder WAVES_V2.`,
        );
      }
    }
    seen.add(wave.name);
  }
}

export async function runGenerationV2(
  opts: RunGenerationV2Options,
): Promise<GenerationV2Result> {
  const waves = opts.waves ?? WAVES_V2;
  ensureWavesAreInDependencyOrder(waves);
  const startedAt = Date.now();
  const artifacts: Partial<Record<AgentNameV2, unknown>> = {};
  const files: GenerationV2Result["files"] = [];
  let qa: QaArtifactV2 | null = null;

  await opts.emit({ type: "generation.started", generationId: opts.generationId });

  for (const wave of waves) {
    const out = await runWave(wave, opts.runner, opts.emit, {
      workDir: opts.workDir,
      prd: opts.prd,
    });

    for (const r of out.results) {
      if ("outcome" in r) {
        artifacts[r.agent] = r.outcome.artifact;
        for (const f of r.outcome.filesCreated) {
          files.push({ agent: r.agent, path: f.path, lines: f.lines });
        }
        if (r.agent === "qa-reviewer") {
          qa = r.outcome.artifact as QaArtifactV2;
        }
      }
    }

    if (!out.ok) {
      const reason = out.failed?.reason ?? "wave failed";
      await opts.emit({
        type: "generation.failed",
        generationId: opts.generationId,
        reason,
      });
      return {
        durationMs: Date.now() - startedAt,
        artifacts,
        files,
        qa,
        ...(out.failed ? { failedAt: { wave: wave.name, ...out.failed } } : {}),
      };
    }
  }

  // ─── Fix loop ───────────────────────────────────────────────────
  const maxFixRounds = opts.maxFixRounds ?? 3;
  if (qa && qa.decision === "no-go" && maxFixRounds > 0) {
    let currentQa: QaArtifactV2 = qa;
    for (let round = 1; round <= maxFixRounds; round++) {
      const grouped = groupViolationsByAgent(currentQa.violations);
      if (grouped.size === 0) break;

      const totalRouted = Array.from(grouped.values()).reduce(
        (n, list) => n + list.length,
        0,
      );
      await opts.emit({
        type: "qa.fix_round",
        round,
        maxRounds: maxFixRounds,
        violations: totalRouted,
      });

      // Run all fix-target agents in parallel — they edit disjoint paths.
      const fixSettled = await Promise.allSettled(
        Array.from(grouped.entries()).map(async ([agent, violations]) => {
          await opts.emit({
            type: "agent.fix_started",
            agent,
            round,
            violations: violations.length,
          });
          const out = await opts.runner({
            agent,
            wave: "wave-6-validation",
            workDir: opts.workDir,
            prd: opts.prd,
            fixRound: round,
            violations,
          });
          for (const f of out.filesCreated) {
            await opts.emit({
              type: "agent.file_created",
              agent,
              wave: "wave-6-validation",
              path: f.path,
              lines: f.lines,
            });
          }
          await opts.emit({ type: "agent.fix_completed", agent, round });
          return { agent, outcome: out };
        }),
      );

      // Bail the whole loop if a fix-agent throws — let the caller decide.
      for (const s of fixSettled) {
        if (s.status === "rejected") {
          const reason = s.reason instanceof Error ? s.reason.message : String(s.reason);
          await opts.emit({
            type: "generation.failed",
            generationId: opts.generationId,
            reason: `fix-loop agent failed: ${reason}`,
          });
          return {
            durationMs: Date.now() - startedAt,
            artifacts,
            files,
            qa: currentQa,
          };
        }
      }

      // Re-run QA Reviewer after applying fixes.
      const reQa = await opts.runner({
        agent: "qa-reviewer",
        wave: "wave-6-validation",
        workDir: opts.workDir,
        prd: opts.prd,
        fixRound: round,
        violations: [],
      });
      currentQa = reQa.artifact as QaArtifactV2;
      artifacts["qa-reviewer"] = currentQa;
      qa = currentQa;
      if (currentQa.decision === "go") break;
    }
  }

  await opts.emit({
    type: "generation.completed",
    generationId: opts.generationId,
    summary:
      qa?.summary ??
      `generation v2 done — files=${files.length}, decision=${qa?.decision ?? "unknown"}`,
  });

  return { durationMs: Date.now() - startedAt, artifacts, files, qa };
}

/**
 * Group `error`-level violations by the v2 agent responsible for the file.
 * `warn` and unrouteable violations are dropped (caller surfaces them
 * separately if needed).
 */
export function groupViolationsByAgent(
  violations: ReadonlyArray<QaViolation>,
): Map<AgentNameV2, QaViolation[]> {
  const out = new Map<AgentNameV2, QaViolation[]>();
  for (const v of violations) {
    if (v.severity !== "error") continue;
    const agent = routeViolationToAgent(v.where ?? "");
    if (!agent) continue;
    const list = out.get(agent) ?? [];
    list.push(v);
    out.set(agent, list);
  }
  return out;
}
