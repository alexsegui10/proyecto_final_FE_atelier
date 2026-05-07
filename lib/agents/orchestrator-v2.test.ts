import { describe, it, expect } from "vitest";

import {
  runGenerationV2,
  WAVES_V2,
  generatorAgentOrderV2,
  groupViolationsByAgent,
  type AgentRunInput,
  type AgentRunResult,
  type AgentRunner,
  type OrchestratorV2Event,
  type QaArtifactV2,
  type QaViolation,
  type Wave,
} from "./orchestrator-v2";

interface RunnerCall {
  agent: string;
  startedAt: number;
  finishedAt: number;
  fixRound: number;
}

function makeRunner(
  opts: {
    durationMs?: (agent: string) => number;
    artifactFor?: (agent: string, fixRound: number) => unknown;
    failOn?: string;
  } = {},
): { runner: AgentRunner; calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const runner: AgentRunner = async (input: AgentRunInput): Promise<AgentRunResult> => {
    const startedAt = Date.now();
    if (opts.failOn === input.agent) {
      throw new Error(`runner: forced failure on ${input.agent}`);
    }
    const ms = opts.durationMs ? opts.durationMs(input.agent) : 1;
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    const finishedAt = Date.now();
    calls.push({ agent: input.agent, startedAt, finishedAt, fixRound: input.fixRound });
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

const baseOpts = (overrides: Partial<Parameters<typeof runGenerationV2>[0]> = {}) => ({
  generationId: "test-gen-001",
  prd: { objective: "demo" },
  workDir: "/tmp/atelier-test",
  emit: async () => {},
  runner: makeRunner().runner,
  ...overrides,
});

describe("WAVES_V2 — structural sanity", () => {
  it("declares 8 waves in dependency order", () => {
    expect(WAVES_V2).toHaveLength(8);
    const seen = new Set<string>();
    for (const wave of WAVES_V2) {
      for (const dep of wave.dependsOn) {
        expect(seen.has(dep)).toBe(true);
      }
      seen.add(wave.name);
    }
  });

  it("has every wave dependency reference an existing wave name", () => {
    const names = new Set(WAVES_V2.map((w) => w.name));
    for (const wave of WAVES_V2) {
      for (const dep of wave.dependsOn) {
        expect(names.has(dep)).toBe(true);
      }
    }
  });

  it("includes all 17 agents exactly once across the wave list", () => {
    const counts = new Map<string, number>();
    for (const wave of WAVES_V2) {
      for (const agent of wave.agents) {
        counts.set(agent, (counts.get(agent) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(17);
    for (const [agent, count] of counts) {
      expect(count, `${agent} appears more than once`).toBe(1);
    }
  });

  it("places the densest wave (4 — presentation) with 5 agents", () => {
    const w4 = WAVES_V2.find((w) => w.name === "wave-4-presentation");
    expect(w4?.agents).toHaveLength(5);
  });

  it("generatorAgentOrderV2() returns the same 17 agents in deterministic order", () => {
    const order = generatorAgentOrderV2();
    expect(order).toHaveLength(17);
    expect(order[0]).toBe("discovery");
    expect(order[order.length - 1]).toBe("qa-reviewer");
  });
});

describe("runGenerationV2 — wave ordering", () => {
  it("runs waves sequentially, blocking each wave until its dependencies finished", async () => {
    const { runner, calls } = makeRunner({ durationMs: () => 5 });
    const events: OrchestratorV2Event[] = [];
    const emit = (e: OrchestratorV2Event) => {
      events.push(e);
    };

    await runGenerationV2(baseOpts({ runner, emit }));

    // Find wave.completed and wave.started events to verify dep order.
    const waveStartTimes = new Map<string, number>();
    const waveCompleteTimes = new Map<string, number>();
    events.forEach((e, idx) => {
      if (e.type === "wave.started") waveStartTimes.set(e.wave, idx);
      if (e.type === "wave.completed") waveCompleteTimes.set(e.wave, idx);
    });

    for (const wave of WAVES_V2) {
      for (const dep of wave.dependsOn) {
        const depCompleted = waveCompleteTimes.get(dep) ?? -1;
        const waveStarted = waveStartTimes.get(wave.name) ?? -1;
        expect(
          depCompleted < waveStarted,
          `${wave.name} started before ${dep} completed`,
        ).toBe(true);
      }
    }

    expect(calls).toHaveLength(17);
  });

  it("emits wave.started + wave.completed for each wave with the agents listed", async () => {
    const events: OrchestratorV2Event[] = [];
    await runGenerationV2(baseOpts({ emit: (e) => void events.push(e) }));

    for (const wave of WAVES_V2) {
      const started = events.find(
        (e): e is Extract<OrchestratorV2Event, { type: "wave.started" }> =>
          e.type === "wave.started" && e.wave === wave.name,
      );
      const completed = events.find(
        (e): e is Extract<OrchestratorV2Event, { type: "wave.completed" }> =>
          e.type === "wave.completed" && e.wave === wave.name,
      );
      expect(started).toBeDefined();
      expect(completed).toBeDefined();
      expect(started?.agents).toEqual(wave.agents);
      expect(completed?.results.map((r) => r.agent).sort()).toEqual([...wave.agents].sort());
    }
  });
});

describe("runGenerationV2 — parallelism within a wave", () => {
  it("runs the 5 agents of wave-4-presentation in parallel (overlapping spans)", async () => {
    // Each agent in wave 4 takes 50ms. If serial, total ~250ms; if parallel, ~50ms.
    const { runner, calls } = makeRunner({ durationMs: () => 50 });
    const wave4Only: Wave[] = [
      {
        name: "wave-4-presentation",
        agents: WAVES_V2.find((w) => w.name === "wave-4-presentation")!.agents,
        dependsOn: [],
      },
    ];

    const start = Date.now();
    await runGenerationV2(baseOpts({ runner, waves: wave4Only }));
    const total = Date.now() - start;

    expect(calls).toHaveLength(5);
    // Allow generous slack for CI noise — but parallel must clearly beat serial.
    expect(total, "wave-4 should run in parallel, not serial").toBeLessThan(200);

    // Verify spans actually overlap: pick the latest start vs earliest finish.
    const latestStart = Math.max(...calls.map((c) => c.startedAt));
    const earliestEnd = Math.min(...calls.map((c) => c.finishedAt));
    expect(latestStart).toBeLessThanOrEqual(earliestEnd);
  });

  it("runs the 3 agents of wave-2-domain concurrently", async () => {
    const { runner, calls } = makeRunner({ durationMs: () => 30 });
    const wave2Only: Wave[] = [
      {
        name: "wave-2-domain",
        agents: WAVES_V2.find((w) => w.name === "wave-2-domain")!.agents,
        dependsOn: [],
      },
    ];

    await runGenerationV2(baseOpts({ runner, waves: wave2Only }));

    expect(calls).toHaveLength(3);
    const latestStart = Math.max(...calls.map((c) => c.startedAt));
    const earliestEnd = Math.min(...calls.map((c) => c.finishedAt));
    expect(latestStart).toBeLessThanOrEqual(earliestEnd);
  });
});

describe("runGenerationV2 — failure handling", () => {
  it("returns failedAt when an agent throws and emits generation.failed", async () => {
    const { runner } = makeRunner({ failOn: "domain-modeler" });
    const events: OrchestratorV2Event[] = [];

    const result = await runGenerationV2(baseOpts({ runner, emit: (e) => void events.push(e) }));

    expect(result.failedAt).toBeDefined();
    expect(result.failedAt?.agent).toBe("domain-modeler");
    expect(result.failedAt?.wave).toBe("wave-2-domain");
    expect(events.some((e) => e.type === "generation.failed")).toBe(true);
    expect(events.some((e) => e.type === "agent.failed")).toBe(true);
  });

  it("does not start wave-3 if any wave-2 agent fails", async () => {
    const { runner, calls } = makeRunner({ failOn: "persistence" });
    await runGenerationV2(baseOpts({ runner }));
    const startedAgents = new Set(calls.map((c) => c.agent));
    expect(startedAgents.has("service-layer")).toBe(false);
    expect(startedAgents.has("auth-security")).toBe(false);
    expect(startedAgents.has("rbac-authorization")).toBe(false);
  });
});

describe("runGenerationV2 — fix loop", () => {
  function qaArtifactWithViolations(decision: "go" | "no-go", violations: QaViolation[]): QaArtifactV2 {
    return { decision, violations, summary: `qa decided ${decision}` };
  }

  it("invokes the fix loop when QA decides no-go and routes violations to v2 agents", async () => {
    let qaCallCount = 0;
    const violations: QaViolation[] = [
      {
        rule: "R8",
        severity: "error",
        where: "src/bookings/infrastructure/repository/BookingRepositoryImpl.ts:42",
        message: "missing import",
        recommendedFix: "import { BookingMapper } from ...",
      },
      {
        rule: "R12",
        severity: "error",
        where: "client/components/forms/CreateBookingForm.tsx:15",
        message: "missing zod resolver",
      },
    ];

    const fixCalls: Array<{ agent: string; fixRound: number }> = [];
    const runner: AgentRunner = async (input) => {
      if (input.agent === "qa-reviewer") {
        qaCallCount += 1;
        // Round 0 → no-go with violations. Round 1 → go.
        const decision = qaCallCount === 1 ? "no-go" : "go";
        const v = decision === "no-go" ? violations : [];
        return {
          artifact: qaArtifactWithViolations(decision, v),
          filesCreated: [],
          summary: `QA round ${qaCallCount}: ${decision}`,
        };
      }
      if (input.fixRound > 0) {
        fixCalls.push({ agent: input.agent, fixRound: input.fixRound });
      }
      return {
        artifact: { agent: input.agent, fixRound: input.fixRound },
        filesCreated: [],
        summary: `${input.agent} done`,
      };
    };

    const events: OrchestratorV2Event[] = [];
    const result = await runGenerationV2(
      baseOpts({ runner, emit: (e) => void events.push(e), maxFixRounds: 3 }),
    );

    expect(result.qa?.decision).toBe("go");
    // The violations should route to persistence (repo file) + forms-validations.
    const fixAgents = new Set(fixCalls.map((c) => c.agent));
    expect(fixAgents.has("persistence")).toBe(true);
    expect(fixAgents.has("forms-validations")).toBe(true);
    expect(events.some((e) => e.type === "qa.fix_round" && e.round === 1)).toBe(true);
    expect(events.some((e) => e.type === "agent.fix_started")).toBe(true);
    expect(events.some((e) => e.type === "agent.fix_completed")).toBe(true);
  });

  it("stops after maxFixRounds when QA never reaches go", async () => {
    const violations: QaViolation[] = [
      {
        rule: "R8",
        severity: "error",
        where: "src/bookings/domain/entity/Booking.ts:5",
        message: "type error",
      },
    ];
    let qaCalls = 0;
    const runner: AgentRunner = async (input) => {
      if (input.agent === "qa-reviewer") {
        qaCalls += 1;
        return {
          artifact: qaArtifactWithViolations("no-go", violations),
          filesCreated: [],
          summary: `QA call ${qaCalls}: no-go`,
        };
      }
      return {
        artifact: { agent: input.agent },
        filesCreated: [],
        summary: `${input.agent} done`,
      };
    };

    const events: OrchestratorV2Event[] = [];
    const result = await runGenerationV2(
      baseOpts({ runner, emit: (e) => void events.push(e), maxFixRounds: 2 }),
    );

    expect(result.qa?.decision).toBe("no-go");
    // 1 initial QA + 2 retries = 3 total
    expect(qaCalls).toBe(3);
    const fixRoundEvents = events.filter((e) => e.type === "qa.fix_round");
    expect(fixRoundEvents).toHaveLength(2);
  });

  it("skips the fix loop when maxFixRounds is 0", async () => {
    const runner: AgentRunner = async (input) => {
      if (input.agent === "qa-reviewer") {
        return {
          artifact: qaArtifactWithViolations("no-go", [
            {
              rule: "R8",
              severity: "error",
              where: "src/bookings/domain/entity/Booking.ts",
              message: "type error",
            },
          ]),
          filesCreated: [],
          summary: "QA: no-go",
        };
      }
      return {
        artifact: { agent: input.agent },
        filesCreated: [],
        summary: `${input.agent} done`,
      };
    };

    const events: OrchestratorV2Event[] = [];
    const result = await runGenerationV2(
      baseOpts({ runner, emit: (e) => void events.push(e), maxFixRounds: 0 }),
    );

    expect(result.qa?.decision).toBe("no-go");
    expect(events.some((e) => e.type === "qa.fix_round")).toBe(false);
  });
});

describe("groupViolationsByAgent", () => {
  it("groups error-level violations by their owning v2 agent", () => {
    const violations: QaViolation[] = [
      { rule: "R1", severity: "error", where: "src/bookings/domain/entity/Booking.ts" },
      { rule: "R2", severity: "error", where: "src/bookings/domain/dto/BookingDTO.ts" },
      { rule: "R3", severity: "error", where: "prisma/schema.prisma" },
      { rule: "R4", severity: "error", where: "client/components/forms/SignInForm.tsx" },
      { rule: "R5", severity: "warn", where: "src/bookings/domain/entity/Booking.ts" }, // skipped
      { rule: "R6", severity: "error", where: "" }, // unrouteable
    ];

    const grouped = groupViolationsByAgent(violations);
    expect(grouped.get("domain-modeler")).toHaveLength(2);
    expect(grouped.get("persistence")).toHaveLength(1);
    expect(grouped.get("forms-validations")).toHaveLength(1);
    expect(grouped.size).toBe(3); // unrouteable + warn dropped
  });

  it("returns an empty map when there are no error-level violations", () => {
    expect(groupViolationsByAgent([]).size).toBe(0);
    expect(
      groupViolationsByAgent([{ rule: "x", severity: "warn", where: "src/foo" }]).size,
    ).toBe(0);
  });
});

describe("WAVES_V2 — wave name guard", () => {
  it("throws if a wave depends on something declared after it", async () => {
    const badWaves: Wave[] = [
      { name: "wave-1-planning", agents: ["architect"], dependsOn: ["wave-1-design"] },
      { name: "wave-1-design", agents: ["ux-ui-designer"], dependsOn: [] },
    ];
    const { runner } = makeRunner();
    await expect(
      runGenerationV2(baseOpts({ runner, waves: badWaves })),
    ).rejects.toThrow(/has not run yet/);
  });
});
