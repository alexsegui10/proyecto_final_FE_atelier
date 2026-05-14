/**
 * Atelier v3 orchestrator — 7 waves, 23 agents.
 *
 * Companion to `./orchestrator-v2.ts`. The v2 module stays intact; v3 is
 * opt-in via the `--v3` flag in the generation scripts. The two modules
 * share zero state — `runGenerationV3` is a complete (small) duplicate of
 * `runGenerationV2` with the v3 agent name union, the v3 wave layout, and
 * step-by-step pause hooks.
 *
 * Wave dependency graph (declared in WAVES_V3):
 *
 *   wave-1-discovery      (consumed, not produced here — chat phase output)
 *      ↓
 *   wave-1-bootstrap      (NEW: bootstrap-devops)
 *      ↓
 *   wave-1-planning       (architect)
 *      ↓
 *   wave-2-design         (ux-ui-designer ‖ layout-architect ‖ brand-identity)
 *      ↓
 *   wave-2-domain         (domain-modeler ‖ persistence ‖ seeds-shape)
 *      ↓
 *   wave-3-app-security   (service-layer ‖ auth-security ‖ rbac-authorization)
 *      ↓
 *   wave-4-presentation   (api-backend ‖ frontend-architect ‖ ui-components ‖
 *                          forms-validations ‖ pages-routing ‖
 *                          animation-choreographer)
 *      ↓
 *   wave-5-data-tests     (seeds-fixtures ‖ tests-writer ‖ accessibility)
 *      ↓
 *   wave-6-static-qa      (qa-reviewer)
 *      ↓
 *   wave-7-runtime-qa     (visual-qa)
 *
 * The 7 logical waves in the ROADMAP map to 9 dependency-ordered slices
 * above because Wave 1 has THREE sequential sub-waves (discovery → bootstrap
 * → architect) and Wave 2 has TWO parallel sub-waves (design + domain that
 * happen to be independent of each other beyond architect/bootstrap inputs).
 *
 * Agents within a wave run in PARALLEL via Promise.allSettled.
 */
import { mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname as pathDirname, join as pathJoin } from "node:path";

import { AGENT_NAMES_V3, AGENT_NAME_V3_SET, type AgentNameV3 } from "./contracts-v3/agent-names";
import { routeViolationToAgentV3 } from "./violations-router-v3";

// ─── Wave shape ──────────────────────────────────────────────────────

export type WaveNameV3 =
  | "wave-1-discovery"
  | "wave-1-bootstrap"
  | "wave-1-planning"
  | "wave-2-design"
  | "wave-2-domain"
  | "wave-3-app-security"
  | "wave-4-presentation"
  | "wave-5-data-tests"
  | "wave-6-static-qa"
  | "wave-7-runtime-qa";

export interface WaveV3 {
  readonly name: WaveNameV3;
  readonly agents: readonly AgentNameV3[];
  readonly dependsOn: readonly WaveNameV3[];
}

export const WAVES_V3: readonly WaveV3[] = [
  { name: "wave-1-discovery",     agents: ["discovery"],          dependsOn: [] },
  { name: "wave-1-bootstrap",     agents: ["bootstrap-devops"],   dependsOn: ["wave-1-discovery"] },
  { name: "wave-1-planning",      agents: ["architect"],          dependsOn: ["wave-1-bootstrap"] },
  {
    name: "wave-2-design",
    agents: ["ux-ui-designer", "layout-architect", "brand-identity"],
    dependsOn: ["wave-1-planning"],
  },
  {
    name: "wave-2-domain",
    agents: ["domain-modeler", "persistence", "seeds-shape"],
    dependsOn: ["wave-2-design"],
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
      "animation-choreographer",
      // visual-adapter runs LAST inside wave-4-presentation: it consumes
      // ui-components primitives for the rare `replaced-with-shadcn` cases
      // (R5 of visual-adapter.md). Ordering within a wave is best-effort —
      // the orchestrator runs all agents of a wave concurrently with
      // Promise.allSettled, so this ordering is mostly documentation.
      "visual-adapter",
    ],
    dependsOn: ["wave-3-app-security"],
  },
  {
    name: "wave-5-data-tests",
    agents: ["seeds-fixtures", "tests-writer", "accessibility"],
    dependsOn: ["wave-4-presentation"],
  },
  { name: "wave-6-static-qa",     agents: ["qa-reviewer"],        dependsOn: ["wave-5-data-tests"] },
  { name: "wave-7-runtime-qa",    agents: ["visual-qa"],          dependsOn: ["wave-6-static-qa"] },
] as const;

/** Canonical execution order — same as v2 generatorAgentOrderV2 but for v3. */
export function generatorAgentOrderV3(): readonly AgentNameV3[] {
  const seen = new Set<AgentNameV3>();
  const out: AgentNameV3[] = [];
  for (const wave of WAVES_V3) {
    for (const agent of wave.agents) {
      if (seen.has(agent)) continue;
      seen.add(agent);
      out.push(agent);
    }
  }
  return out;
}

// ─── Events ──────────────────────────────────────────────────────────

export type OrchestratorV3Event =
  | { type: "generation.started"; generationId: string }
  | { type: "generation.completed"; generationId: string; summary: string }
  | { type: "generation.failed"; generationId: string; reason: string }
  | { type: "wave.started"; wave: WaveNameV3; agents: readonly AgentNameV3[]; startedAt: number }
  | {
      type: "wave.completed";
      wave: WaveNameV3;
      durationMs: number;
      results: ReadonlyArray<{ agent: AgentNameV3; status: "ok" | "failed" }>;
    }
  | { type: "wave.paused"; wave: WaveNameV3; reason: string }
  | { type: "wave.approved"; wave: WaveNameV3 }
  | { type: "wave.rejected"; wave: WaveNameV3; humanFeedback: string }
  | { type: "wave.skipped"; wave: WaveNameV3; reason: string; blockingViolations: number }
  | { type: "gate.started"; gate: string; wave: WaveNameV3 }
  | {
      type: "gate.completed";
      gate: string;
      wave: WaveNameV3;
      violations: number;
      passed: boolean;
    }
  | { type: "agent.started"; agent: AgentNameV3; wave: WaveNameV3 }
  | { type: "agent.completed"; agent: AgentNameV3; wave: WaveNameV3; summary: string }
  | { type: "agent.failed"; agent: AgentNameV3; wave: WaveNameV3; reason: string }
  | { type: "agent.file_created"; agent: AgentNameV3; wave: WaveNameV3; path: string; lines: number }
  | { type: "qa.fix_round"; round: number; maxRounds: number; violations: number }
  | { type: "agent.fix_started"; agent: AgentNameV3; round: number; violations: number }
  | { type: "agent.fix_completed"; agent: AgentNameV3; round: number };

export type EmitEventV3 = (event: OrchestratorV3Event) => void | Promise<void>;

// ─── Runner DI ───────────────────────────────────────────────────────

export interface AgentRunInputV3 {
  agent: AgentNameV3;
  wave: WaveNameV3;
  workDir: string;
  prd: unknown;
  /** Round 0 for the first pass; ≥1 for fix-loop rounds. */
  fixRound: number;
  /** Violations targeted by this fix round. Empty for round 0. */
  violations: ReadonlyArray<QaViolationV3>;
  /** Human feedback when this run is a step-by-step regeneration. */
  humanFeedback?: string;
}

export interface AgentRunResultV3 {
  artifact: unknown;
  filesCreated: ReadonlyArray<{ path: string; lines: number }>;
  summary: string;
}

export type AgentRunnerV3 = (input: AgentRunInputV3) => Promise<AgentRunResultV3>;

// ─── QA artifact shape (same shape as v2 — qa-reviewer output) ──────

export type QaDecisionV3 = "go" | "no-go";

/**
 * Severity of a violation, in increasing order of impact:
 *
 *   - `warn`     — informational, no orchestrator action. Accumulated and
 *                  surfaced in the final report.
 *   - `error`    — blocks the wave (preWaveGate) or feeds the fix loop
 *                  (qa-reviewer). Routine recoverable failure.
 *   - `critical` — unrecoverable defect at the contract level (e.g. a
 *                  policy invariant the orchestrator MUST NOT silently
 *                  tolerate). The orchestrator emits `generation.failed`
 *                  immediately, bypassing the fix loop. Use sparingly —
 *                  reserve for invariants whose breach indicates a bug in
 *                  an upstream agent that retries cannot solve.
 */
export type QaSeverityV3 = "warn" | "error" | "critical";

export interface QaViolationV3 {
  rule: string;
  severity: QaSeverityV3;
  where?: string;
  file?: string;
  /** 1-based line number when the gate can anchor the violation precisely. */
  line?: number;
  agent?: string;
  message?: string;
  recommendedFix?: string;
}

export interface QaArtifactV3 {
  decision: QaDecisionV3;
  violations: ReadonlyArray<QaViolationV3>;
  gates?: Record<string, { status: "pass" | "fail"; detail?: string }>;
  summary?: string;
}

// ─── Step-by-step pause hooks ────────────────────────────────────────

export type ApprovalDecision =
  | { kind: "approve" }
  | { kind: "reject"; reason: string }
  | { kind: "inspect" };

/**
 * Function the runtime calls between waves when step-by-step mode is active.
 * Returns the human's decision. If the resolver returns `inspect`, the
 * orchestrator surfaces a detail block and waits again (the runtime is
 * responsible for re-prompting; the orchestrator just re-asks).
 */
export type ApprovalResolver = (
  wave: WaveNameV3,
  summary: WaveCompletedPayload,
) => Promise<ApprovalDecision>;

export interface WaveCompletedPayload {
  wave: WaveNameV3;
  agents: readonly AgentNameV3[];
  durationMs: number;
  results: ReadonlyArray<{ agent: AgentNameV3; status: "ok" | "failed" }>;
}

// ─── Pre-wave gates (programmatic checks before agent invocation) ────

/**
 * A pre-wave gate is a deterministic check the orchestrator runs BEFORE
 * invoking the agents of a wave. Gates emit `QaViolationV3[]` (empty if
 * the check passed). If any returned violation has `severity: "error"` or
 * `severity: "critical"`, the wave is SKIPPED (agents not invoked) and the
 * orchestrator continues to the next wave. The violations are merged into
 * `GenerationV3Result.gateViolations` and surfaced to the qa-reviewer LLM
 * downstream as additional input.
 *
 * Use cases: Gate 5 runtime-smoke (before wave-7), Gate 6 visual regression
 * (future, blocked by D3), env-leak scanner (already a standalone gate).
 */
export interface PreWaveGate {
  /** Stable kebab-case identifier. Appears in events + violation logs. */
  name: string;
  run: (ctx: PreWaveGateContext) => Promise<readonly QaViolationV3[]>;
}

export interface PreWaveGateContext {
  workDir: string;
  /**
   * Base URL of the running app, when the orchestrator (or future wave
   * lifecycle hook) has booted it. Undefined when no app is running yet.
   */
  appUrl?: string;
  /** Read-only view of artifacts produced by upstream waves. */
  artifacts: Readonly<Partial<Record<AgentNameV3, unknown>>>;
}

// ─── Post-wave gates (programmatic checks after agent invocation) ───

/**
 * Symmetric to PreWaveGate but runs AFTER the wave's agents complete.
 * Use cases:
 *  - Gate 6 visual regression (needs Visual QA screenshots → post wave-7)
 *  - cross-artifact-coherence-scanner (needs all wave-2-design artifacts
 *    written → post wave-2-design)
 *
 * Semantics differ from PreWaveGate:
 *  - Post-gate violations DO NOT skip the wave (it already ran).
 *  - Violations are accumulated in `GenerationV3Result.gateViolations`
 *    just like preWaveGate output.
 *  - If a post-gate throws, the orchestrator emits `generation.failed`.
 */
export interface PostWaveGate {
  /** Stable kebab-case identifier. */
  name: string;
  run: (ctx: PostWaveGateContext) => Promise<readonly QaViolationV3[]>;
}

export interface PostWaveGateContext {
  workDir: string;
  appUrl?: string;
  /** Artifacts including the ones the wave just produced. */
  artifacts: Readonly<Partial<Record<AgentNameV3, unknown>>>;
  /** Summary of which agents ran ok vs failed in the wave. */
  waveResults: ReadonlyArray<{ agent: AgentNameV3; status: "ok" | "failed" }>;
}

// ─── Orchestrator entry ──────────────────────────────────────────────

export interface RunGenerationV3Options {
  generationId: string;
  prd: unknown;
  workDir: string;
  emit: EmitEventV3;
  runner: AgentRunnerV3;
  /** Override the wave list — useful for tests and partial dry-runs. */
  waves?: readonly WaveV3[];
  /** Max fix-loop rounds when qa decides no-go. Default 3. 0 disables. */
  maxFixRounds?: number;
  /**
   * Step-by-step mode: when set, the orchestrator calls `approvalResolver`
   * after every wave and pauses for the human's decision. Defaults to OFF
   * (auto mode, identical to v2).
   */
  approvalResolver?: ApprovalResolver;
  /**
   * Per-wave pre-gates. Each gate runs BEFORE the wave's agents are invoked.
   * If any gate emits a violation with severity error/critical, the wave is
   * skipped (its agents are not invoked, control proceeds to the next wave).
   * The violations are accumulated in `GenerationV3Result.gateViolations`.
   */
  preWaveGates?: Partial<Record<WaveNameV3, readonly PreWaveGate[]>>;
  /**
   * Per-wave post-gates. Each gate runs AFTER the wave's agents complete
   * (with `ok` status). Violations are accumulated in `gateViolations` but
   * DO NOT skip the wave (it already ran). Use cases: cross-artifact
   * coherence (post wave-2-design), visual regression (post wave-7).
   */
  postWaveGates?: Partial<Record<WaveNameV3, readonly PostWaveGate[]>>;
  /**
   * Base URL of the running app, when a wave needs a live app to test
   * against. The orchestrator threads this into `PreWaveGateContext.appUrl`.
   * Future wave-7 lifecycle hooks will own boot/teardown.
   */
  appUrl?: string;
}

export interface GenerationV3Result {
  durationMs: number;
  artifacts: Partial<Record<AgentNameV3, unknown>>;
  files: Array<{ agent: AgentNameV3; path: string; lines: number }>;
  qa: QaArtifactV3 | null;
  failedAt?: { wave: WaveNameV3; agent: AgentNameV3; reason: string };
  /** Last human decision, if step-by-step was active. */
  lastApproval?: { wave: WaveNameV3; decision: ApprovalDecision };
  /** Violations produced by preWaveGates across the run. */
  gateViolations: QaViolationV3[];
  /** Waves whose agents were not invoked because a preWaveGate blocked them. */
  skippedWaves: WaveNameV3[];
  /**
   * Set to true by the Stitch reprompt loop (rework Punto C) when the
   * stitch-completeness-scanner kept finding gaps after 2 reprompts.
   * The Visual Adapter substitutes placeholders for missing pages and
   * the run completes, but the orchestrator caller should surface the
   * flag to the human operator.
   */
  requiresHumanReview?: boolean;
}

interface WaveRunResult {
  ok: boolean;
  failed?: { agent: AgentNameV3; reason: string };
  results: Array<
    | { agent: AgentNameV3; outcome: AgentRunResultV3 }
    | { agent: AgentNameV3; failed: string }
  >;
}

async function runWave(
  wave: WaveV3,
  runner: AgentRunnerV3,
  emit: EmitEventV3,
  ctx: {
    workDir: string;
    prd: unknown;
    humanFeedback?: string;
    /**
     * Agents in this wave whose artifact already exists upstream (e.g. the
     * Stitch reprompt loop preserves ux-ui-designer + brand-identity while
     * re-running only layout-architect). When set, those agents are NOT
     * re-invoked; their previously-stored artifact remains the wave's
     * contribution and `results[]` does not include them.
     */
    skipAgents?: ReadonlySet<AgentNameV3>;
  },
): Promise<WaveRunResult> {
  const startedAt = Date.now();
  const skip = ctx.skipAgents;
  const agentsToRun = wave.agents.filter((a) => !skip?.has(a));
  await emit({ type: "wave.started", wave: wave.name, agents: agentsToRun, startedAt });

  const settled = await Promise.allSettled(
    agentsToRun.map(async (agent) => {
      await emit({ type: "agent.started", agent, wave: wave.name });
      const out = await runner({
        agent,
        wave: wave.name,
        workDir: ctx.workDir,
        prd: ctx.prd,
        fixRound: 0,
        violations: [],
        ...(ctx.humanFeedback ? { humanFeedback: ctx.humanFeedback } : {}),
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
  let firstFailure: { agent: AgentNameV3; reason: string } | undefined;
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    const agent = agentsToRun[i];
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
      "outcome" in r
        ? { agent: r.agent, status: "ok" as const }
        : { agent: r.agent, status: "failed" as const },
    ),
  });

  return { ok: !firstFailure, failed: firstFailure, results };
}

function ensureWavesAreInDependencyOrder(waves: readonly WaveV3[]): void {
  const seen = new Set<WaveNameV3>();
  for (const wave of waves) {
    for (const dep of wave.dependsOn) {
      if (!seen.has(dep)) {
        throw new Error(
          `Wave "${wave.name}" depends on "${dep}" which has not run yet. Reorder WAVES_V3.`,
        );
      }
    }
    seen.add(wave.name);
  }
}

export async function runGenerationV3(
  opts: RunGenerationV3Options,
): Promise<GenerationV3Result> {
  const waves = opts.waves ?? WAVES_V3;
  ensureWavesAreInDependencyOrder(waves);
  const startedAt = Date.now();
  const artifacts: Partial<Record<AgentNameV3, unknown>> = {};
  const files: GenerationV3Result["files"] = [];
  let qa: QaArtifactV3 | null = null;
  let lastApproval: GenerationV3Result["lastApproval"];

  await opts.emit({ type: "generation.started", generationId: opts.generationId });

  let humanFeedback: string | undefined;
  const gateViolations: QaViolationV3[] = [];
  const skippedWaves: WaveNameV3[] = [];
  // Stitch reprompt loop (rework Punto C): tracks how many times Layout
  // Architect was re-invoked with --stitch-reprompt. Capped at 2; after
  // that the orchestrator triggers plan B (stitchHealth: "degraded" +
  // requires_human_review) and the run proceeds with whatever HTML pages
  // exist on disk.
  let stitchRepromptAttempts = 0;
  let requiresHumanReview = false;

  /**
   * Persist the orchestrator's mutable state (stitch reprompt counter,
   * current wave, human-review flag) to `.atelier/run-state.json` so
   * preWaveGates can observe it. The Stitch fixture preparer reads
   * `stitchAttempt` from here to materialise the right attempt's HTML.
   * Best-effort: failure to write is non-fatal.
   */
  async function persistRunState(currentWave: WaveNameV3): Promise<void> {
    const target = pathJoin(opts.workDir, ".atelier", "run-state.json");
    try {
      await fsMkdir(pathDirname(target), { recursive: true });
      await fsWriteFile(
        target,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            currentWave,
            stitchAttempt: stitchRepromptAttempts,
            ...(requiresHumanReview ? { requiresHumanReview: true } : {}),
          },
          null,
          2,
        ),
        "utf8",
      );
    } catch {
      // Non-fatal: gates that need the state will fall back to attempt=0.
    }
  }

  /**
   * Runs the pre-wave gates for a given wave. Extracted so the Stitch
   * reprompt loop can re-invoke it after incrementing the attempt
   * counter (the fixture preparer gate re-materialises the next
   * attempt's HTML on each call).
   *
   * Returns:
   *   - `{ kind: "ok" }` when the wave should proceed.
   *   - `{ kind: "skip" }` when a non-critical error violation blocks the wave.
   *   - `{ kind: "fatal", reason }` when a gate threw OR emitted critical.
   */
  async function runPreWaveGatesForWave(
    wave: WaveV3,
  ): Promise<
    | { kind: "ok" }
    | { kind: "skip"; blockingCount: number }
    | { kind: "fatal"; reason: string; critical?: QaViolationV3 }
  > {
    const gates = opts.preWaveGates?.[wave.name] ?? [];
    let waveBlockedByGate = false;
    let blockingCount = 0;
    const gateViolationsBeforeIdx = gateViolations.length;
    for (const gate of gates) {
      await opts.emit({ type: "gate.started", gate: gate.name, wave: wave.name });
      let gateOutcome: readonly QaViolationV3[] = [];
      try {
        gateOutcome = await gate.run({
          workDir: opts.workDir,
          artifacts,
          ...(opts.appUrl ? { appUrl: opts.appUrl } : {}),
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { kind: "fatal", reason: `preWaveGate '${gate.name}' threw: ${reason}` };
      }
      gateViolations.push(...gateOutcome);
      const blocking = gateOutcome.filter((v) => v.severity === "error").length;
      if (blocking > 0) {
        waveBlockedByGate = true;
        blockingCount += blocking;
      }
      await opts.emit({
        type: "gate.completed",
        gate: gate.name,
        wave: wave.name,
        violations: gateOutcome.length,
        passed: blocking === 0,
      });
    }
    // Critical detected among the violations emitted in THIS pre-gate pass.
    const newViolations = gateViolations.slice(gateViolationsBeforeIdx);
    const critical = newViolations.find((v) => v.severity === "critical");
    if (critical) {
      return {
        kind: "fatal",
        reason: `critical preWaveGate violation '${critical.rule}' at ${wave.name}: ${critical.message ?? "(no message)"}`,
        critical,
      };
    }
    if (waveBlockedByGate) return { kind: "skip", blockingCount };
    return { kind: "ok" };
  }

  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i];
    if (!wave) continue;

    // Persist run-state so any preWaveGate that depends on it sees the
    // current attempt (0 on the first entry to wave-2-design).
    await persistRunState(wave.name);

    // ─── Pre-wave gates ──────────────────────────────────────────────
    const preResult = await runPreWaveGatesForWave(wave);
    if (preResult.kind === "fatal") {
      await opts.emit({
        type: "generation.failed",
        generationId: opts.generationId,
        reason: preResult.reason,
      });
      return {
        durationMs: Date.now() - startedAt,
        artifacts,
        files,
        qa,
        gateViolations,
        skippedWaves,
        ...(preResult.critical
          ? {
              failedAt: {
                wave: wave.name,
                agent: (preResult.critical.agent as AgentNameV3 | undefined) ?? wave.agents[0]!,
                reason: preResult.reason,
              },
            }
          : {}),
        ...(lastApproval ? { lastApproval } : {}),
      };
    }
    if (preResult.kind === "skip") {
      await opts.emit({
        type: "wave.skipped",
        wave: wave.name,
        reason: `preWaveGate emitted ${preResult.blockingCount} blocking violation(s)`,
        blockingViolations: preResult.blockingCount,
      });
      skippedWaves.push(wave.name);
      continue; // Next wave — no agents run for this one
    }

    // Outer loop: run the wave; may repeat if the human rejects in step-by-step
    // or if the Stitch reprompt loop fires.
    let waveSettled = false;
    while (!waveSettled) {
      // Compute skip set: any agent in this wave whose artifact already
      // exists from a previous attempt is preserved (skip-resume). This is
      // what keeps the Stitch reprompt loop from re-burning tokens on
      // ux-ui-designer / brand-identity when only layout-architect needs
      // to retry. Full-wave rejects upstream (approvalResolver) explicitly
      // delete the artifacts so this set comes out empty there.
      const skipAgents = new Set<AgentNameV3>();
      for (const agent of wave.agents) {
        if (artifacts[agent] !== undefined) skipAgents.add(agent);
      }
      const out = await runWave(wave, opts.runner, opts.emit, {
        workDir: opts.workDir,
        prd: opts.prd,
        ...(humanFeedback ? { humanFeedback } : {}),
        ...(skipAgents.size > 0 ? { skipAgents } : {}),
      });

      for (const r of out.results) {
        if ("outcome" in r) {
          artifacts[r.agent] = r.outcome.artifact;
          for (const f of r.outcome.filesCreated) {
            files.push({ agent: r.agent, path: f.path, lines: f.lines });
          }
          if (r.agent === "qa-reviewer") qa = r.outcome.artifact as QaArtifactV3;
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
          gateViolations,
          skippedWaves,
          ...(out.failed ? { failedAt: { wave: wave.name, ...out.failed } } : {}),
          ...(lastApproval ? { lastApproval } : {}),
        };
      }

      // ─── Post-wave gates ──────────────────────────────────────────
      // Run AFTER the wave's agents completed successfully. Violations
      // accumulate but DO NOT skip the wave (it already ran). Capture
      // the slice boundary so the stitch reprompt loop below can inspect
      // only the violations emitted in THIS wave iteration (not the
      // accumulated set across previous iterations).
      const gateViolationsBeforeIdx = gateViolations.length;
      const postGates = opts.postWaveGates?.[wave.name] ?? [];
      for (const postGate of postGates) {
        await opts.emit({ type: "gate.started", gate: postGate.name, wave: wave.name });
        let postOutcome: readonly QaViolationV3[] = [];
        try {
          postOutcome = await postGate.run({
            workDir: opts.workDir,
            artifacts,
            waveResults: out.results.map((r) =>
              "outcome" in r
                ? { agent: r.agent, status: "ok" as const }
                : { agent: r.agent, status: "failed" as const },
            ),
            ...(opts.appUrl ? { appUrl: opts.appUrl } : {}),
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          await opts.emit({
            type: "generation.failed",
            generationId: opts.generationId,
            reason: `postWaveGate '${postGate.name}' threw: ${reason}`,
          });
          return {
            durationMs: Date.now() - startedAt,
            artifacts,
            files,
            qa,
            gateViolations,
            skippedWaves,
            ...(lastApproval ? { lastApproval } : {}),
          };
        }
        gateViolations.push(...postOutcome);
        const blocking = postOutcome.filter((v) => v.severity === "error").length;
        await opts.emit({
          type: "gate.completed",
          gate: postGate.name,
          wave: wave.name,
          violations: postOutcome.length,
          passed: blocking === 0,
        });
      }

      // ─── Critical violation early-exit (deuda #10) ────────────────
      // Any violation marked `severity: "critical"` in this wave's
      // gates bypasses the fix loop and fails the run immediately.
      // Use case: gates that enforce contract-level invariants whose
      // breach indicates a bug retries cannot solve.
      const criticalGate = gateViolations.find((v) => v.severity === "critical");
      if (criticalGate) {
        const reason = `critical gate violation '${criticalGate.rule}' at ${wave.name}: ${criticalGate.message ?? "(no message)"}`;
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
          gateViolations,
          skippedWaves,
          failedAt: {
            wave: wave.name,
            agent: (criticalGate.agent as AgentNameV3 | undefined) ?? wave.agents[0]!,
            reason,
          },
          ...(requiresHumanReview ? { requiresHumanReview: true as const } : {}),
          ...(lastApproval ? { lastApproval } : {}),
        };
      }

      // ─── Stitch reprompt loop (rework Punto C) ────────────────────
      // Only relevant to wave-2-design. If the stitch-completeness-scanner
      // emitted any of the 3 stitch-* rules AND we have not exhausted
      // the reprompt budget (max 2), re-run the wave with feedback that
      // points Layout Architect at `.atelier/stitch-failures.json`.
      // After 2 attempts plan B: set requires_human_review and proceed
      // (the Visual Adapter will substitute placeholders for missing pages).
      if (wave.name === "wave-2-design") {
        const STITCH_REPROMPT_RULES = new Set([
          "stitch-missing-page",
          "stitch-missing-critical-element",
          "stitch-thin-section",
        ]);
        // Only the violations emitted IN THIS WAVE ITERATION count.
        // gateViolations is cumulative across iterations; without the
        // slice we'd reprompt forever based on stale violations from
        // the previous attempt.
        const violationsThisIteration = gateViolations.slice(gateViolationsBeforeIdx);
        const stitchViolationsThisRun = violationsThisIteration.filter(
          (v) => STITCH_REPROMPT_RULES.has(v.rule) && v.severity === "error",
        );
        if (stitchViolationsThisRun.length > 0) {
          if (stitchRepromptAttempts < 2) {
            stitchRepromptAttempts++;
            await opts.emit({
              type: "wave.paused",
              wave: wave.name,
              reason: `stitch-completeness flagged ${stitchViolationsThisRun.length} gap(s) — reprompt attempt ${stitchRepromptAttempts}/2`,
            });
            // Strip the Layout Architect artifact so the wave can re-run
            // (UX/UI slim + Brand Identity outputs are conserved — they're
            // idempotent w.r.t. their inputs).
            delete artifacts["layout-architect"];
            // The runner reads humanFeedback; we use it to signal reprompt.
            humanFeedback = `STITCH_REPROMPT_ATTEMPT=${stitchRepromptAttempts} previousFailures=.atelier/stitch-failures.json`;
            // Persist new attempt + re-run preWaveGates so the Stitch
            // fixture preparer (if registered) re-materialises HTML for
            // the next attempt. The reprompt loop is the only path that
            // can change run-state mid-wave, so we re-fire pre-gates here.
            await persistRunState(wave.name);
            const preReplay = await runPreWaveGatesForWave(wave);
            if (preReplay.kind === "fatal") {
              await opts.emit({
                type: "generation.failed",
                generationId: opts.generationId,
                reason: preReplay.reason,
              });
              return {
                durationMs: Date.now() - startedAt,
                artifacts,
                files,
                qa,
                gateViolations,
                skippedWaves,
                ...(preReplay.critical
                  ? {
                      failedAt: {
                        wave: wave.name,
                        agent: (preReplay.critical.agent as AgentNameV3 | undefined) ?? wave.agents[0]!,
                        reason: preReplay.reason,
                      },
                    }
                  : {}),
                ...(lastApproval ? { lastApproval } : {}),
              };
            }
            // If pre-gates emitted a non-critical blocking violation on
            // replay (e.g. fixture preparer can't find attempt=N), bail
            // out cleanly: skip the wave for the remaining downstream.
            if (preReplay.kind === "skip") {
              await opts.emit({
                type: "wave.skipped",
                wave: wave.name,
                reason: `preWaveGate replay after reprompt emitted ${preReplay.blockingCount} blocking violation(s)`,
                blockingViolations: preReplay.blockingCount,
              });
              skippedWaves.push(wave.name);
              waveSettled = true;
              break;
            }
            continue; // outer while re-runs wave-2-design
          }
          // Plan B: budget exhausted.
          requiresHumanReview = true;
          await opts.emit({
            type: "wave.paused",
            wave: wave.name,
            reason: `stitch-completeness still flagging after 2 reprompts — plan B: stitchHealth=degraded, requires_human_review`,
          });
          // Run continues. Visual Adapter (wave-4-frontend) will substitute
          // placeholders for the pages in stitch-failures.json.
        }
      }

      if (!opts.approvalResolver) {
        waveSettled = true;
        break;
      }

      // Inner loop: poll the resolver until a non-inspect decision is reached.
      // `inspect` re-asks WITHOUT re-running the wave.
      let needsRerun = false;
      let asking = true;
      while (asking) {
        const decision = await opts.approvalResolver(wave.name, {
          wave: wave.name,
          agents: wave.agents,
          durationMs: 0, // already emitted by wave.completed
          results: out.results.map((r) =>
            "outcome" in r
              ? { agent: r.agent, status: "ok" as const }
              : { agent: r.agent, status: "failed" as const },
          ),
        });

        if (decision.kind === "approve") {
          lastApproval = { wave: wave.name, decision };
          await opts.emit({ type: "wave.approved", wave: wave.name });
          humanFeedback = undefined;
          asking = false;
          waveSettled = true;
        } else if (decision.kind === "reject") {
          lastApproval = { wave: wave.name, decision };
          await opts.emit({
            type: "wave.rejected",
            wave: wave.name,
            humanFeedback: decision.reason,
          });
          humanFeedback = decision.reason;
          // Strip artifacts written by this wave (the runner adapter is
          // responsible for purging on-disk artifacts during resume).
          for (const a of wave.agents) delete artifacts[a];
          asking = false;
          needsRerun = true;
        } else if (decision.kind === "inspect") {
          await opts.emit({
            type: "wave.paused",
            wave: wave.name,
            reason: "inspect requested — re-prompt",
          });
          // Loop: ask the resolver again immediately, no wave re-run.
        }
      }

      if (needsRerun) continue; // outer loop re-runs the wave
    }
  }

  // ─── Critical qa violation early-exit (deuda #10) ───────────────
  // If qa-reviewer surfaced a critical violation, fail immediately —
  // the fix loop cannot recover from contract-level breaches.
  if (qa) {
    const criticalQa = qa.violations?.find((v) => v.severity === "critical");
    if (criticalQa) {
      const reason = `critical qa violation '${criticalQa.rule}': ${criticalQa.message ?? "(no message)"}`;
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
        gateViolations,
        skippedWaves,
        ...(requiresHumanReview ? { requiresHumanReview: true as const } : {}),
        ...(lastApproval ? { lastApproval } : {}),
      };
    }
  }

  // ─── Fix loop ───────────────────────────────────────────────────
  const maxFixRounds = opts.maxFixRounds ?? 3;
  if (qa && qa.decision === "no-go" && maxFixRounds > 0) {
    let currentQa: QaArtifactV3 = qa;
    for (let round = 1; round <= maxFixRounds; round++) {
      const grouped = groupViolationsByAgentV3(currentQa.violations);
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
            wave: "wave-6-static-qa",
            workDir: opts.workDir,
            prd: opts.prd,
            fixRound: round,
            violations,
          });
          for (const f of out.filesCreated) {
            await opts.emit({
              type: "agent.file_created",
              agent,
              wave: "wave-6-static-qa",
              path: f.path,
              lines: f.lines,
            });
          }
          await opts.emit({ type: "agent.fix_completed", agent, round });
          return { agent, outcome: out };
        }),
      );

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
            gateViolations,
            skippedWaves,
            ...(lastApproval ? { lastApproval } : {}),
          };
        }
      }

      // Re-run qa-reviewer after fixes.
      const reQa = await opts.runner({
        agent: "qa-reviewer",
        wave: "wave-6-static-qa",
        workDir: opts.workDir,
        prd: opts.prd,
        fixRound: round,
        violations: [],
      });
      currentQa = reQa.artifact as QaArtifactV3;
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
      `generation v3 done — files=${files.length}, decision=${qa?.decision ?? "unknown"}`,
  });

  return {
    durationMs: Date.now() - startedAt,
    artifacts,
    files,
    qa,
    gateViolations,
    skippedWaves,
    ...(requiresHumanReview ? { requiresHumanReview: true as const } : {}),
    ...(lastApproval ? { lastApproval } : {}),
  };
}

// ─── Violation routing (3-strategy, like v2 post-fix) ────────────────

/**
 * Group `error`-level violations by the v3 agent responsible for the file.
 * Strategy order (same as v2 post-fix):
 *   1. explicit `agent` field (qa-reviewer attribution)
 *   2. `file` path → agent via violations-router-v3
 *   3. legacy `where` path → agent via violations-router-v3
 */
export function groupViolationsByAgentV3(
  violations: ReadonlyArray<QaViolationV3>,
): Map<AgentNameV3, QaViolationV3[]> {
  const out = new Map<AgentNameV3, QaViolationV3[]>();
  for (const v of violations) {
    if (v.severity !== "error") continue;
    let agent: AgentNameV3 | null = null;
    if (v.agent && AGENT_NAME_V3_SET.has(v.agent)) agent = v.agent as AgentNameV3;
    if (!agent) agent = routeViolationToAgentV3(v.file ?? v.where ?? "");
    if (!agent) continue;
    const list = out.get(agent) ?? [];
    list.push(v);
    out.set(agent, list);
  }
  return out;
}

// Re-export so callers (scripts, tests) only need one module path.
export { AGENT_NAMES_V3, type AgentNameV3 };
