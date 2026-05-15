import { describe, it, expect } from "vitest";

import {
  WAVES_V3,
  generatorAgentOrderV3,
  groupViolationsByAgentV3,
  runGenerationV3,
  type AgentRunnerV3,
  type AgentRunInputV3,
  type AgentRunResultV3,
  type ApprovalDecision,
  type ApprovalResolver,
  type OrchestratorV3Event,
  type PostWaveGate,
  type PreWaveGate,
  type QaArtifactV3,
  type QaViolationV3,
  type WaveV3,
} from "./orchestrator-v3";
import { AGENT_NAMES_V3 } from "./contracts-v3/agent-names";

// ─── Runner fixture ─────────────────────────────────────────────────

interface RunnerCall {
  agent: string;
  fixRound: number;
  humanFeedback?: string;
}

function makeRunner(
  opts: {
    artifactFor?: (agent: string, fixRound: number) => unknown;
    failOn?: string;
  } = {},
): { runner: AgentRunnerV3; calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const runner: AgentRunnerV3 = async (input: AgentRunInputV3): Promise<AgentRunResultV3> => {
    if (opts.failOn === input.agent) throw new Error(`runner: forced failure on ${input.agent}`);
    calls.push({
      agent: input.agent,
      fixRound: input.fixRound,
      ...(input.humanFeedback ? { humanFeedback: input.humanFeedback } : {}),
    });
    return {
      artifact: opts.artifactFor
        ? opts.artifactFor(input.agent, input.fixRound)
        : { agent: input.agent, fixRound: input.fixRound },
      filesCreated: [],
      summary: `${input.agent.toUpperCase()}_DONE`,
    };
  };
  return { runner, calls };
}

const base = (overrides: Partial<Parameters<typeof runGenerationV3>[0]> = {}) => ({
  generationId: "test-v3-001",
  prd: { objective: "demo" },
  workDir: "/tmp/atelier-v3-test",
  emit: async () => {},
  runner: makeRunner().runner,
  ...overrides,
});

// ─── Wave structure ─────────────────────────────────────────────────

describe("WAVES_V3 — structural sanity", () => {
  it("declares 10 dependency-ordered slices (7 logical waves)", () => {
    expect(WAVES_V3).toHaveLength(10);
    const seen = new Set<string>();
    for (const w of WAVES_V3) {
      for (const dep of w.dependsOn) expect(seen.has(dep)).toBe(true);
      seen.add(w.name);
    }
  });

  it("every dependency references an existing wave", () => {
    const names = new Set(WAVES_V3.map((w) => w.name));
    for (const w of WAVES_V3) {
      for (const dep of w.dependsOn) expect(names.has(dep)).toBe(true);
    }
  });

  it("includes all 24 agents exactly once", () => {
    const counts = new Map<string, number>();
    for (const w of WAVES_V3) {
      for (const a of w.agents) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    expect(counts.size).toBe(24);
    for (const [agent, count] of counts) {
      expect(count, `${agent} appears more than once`).toBe(1);
    }
  });

  it("places the new bootstrap-devops between discovery and architect", () => {
    const order = WAVES_V3.map((w) => w.name);
    const disc = order.indexOf("wave-1-discovery");
    const boot = order.indexOf("wave-1-bootstrap");
    const plan = order.indexOf("wave-1-planning");
    expect(disc).toBeLessThan(boot);
    expect(boot).toBeLessThan(plan);
  });

  it("wave-7-runtime-qa contains visual-qa only", () => {
    const w7 = WAVES_V3.find((w) => w.name === "wave-7-runtime-qa");
    expect(w7?.agents).toEqual(["visual-qa"]);
  });

  it("places wave-4-presentation with 7 agents (5 v2 + animation-choreographer + visual-adapter)", () => {
    const w4 = WAVES_V3.find((w) => w.name === "wave-4-presentation");
    expect(w4?.agents).toHaveLength(7);
    expect(w4?.agents).toContain("animation-choreographer");
    expect(w4?.agents).toContain("visual-adapter");
  });

  it("generatorAgentOrderV3 returns 24 deterministic entries", () => {
    const order = generatorAgentOrderV3();
    expect(order).toHaveLength(24);
    expect(new Set(order).size).toBe(24);
    expect(order).toEqual(AGENT_NAMES_V3.slice().sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return ai - bi;
    }));
  });
});

// ─── runGenerationV3 — happy path ───────────────────────────────────

describe("runGenerationV3 — auto mode", () => {
  it("runs every wave and emits the documented events", async () => {
    // Make qa-reviewer return decision: "go" so the fix loop is skipped.
    const { runner, calls } = makeRunner({
      artifactFor: (agent) =>
        agent === "qa-reviewer"
          ? ({ decision: "go", violations: [] } satisfies QaArtifactV3)
          : { agent },
    });
    const events: OrchestratorV3Event[] = [];
    const result = await runGenerationV3({
      ...base(),
      runner,
      emit: async (e) => void events.push(e),
    });
    expect(result.qa?.decision).toBe("go");
    expect(result.failedAt).toBeUndefined();
    expect(calls.length).toBe(24);

    // Sanity events
    expect(events.some((e) => e.type === "generation.started")).toBe(true);
    expect(events.some((e) => e.type === "generation.completed")).toBe(true);
    expect(events.filter((e) => e.type === "wave.started").length).toBe(10);
  });

  it("stops at the first failed wave with failedAt", async () => {
    const { runner } = makeRunner({ failOn: "architect" });
    const events: OrchestratorV3Event[] = [];
    const result = await runGenerationV3({
      ...base(),
      runner,
      emit: async (e) => void events.push(e),
    });
    expect(result.failedAt?.agent).toBe("architect");
    expect(events.some((e) => e.type === "generation.failed")).toBe(true);
  });

  it("captures qa-reviewer artifact into result.qa", async () => {
    const qaArtifact: QaArtifactV3 = { decision: "go", violations: [] };
    const { runner } = makeRunner({
      artifactFor: (agent) => (agent === "qa-reviewer" ? qaArtifact : { agent }),
    });
    const result = await runGenerationV3({ ...base(), runner });
    expect(result.qa?.decision).toBe("go");
  });

  it("triggers the fix loop when qa decides no-go", async () => {
    const noGo: QaArtifactV3 = {
      decision: "no-go",
      violations: [
        { rule: "TypecheckError", severity: "error", agent: "api-backend", message: "bad" },
        { rule: "TypecheckError", severity: "error", agent: "ui-components", message: "bad" },
      ],
    };
    let qaCallCount = 0;
    const { runner } = makeRunner({
      artifactFor: (agent) => {
        if (agent === "qa-reviewer") {
          qaCallCount++;
          // First call returns no-go; second (after fix round 1) returns go.
          return qaCallCount === 1
            ? noGo
            : ({ decision: "go", violations: [] } satisfies QaArtifactV3);
        }
        return { agent };
      },
    });
    const events: OrchestratorV3Event[] = [];
    const result = await runGenerationV3({
      ...base(),
      runner,
      emit: async (e) => void events.push(e),
    });
    expect(result.qa?.decision).toBe("go");
    expect(events.some((e) => e.type === "qa.fix_round")).toBe(true);
    expect(events.filter((e) => e.type === "agent.fix_started").length).toBe(2);
  });

  // ─── B11 — seedArtifacts ──────────────────────────────────────────
  //
  // `--stitch-mode=fixture` records the architect artifact adjacent to
  // the Stitch fixture and feeds it through `seedArtifacts`. The
  // orchestrator must place the seed in the artifact map BEFORE waves
  // run, so the existing skip-resume logic (`artifacts[agent] !==
  // undefined`) auto-skips the seeded agent.
  it("seedArtifacts: a pre-seeded agent is auto-skipped and its artifact propagates", async () => {
    const recordedArchitect = {
      features: [
        {
          name: "Classes",
          publicRoutes: ["/classes"],
          privateRoutes: ["/my/agenda"],
          adminRoutes: [],
        },
      ],
    };
    const { runner, calls } = makeRunner({
      artifactFor: (agent) =>
        agent === "qa-reviewer"
          ? ({ decision: "go", violations: [] } satisfies QaArtifactV3)
          : { agent },
    });
    const result = await runGenerationV3({
      ...base(),
      runner,
      seedArtifacts: { architect: recordedArchitect },
    });
    // architect was NOT invoked by the runner — it was seeded.
    expect(calls.some((c) => c.agent === "architect")).toBe(false);
    // The seeded artifact landed in result.artifacts verbatim.
    expect(result.artifacts.architect).toEqual(recordedArchitect);
    // Other agents still ran (24 - 1 seeded = 23 calls).
    expect(calls.length).toBe(23);
  });
});

// ─── runGenerationV3 — step-by-step ─────────────────────────────────

describe("runGenerationV3 — step-by-step", () => {
  it("calls approvalResolver after each wave when set", async () => {
    const { runner } = makeRunner();
    const visited: string[] = [];
    const resolver: ApprovalResolver = async (wave) => {
      visited.push(wave);
      return { kind: "approve" };
    };
    const result = await runGenerationV3({
      ...base(),
      runner,
      approvalResolver: resolver,
    });
    expect(result.failedAt).toBeUndefined();
    expect(visited).toEqual(WAVES_V3.map((w) => w.name));
    expect(result.lastApproval?.decision.kind).toBe("approve");
  });

  it("re-runs a wave when the human rejects it", async () => {
    const { runner, calls } = makeRunner();
    const rejectsOnce = new Map<string, number>();
    const resolver: ApprovalResolver = async (wave) => {
      const seen = rejectsOnce.get(wave) ?? 0;
      rejectsOnce.set(wave, seen + 1);
      if (wave === "wave-2-design" && seen === 0) {
        return { kind: "reject", reason: "I want a darker palette" };
      }
      return { kind: "approve" };
    };
    const events: OrchestratorV3Event[] = [];
    const result = await runGenerationV3({
      ...base(),
      runner,
      approvalResolver: resolver,
      emit: async (e) => void events.push(e),
    });
    expect(result.failedAt).toBeUndefined();
    // wave-2-design has 3 agents and was run twice → 6 calls
    const w2DesignCalls = calls.filter((c) =>
      ["ux-ui-designer", "layout-architect", "brand-identity"].includes(c.agent),
    );
    expect(w2DesignCalls.length).toBe(6);
    // On the second run, runner receives humanFeedback
    expect(w2DesignCalls.filter((c) => c.humanFeedback === "I want a darker palette").length).toBe(3);
    // Events include wave.rejected
    expect(events.some((e) => e.type === "wave.rejected")).toBe(true);
  });

  it("inspect doesn't re-run the wave, just re-prompts", async () => {
    const { runner, calls } = makeRunner();
    const inspects: Record<string, number> = {};
    const resolver: ApprovalResolver = async (wave) => {
      const seen = inspects[wave] ?? 0;
      inspects[wave] = seen + 1;
      if (wave === "wave-1-bootstrap" && seen === 0) {
        return { kind: "inspect" };
      }
      return { kind: "approve" };
    };
    const events: OrchestratorV3Event[] = [];
    await runGenerationV3({
      ...base(),
      runner,
      approvalResolver: resolver,
      emit: async (e) => void events.push(e),
    });
    // bootstrap-devops should be called exactly once (inspect doesn't re-run)
    expect(calls.filter((c) => c.agent === "bootstrap-devops").length).toBe(1);
    expect(events.some((e) => e.type === "wave.paused")).toBe(true);
  });
});

// ─── groupViolationsByAgentV3 ───────────────────────────────────────

describe("groupViolationsByAgentV3 — 3-strategy routing", () => {
  it("prefers explicit `agent` field when valid", () => {
    const groups = groupViolationsByAgentV3([
      { rule: "X", severity: "error", agent: "bootstrap-devops", message: "..." },
      { rule: "Y", severity: "error", agent: "ui-components", message: "..." },
    ]);
    expect(groups.has("bootstrap-devops")).toBe(true);
    expect(groups.has("ui-components")).toBe(true);
  });

  it("falls back to `file` path when agent missing", () => {
    const groups = groupViolationsByAgentV3([
      { rule: "X", severity: "error", file: "docker-compose.yml", message: "..." },
    ]);
    expect(groups.get("bootstrap-devops")).toHaveLength(1);
  });

  it("falls back to legacy `where` when file missing", () => {
    const groups = groupViolationsByAgentV3([
      { rule: "X", severity: "error", where: "prisma/schema.prisma", message: "..." },
    ]);
    expect(groups.get("persistence")).toHaveLength(1);
  });

  it("drops violations with severity != error", () => {
    const groups = groupViolationsByAgentV3([
      { rule: "warn-only", severity: "warn", agent: "bootstrap-devops", message: "..." },
    ]);
    expect(groups.size).toBe(0);
  });

  it("ignores unknown agent name in agent field", () => {
    const groups = groupViolationsByAgentV3([
      { rule: "X", severity: "error", agent: "not-a-real-agent", file: "scripts/setup.sh", message: "..." },
    ]);
    // Falls through to file routing → bootstrap-devops
    expect(groups.get("bootstrap-devops")).toHaveLength(1);
  });
});

// ─── preWaveGates ───────────────────────────────────────────────────

describe("runGenerationV3 — preWaveGates", () => {
  const minimalWaves: WaveV3[] = [
    { name: "wave-1-discovery", agents: ["discovery"], dependsOn: [] },
    { name: "wave-1-bootstrap", agents: ["bootstrap-devops"], dependsOn: ["wave-1-discovery"] },
  ];

  it("runs gates before the wave and skips the wave on a blocking violation", async () => {
    const { runner, calls } = makeRunner();
    const blockingGate: PreWaveGate = {
      name: "runtime-smoke",
      run: async () =>
        [
          {
            rule: "app-not-running",
            severity: "error",
            agent: "bootstrap-devops",
            message: "fake-app down",
            recommendedFix: "fake-fix",
          } satisfies QaViolationV3,
        ] as const,
    };
    const events: OrchestratorV3Event[] = [];
    const result = await runGenerationV3({
      ...base(),
      runner,
      waves: minimalWaves,
      preWaveGates: {
        "wave-1-bootstrap": [blockingGate],
      },
      emit: async (e) => void events.push(e),
    });

    // discovery runs, bootstrap-devops does NOT (skipped)
    expect(calls.map((c) => c.agent)).toEqual(["discovery"]);
    expect(result.skippedWaves).toEqual(["wave-1-bootstrap"]);
    expect(result.gateViolations).toHaveLength(1);
    expect(result.gateViolations[0]?.rule).toBe("app-not-running");
    expect(events.some((e) => e.type === "gate.started" && e.gate === "runtime-smoke")).toBe(true);
    expect(events.some((e) => e.type === "gate.completed" && !e.passed)).toBe(true);
    expect(events.some((e) => e.type === "wave.skipped")).toBe(true);
  });

  it("runs the wave normally when gate emits only warn-severity violations", async () => {
    const { runner, calls } = makeRunner();
    const warnGate: PreWaveGate = {
      name: "runtime-smoke",
      run: async () =>
        [
          {
            rule: "probe-slow",
            severity: "warn",
            agent: "api-backend",
            message: "kept passing but was slow",
            recommendedFix: "profile route handler",
          } satisfies QaViolationV3,
        ] as const,
    };
    const events: OrchestratorV3Event[] = [];
    const result = await runGenerationV3({
      ...base(),
      runner,
      waves: minimalWaves,
      preWaveGates: { "wave-1-bootstrap": [warnGate] },
      emit: async (e) => void events.push(e),
    });

    // Both agents ran (gate did not block)
    expect(calls.map((c) => c.agent).sort()).toEqual(["bootstrap-devops", "discovery"]);
    expect(result.skippedWaves).toEqual([]);
    expect(result.gateViolations).toHaveLength(1);
    expect(result.gateViolations[0]?.severity).toBe("warn");
    expect(events.find((e) => e.type === "gate.completed")?.passed).toBe(true);
  });

  it("runs multiple gates sequentially; first error-violation stops invocation of agents", async () => {
    const gateRuns: string[] = [];
    const passGate: PreWaveGate = {
      name: "gate-a",
      run: async () => {
        gateRuns.push("gate-a");
        return [];
      },
    };
    const blockGate: PreWaveGate = {
      name: "gate-b",
      run: async () => {
        gateRuns.push("gate-b");
        return [
          {
            rule: "blocked",
            severity: "error",
            agent: "bootstrap-devops",
            message: "block message",
            recommendedFix: "fix it",
          } satisfies QaViolationV3,
        ];
      },
    };
    const { runner, calls } = makeRunner();
    const result = await runGenerationV3({
      ...base(),
      runner,
      waves: minimalWaves,
      preWaveGates: { "wave-1-bootstrap": [passGate, blockGate] },
    });
    expect(gateRuns).toEqual(["gate-a", "gate-b"]);
    // bootstrap-devops did not run; discovery did
    expect(calls.map((c) => c.agent)).toEqual(["discovery"]);
    expect(result.skippedWaves).toEqual(["wave-1-bootstrap"]);
  });

  it("emits generation.failed when a gate throws", async () => {
    const throwingGate: PreWaveGate = {
      name: "broken-gate",
      run: async () => {
        throw new Error("gate exploded");
      },
    };
    const events: OrchestratorV3Event[] = [];
    const result = await runGenerationV3({
      ...base(),
      waves: minimalWaves,
      preWaveGates: { "wave-1-bootstrap": [throwingGate] },
      emit: async (e) => void events.push(e),
    });
    const failed = events.find((e) => e.type === "generation.failed");
    expect(failed).toBeDefined();
    expect("reason" in (failed ?? {}) && (failed as { reason: string }).reason).toMatch(/broken-gate/);
    expect(result.gateViolations).toEqual([]);
  });
});

// ─── postWaveGates ──────────────────────────────────────────────────

describe("runGenerationV3 — postWaveGates", () => {
  const minimalWaves: WaveV3[] = [
    { name: "wave-1-discovery", agents: ["discovery"], dependsOn: [] },
  ];

  it("runs the post-gate AFTER the wave (wave already ran, agents called)", async () => {
    const { runner, calls } = makeRunner();
    let observedArtifactsAtGate: unknown;
    const postGate: PostWaveGate = {
      name: "cross-coherence",
      run: async (ctx) => {
        // discovery's artifact must be available
        observedArtifactsAtGate = ctx.artifacts["discovery"];
        return [];
      },
    };
    const result = await runGenerationV3({
      ...base(),
      runner,
      waves: minimalWaves,
      postWaveGates: { "wave-1-discovery": [postGate] },
    });
    expect(calls.length).toBe(1); // wave ran
    expect(observedArtifactsAtGate).toBeDefined();
    expect(result.skippedWaves).toEqual([]);
  });

  it("accumulates post-gate violations into gateViolations[]", async () => {
    const { runner } = makeRunner();
    const postGate: PostWaveGate = {
      name: "cross-coherence",
      run: async () =>
        [
          {
            rule: "layout-tree-orphan",
            severity: "error",
            agent: "architect",
            message: "ghost route in layout-tree",
            recommendedFix: "remove or declare",
          } satisfies QaViolationV3,
        ] as const,
    };
    const events: OrchestratorV3Event[] = [];
    const result = await runGenerationV3({
      ...base(),
      runner,
      waves: minimalWaves,
      postWaveGates: { "wave-1-discovery": [postGate] },
      emit: async (e) => void events.push(e),
    });
    expect(result.gateViolations).toHaveLength(1);
    expect(result.gateViolations[0]?.rule).toBe("layout-tree-orphan");
    // Wave still ran successfully (post-gate violations don't skip)
    expect(result.skippedWaves).toEqual([]);
    expect(events.find((e) => e.type === "gate.completed" && e.gate === "cross-coherence" && !e.passed)).toBeDefined();
  });

  it("emits generation.failed when a post-gate throws", async () => {
    const throwingGate: PostWaveGate = {
      name: "broken-post-gate",
      run: async () => {
        throw new Error("post-gate exploded");
      },
    };
    const events: OrchestratorV3Event[] = [];
    const result = await runGenerationV3({
      ...base(),
      waves: minimalWaves,
      postWaveGates: { "wave-1-discovery": [throwingGate] },
      emit: async (e) => void events.push(e),
    });
    const failed = events.find((e) => e.type === "generation.failed");
    expect(failed).toBeDefined();
    expect("reason" in (failed ?? {}) && (failed as { reason: string }).reason).toMatch(/broken-post-gate/);
    expect(result.gateViolations).toEqual([]);
  });
});

// Compile-time check that types stay aligned.
describe("type plumbing", () => {
  it("AgentRunnerV3 input is AgentRunInputV3", () => {
    const r: AgentRunnerV3 = async (i) => ({ artifact: i, filesCreated: [], summary: "ok" });
    void r;
  });

  it("ApprovalResolver returns ApprovalDecision", () => {
    const r: ApprovalResolver = async () => ({ kind: "approve" } satisfies ApprovalDecision);
    void r;
  });

  it("WaveV3 names cover all 10 slices", () => {
    const expected: WaveV3["name"][] = [
      "wave-1-discovery",
      "wave-1-bootstrap",
      "wave-1-planning",
      "wave-2-design",
      "wave-2-domain",
      "wave-3-app-security",
      "wave-4-presentation",
      "wave-5-data-tests",
      "wave-6-static-qa",
      "wave-7-runtime-qa",
    ];
    expect(WAVES_V3.map((w) => w.name)).toEqual(expected);
  });
});

// ─── Stitch reprompt loop (rework Punto C) + skip-resume ────────────

/**
 * The Stitch reprompt loop fires when a post-wave-2-design gate emits any
 * of these three rules with severity 'error':
 *   - stitch-missing-page
 *   - stitch-missing-critical-element
 *   - stitch-thin-section
 *
 * Behaviour contract under test:
 *   1. On first detection: wave-2-design re-runs WITH skip-resume —
 *      ux-ui-designer + brand-identity are NOT re-invoked (their artifacts
 *      were preserved); only layout-architect re-runs. This prevents token
 *      burn on agents whose work is still valid.
 *   2. Tries up to 2 reprompts. On the third encounter (after attempts 0
 *      and 1 both produced gaps), the orchestrator activates plan B:
 *      `requiresHumanReview: true` is set on the result, the wave stops
 *      re-running, and the generation proceeds to wave-2-domain etc.
 *   3. The runner receives humanFeedback containing the reprompt counter
 *      and the path to .atelier/stitch-failures.json each time it re-runs.
 */
describe("runGenerationV3 — Stitch reprompt loop (rework Punto C)", () => {
  /**
   * Builds a runner that records which agents were invoked per attempt.
   * Returns artifacts whose shape matches the orchestrator's expectation:
   * `qa-reviewer` always returns `go` so the fix loop is skipped.
   */
  function repromptRunner() {
    const callsPerAgent = new Map<string, number>();
    const humanFeedbacks: string[] = [];
    const runner: AgentRunnerV3 = async (input) => {
      callsPerAgent.set(input.agent, (callsPerAgent.get(input.agent) ?? 0) + 1);
      if (input.humanFeedback) humanFeedbacks.push(input.humanFeedback);
      return {
        artifact:
          input.agent === "qa-reviewer"
            ? ({ decision: "go", violations: [] } satisfies QaArtifactV3)
            : { agent: input.agent, attemptOrFixRound: input.fixRound },
        filesCreated: [],
        summary: `${input.agent.toUpperCase()}_DONE`,
      };
    };
    return { runner, callsPerAgent, humanFeedbacks };
  }

  /**
   * Builds a post-wave gate that emits stitch-missing-page on the first N
   * calls, then succeeds. Models a flaky Stitch that needs a reprompt or
   * two to produce complete HTML.
   */
  function gateThatFailsNTimes(n: number): PostWaveGate {
    let invocations = 0;
    return {
      name: "stitch-completeness-scanner",
      async run() {
        invocations++;
        if (invocations <= n) {
          return [
            {
              rule: "stitch-missing-page",
              severity: "error",
              agent: "layout-architect",
              file: ".atelier/stitch-analysis.json",
              message: `Synthetic gap on attempt ${invocations}`,
              recommendedFix: "Re-prompt Stitch",
            },
          ];
        }
        return [];
      },
    };
  }

  it("re-runs ONLY layout-architect on the reprompt (skip-resume preserves siblings)", async () => {
    const { runner, callsPerAgent, humanFeedbacks } = repromptRunner();
    const result = await runGenerationV3({
      ...base(),
      runner,
      postWaveGates: {
        "wave-2-design": [gateThatFailsNTimes(1)],
      },
    });
    expect(result.failedAt).toBeUndefined();
    expect(result.requiresHumanReview).toBeUndefined();
    // The reprompt fires once: layout-architect runs twice.
    expect(callsPerAgent.get("layout-architect")).toBe(2);
    // ux-ui-designer + brand-identity were preserved → called exactly once.
    expect(callsPerAgent.get("ux-ui-designer")).toBe(1);
    expect(callsPerAgent.get("brand-identity")).toBe(1);
    // humanFeedback was set on the reprompt invocation.
    expect(humanFeedbacks.some((f) => f.includes("STITCH_REPROMPT_ATTEMPT=1"))).toBe(true);
    expect(humanFeedbacks.some((f) => f.includes("stitch-failures.json"))).toBe(true);
  });

  it("activates plan B (requiresHumanReview) after 2 failed reprompts", async () => {
    const { runner, callsPerAgent } = repromptRunner();
    const result = await runGenerationV3({
      ...base(),
      runner,
      postWaveGates: {
        // Gate fails on attempts 1, 2, 3 — orchestrator only allows 2 reprompts,
        // so plan B activates after the 3rd failed gate.
        "wave-2-design": [gateThatFailsNTimes(99)],
      },
    });
    expect(result.requiresHumanReview).toBe(true);
    // layout-architect ran 3 times total: original + 2 reprompts. No more.
    expect(callsPerAgent.get("layout-architect")).toBe(3);
    // Siblings still preserved across both reprompts.
    expect(callsPerAgent.get("ux-ui-designer")).toBe(1);
    expect(callsPerAgent.get("brand-identity")).toBe(1);
    // Downstream waves still ran (run continues with placeholders).
    expect(callsPerAgent.get("domain-modeler")).toBe(1);
    expect(callsPerAgent.get("visual-adapter")).toBe(1);
    expect(callsPerAgent.get("qa-reviewer")).toBe(1);
  });

  it("plan B path produces requiresHumanReview=true AND downstream waves continue — NOT skippedWaves (B7 fix)", async () => {
    // This is the F3-retry bug regression test. Pre-B7 the plan B path
    // could finish in skippedWaves[wave-2-design] with requiresHumanReview
    // unset, because a pre-gate replay would emit a blocking violation
    // and trigger wave-skip BEFORE plan B activated. After B7 + B8, the
    // budget-exhaust path lands cleanly on requiresHumanReview.
    const { runner } = repromptRunner();
    const result = await runGenerationV3({
      ...base(),
      runner,
      postWaveGates: {
        "wave-2-design": [gateThatFailsNTimes(99)],
      },
    });
    expect(result.requiresHumanReview).toBe(true);
    // wave-2-design must NOT be in skippedWaves — it completed, plan B
    // is the outcome. Skip would mean "downstream loses the wave's
    // outputs"; we want them, even degraded.
    expect(result.skippedWaves).not.toContain("wave-2-design");
    // failedAt should be undefined — plan B is not a failure.
    expect(result.failedAt).toBeUndefined();
  });

  it("does NOT reprompt when the gate is clean on first pass", async () => {
    const { runner, callsPerAgent } = repromptRunner();
    const result = await runGenerationV3({
      ...base(),
      runner,
      postWaveGates: {
        "wave-2-design": [gateThatFailsNTimes(0)],
      },
    });
    expect(result.requiresHumanReview).toBeUndefined();
    expect(callsPerAgent.get("layout-architect")).toBe(1);
    expect(callsPerAgent.get("ux-ui-designer")).toBe(1);
    expect(callsPerAgent.get("brand-identity")).toBe(1);
  });

  it("does NOT reprompt when a non-stitch rule triggers a violation — but escalates via honesty check (B12)", async () => {
    // Pre-B12 this test asserted requiresHumanReview was undefined: a
    // non-Stitch error-severity violation would silently survive to the
    // final return. That assumption was the bug — F3-run-4 surfaced 2
    // layout-tree-orphan errors and the run still reported success.
    //
    // Post-B12 the honesty catch-all flips requiresHumanReview = true
    // whenever a wave's final iteration leaves error-severity gate
    // violations unremediated. Reprompt behaviour is unchanged: the
    // Stitch loop is rule-scoped, the catch-all is severity-scoped.
    const { runner, callsPerAgent } = repromptRunner();
    const unrelatedGate: PostWaveGate = {
      name: "unrelated-coherence-scanner",
      async run() {
        return [
          {
            rule: "layout-tree-orphan",
            severity: "error",
            agent: "architect",
            file: ".atelier/layout-tree.json",
            message: "orphan",
            recommendedFix: "fix it",
          },
        ];
      },
    };
    const result = await runGenerationV3({
      ...base(),
      runner,
      postWaveGates: { "wave-2-design": [unrelatedGate] },
    });
    // No reprompt: the rule isn't in STITCH_REPROMPT_RULES.
    expect(callsPerAgent.get("layout-architect")).toBe(1);
    expect(result.gateViolations.some((v) => v.rule === "layout-tree-orphan")).toBe(true);
    // Honesty escalation: unremediated error-severity → human review.
    expect(result.requiresHumanReview).toBe(true);
    // It's an escalation, not a failure — failedAt stays undefined.
    expect(result.failedAt).toBeUndefined();
  });
});

// ─── Honesty escalation catch-all (B12) ────────────────────────────
//
// Contract: a run cannot honestly report success while carrying error-
// severity gate violations from the FINAL iteration of any wave. The
// existing Stitch reprompt loop covers stitch-* rules; this catch-all
// covers any other rule (coherence, custom gates) that emits errors
// the orchestrator has no recovery path for.
//
// Failure mode this prevents: F3-run-4 finished with 2 layout-tree-orphan
// error-severity violations from cross-artifact-coherence-scanner AND
// requiresHumanReview=no, failedAt=—. False success. The catch-all turns
// that into requiresHumanReview=true while keeping the run "complete".

describe("runGenerationV3 — honesty escalation (B12)", () => {
  it("residual error-severity gate violation on final iteration flips requiresHumanReview", async () => {
    // Reproduces F3-run-4: 2 layout-tree-orphan errors emitted by a
    // post-gate at wave-2-design, no Stitch reprompt (rule out of scope),
    // run otherwise completes happily. The catch-all must flip the flag.
    const { runner } = makeRunner({
      artifactFor: (agent) =>
        agent === "qa-reviewer"
          ? ({ decision: "go", violations: [] } satisfies QaArtifactV3)
          : { agent },
    });
    const coherenceLikeGate: PostWaveGate = {
      name: "cross-artifact-coherence-scanner",
      async run() {
        return [
          {
            rule: "layout-tree-orphan",
            severity: "error",
            agent: "architect",
            file: ".atelier/layout-tree.json",
            message:
              "Page '/my/classes' in layout-tree.json has no matching route in architect.json.",
            recommendedFix: "Declare /my/classes in architect.features[].privateRoutes.",
          },
          {
            rule: "layout-tree-orphan",
            severity: "error",
            agent: "architect",
            file: ".atelier/layout-tree.json",
            message:
              "Page '/admin/memberships' in layout-tree.json has no matching route in architect.json.",
            recommendedFix:
              "Declare /admin/memberships in architect.features[].adminRoutes.",
          },
        ];
      },
    };
    const result = await runGenerationV3({
      ...base(),
      runner,
      postWaveGates: { "wave-2-design": [coherenceLikeGate] },
    });
    expect(result.requiresHumanReview).toBe(true);
    expect(result.failedAt).toBeUndefined();
    expect(result.gateViolations.filter((v) => v.rule === "layout-tree-orphan").length).toBe(2);
  });

  it("warnings-only do NOT trigger the escalation", async () => {
    const { runner } = makeRunner({
      artifactFor: (agent) =>
        agent === "qa-reviewer"
          ? ({ decision: "go", violations: [] } satisfies QaArtifactV3)
          : { agent },
    });
    const warningOnlyGate: PostWaveGate = {
      name: "warning-only-gate",
      async run() {
        return [
          {
            rule: "informational",
            severity: "warning",
            agent: "architect",
            file: ".atelier/something.json",
            message: "FYI only",
          },
        ];
      },
    };
    const result = await runGenerationV3({
      ...base(),
      runner,
      postWaveGates: { "wave-2-design": [warningOnlyGate] },
    });
    expect(result.requiresHumanReview).toBeUndefined();
    expect(result.gateViolations.some((v) => v.severity === "warning")).toBe(true);
  });

  it("convergence via Stitch reprompt does NOT trigger the escalation (the per-iteration counter resets)", async () => {
    // Wave-2-design fails on attempt 0 with stitch-missing-critical-element
    // (error), reprompts, then passes on attempt 1. The per-iteration
    // residual counter is overwritten — attempt 1's count is 0, so the
    // honesty check stays silent.
    const { runner } = makeRunner({
      artifactFor: (agent) =>
        agent === "qa-reviewer"
          ? ({ decision: "go", violations: [] } satisfies QaArtifactV3)
          : { agent },
    });
    let calls = 0;
    const flakyStitchGate: PostWaveGate = {
      name: "stitch-completeness-scanner",
      async run() {
        calls++;
        if (calls === 1) {
          return [
            {
              rule: "stitch-missing-critical-element",
              severity: "error",
              agent: "layout-architect",
              file: ".atelier/stitch-failures.json",
              message: "signin-form missing on /sign-in",
            },
          ];
        }
        return [];
      },
    };
    const result = await runGenerationV3({
      ...base(),
      runner,
      postWaveGates: { "wave-2-design": [flakyStitchGate] },
    });
    expect(result.requiresHumanReview).toBeUndefined();
    expect(result.failedAt).toBeUndefined();
    // The attempt-0 violation IS in gateViolations (cumulative) but the
    // final iteration was clean, which is what the catch-all checks.
    expect(
      result.gateViolations.some((v) => v.rule === "stitch-missing-critical-element"),
    ).toBe(true);
  });
});

// ─── Critical severity early-exit (deuda #10) ──────────────────────

/**
 * `severity: "critical"` bypasses the fix loop and the reprompt loop —
 * it represents contract-level breaches retries cannot recover from.
 * Tests cover the three injection sites: preWaveGate, postWaveGate,
 * qa-reviewer violations.
 */
describe("runGenerationV3 — critical severity early-exit", () => {
  it("preWaveGate critical violation fails the generation immediately", async () => {
    const { runner, callsPerAgent } = (() => {
      const calls = new Map<string, number>();
      const r: AgentRunnerV3 = async (input) => {
        calls.set(input.agent, (calls.get(input.agent) ?? 0) + 1);
        return {
          artifact:
            input.agent === "qa-reviewer"
              ? ({ decision: "go", violations: [] } satisfies QaArtifactV3)
              : { agent: input.agent },
          filesCreated: [],
          summary: `${input.agent.toUpperCase()}_DONE`,
        };
      };
      return { runner: r, callsPerAgent: calls };
    })();

    const criticalPreGate: PreWaveGate = {
      name: "policy-invariant",
      async run() {
        return [
          {
            rule: "policy-breach",
            severity: "critical",
            agent: "architect",
            file: ".atelier/architect.json",
            message: "architect violated a non-recoverable policy invariant",
          },
        ];
      },
    };

    const result = await runGenerationV3({
      ...base(),
      runner,
      preWaveGates: { "wave-1-planning": [criticalPreGate] },
    });

    expect(result.failedAt?.wave).toBe("wave-1-planning");
    expect(result.failedAt?.reason).toContain("policy-breach");
    expect(callsPerAgent.get("architect")).toBeUndefined(); // wave didn't run
    expect(callsPerAgent.get("qa-reviewer")).toBeUndefined(); // downstream skipped
  });

  it("postWaveGate critical violation fails the generation immediately", async () => {
    let architectCalls = 0;
    let qaCalls = 0;
    const runner: AgentRunnerV3 = async (input) => {
      if (input.agent === "architect") architectCalls++;
      if (input.agent === "qa-reviewer") qaCalls++;
      return {
        artifact:
          input.agent === "qa-reviewer"
            ? ({ decision: "go", violations: [] } satisfies QaArtifactV3)
            : { agent: input.agent },
        filesCreated: [],
        summary: `${input.agent.toUpperCase()}_DONE`,
      };
    };

    const criticalPostGate: PostWaveGate = {
      name: "post-architect-policy",
      async run() {
        return [
          {
            rule: "architect-emitted-forbidden-route",
            severity: "critical",
            agent: "architect",
            file: ".atelier/architect.json",
            message: "forbidden /admin/super-root route declared",
          },
        ];
      },
    };

    const result = await runGenerationV3({
      ...base(),
      runner,
      postWaveGates: { "wave-1-planning": [criticalPostGate] },
    });

    expect(result.failedAt?.wave).toBe("wave-1-planning");
    expect(result.failedAt?.reason).toContain("architect-emitted-forbidden-route");
    expect(architectCalls).toBe(1); // wave DID run, gate caught it after
    expect(qaCalls).toBe(0); // downstream skipped
  });

  it("qa-reviewer critical violation skips the fix loop and fails immediately", async () => {
    let fixRoundCalls = 0;
    const runner: AgentRunnerV3 = async (input) => {
      if (input.fixRound > 0) fixRoundCalls++;
      if (input.agent === "qa-reviewer") {
        return {
          artifact: {
            decision: "no-go",
            violations: [
              {
                rule: "non-recoverable-policy-breach",
                severity: "critical",
                agent: "architect",
                file: ".atelier/architect.json",
                message: "architecture violates compliance invariant — manual intervention required",
              },
            ],
          } satisfies QaArtifactV3,
          filesCreated: [],
          summary: "QA_DONE",
        };
      }
      return {
        artifact: { agent: input.agent },
        filesCreated: [],
        summary: "DONE",
      };
    };

    const result = await runGenerationV3({ ...base(), runner });

    expect(result.failedAt).toBeUndefined(); // qa critical doesn't carry a wave
    expect(fixRoundCalls).toBe(0); // fix loop was bypassed
    expect(result.qa?.decision).toBe("no-go");
  });

  it("preserves error/warn semantics — non-critical violations still go through the regular paths", async () => {
    let fixRoundCalls = 0;
    const runner: AgentRunnerV3 = async (input) => {
      if (input.fixRound > 0) fixRoundCalls++;
      if (input.agent === "qa-reviewer") {
        return {
          artifact: {
            decision: input.fixRound === 0 ? "no-go" : "go",
            violations:
              input.fixRound === 0
                ? [
                    {
                      rule: "ordinary-error",
                      severity: "error",
                      agent: "architect",
                      file: "x",
                      message: "fixable",
                    },
                  ]
                : [],
          } satisfies QaArtifactV3,
          filesCreated: [],
          summary: "QA_DONE",
        };
      }
      return {
        artifact: { agent: input.agent },
        filesCreated: [],
        summary: "DONE",
      };
    };

    const result = await runGenerationV3({ ...base(), runner, maxFixRounds: 1 });
    expect(fixRoundCalls).toBeGreaterThan(0); // fix loop DID run for severity=error
    expect(result.qa?.decision).toBe("go");
  });
});
