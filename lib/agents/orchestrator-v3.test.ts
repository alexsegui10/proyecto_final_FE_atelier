import { describe, it, expect } from "vitest";

import {
  WAVES_V3,
  generatorAgentOrderV3,
  groupViolationsByAgentV3,
  runGenerationV3,
  type AgentNameV3,
  type AgentRunnerV3,
  type AgentRunInputV3,
  type AgentRunResultV3,
  type ApprovalDecision,
  type ApprovalResolver,
  type OrchestratorV3Event,
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

  it("includes all 23 agents exactly once", () => {
    const counts = new Map<string, number>();
    for (const w of WAVES_V3) {
      for (const a of w.agents) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    expect(counts.size).toBe(23);
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

  it("places wave-4-presentation with 6 agents (5 v2 + animation-choreographer)", () => {
    const w4 = WAVES_V3.find((w) => w.name === "wave-4-presentation");
    expect(w4?.agents).toHaveLength(6);
    expect(w4?.agents).toContain("animation-choreographer");
  });

  it("generatorAgentOrderV3 returns 23 deterministic entries", () => {
    const order = generatorAgentOrderV3();
    expect(order).toHaveLength(23);
    expect(new Set(order).size).toBe(23);
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
    expect(calls.length).toBe(23);

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
