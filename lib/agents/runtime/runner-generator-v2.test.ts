import { describe, it, expect } from "vitest";

import {
  runGeneratorAgentV2,
  buildUserPrompt,
  buildClaudeArgs,
  findStopSentinel,
  diffFiles,
  AGENT_CONFIG_V2,
  type AgentEvent,
  type SubprocessExecutor,
  type SubprocessExecutorResult,
} from "./runner-generator-v2";

// ─── Helpers ────────────────────────────────────────────────────────

function fakeExecutor(result: Partial<SubprocessExecutorResult>): SubprocessExecutor {
  return async (input) => {
    if (result.stdout) input.onStdout?.(result.stdout);
    if (result.stderr) input.onStderr?.(result.stderr);
    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      killedByTimeout: result.killedByTimeout ?? false,
    };
  };
}

function captureExecutor(captured: { args?: string[] }): SubprocessExecutor {
  return async (input) => {
    captured.args = input.args;
    return { exitCode: 0, stdout: "ARCHITECT_DONE: 4 features", stderr: "", killedByTimeout: false };
  };
}

const fakeWalk = (mtimes: Record<string, number> = {}) =>
  async (_root: string) => new Map<string, number>(Object.entries(mtimes));

const fakeRead = (artifact: unknown) => async (_p: string) => JSON.stringify(artifact);

// ─── Tests for pure helpers ─────────────────────────────────────────

describe("buildClaudeArgs", () => {
  it("includes --print --no-session-persistence and the system prompt", () => {
    const args = buildClaudeArgs({ systemPrompt: "be helpful", userPrompt: "hi" });
    expect(args).toContain("--print");
    expect(args).toContain("--no-session-persistence");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("be helpful");
    expect(args[args.length - 1]).toBe("hi");
  });

  it("does NOT include --model when omitted (agent uses caller default)", () => {
    const args = buildClaudeArgs({ systemPrompt: "x", userPrompt: "y" });
    expect(args).not.toContain("--model");
  });

  it("passes --model sonnet correctly when set", () => {
    const args = buildClaudeArgs({ systemPrompt: "x", userPrompt: "y", model: "sonnet" });
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("sonnet");
  });

  it("passes --model opus correctly when explicitly set", () => {
    const args = buildClaudeArgs({ systemPrompt: "x", userPrompt: "y", model: "opus" });
    const idx = args.indexOf("--model");
    expect(args[idx + 1]).toBe("opus");
  });
});

describe("findStopSentinel", () => {
  it("finds the LAST line starting with the prefix (sentinel may be repeated)", () => {
    const stdout = `working...\nARCHITECT_DONE: false\nstill working\nARCHITECT_DONE: 4 features, 8 components`;
    expect(findStopSentinel(stdout, "ARCHITECT_DONE")).toBe(
      "ARCHITECT_DONE: 4 features, 8 components",
    );
  });

  it("returns null when no line starts with the prefix", () => {
    expect(findStopSentinel("just chatting", "ARCHITECT_DONE")).toBeNull();
  });

  it("strips ANSI color escapes before matching", () => {
    const stdout = `\x1b[32mARCHITECT_DONE: ok\x1b[0m`;
    expect(findStopSentinel(stdout, "ARCHITECT_DONE")).toContain("ARCHITECT_DONE: ok");
  });

  it("returns null when stdout is empty", () => {
    expect(findStopSentinel("", "X")).toBeNull();
  });
});

describe("diffFiles", () => {
  it("flags a brand-new file as changed", () => {
    const before = new Map<string, number>();
    const after = new Map([["foo.ts", 1000]]);
    expect(diffFiles(before, after)).toEqual(["foo.ts"]);
  });

  it("flags a file whose mtime advanced past the 50ms slack", () => {
    const before = new Map([["foo.ts", 1000]]);
    const after = new Map([["foo.ts", 1100]]);
    expect(diffFiles(before, after)).toEqual(["foo.ts"]);
  });

  it("ignores files within the 50ms slack window", () => {
    const before = new Map([["foo.ts", 1000]]);
    const after = new Map([["foo.ts", 1030]]);
    expect(diffFiles(before, after)).toEqual([]);
  });

  it("ignores files that were deleted (only in `before`)", () => {
    const before = new Map([["foo.ts", 1000], ["bar.ts", 1000]]);
    const after = new Map([["foo.ts", 1000]]);
    expect(diffFiles(before, after)).toEqual([]);
  });

  it("returns paths sorted alphabetically", () => {
    const before = new Map<string, number>();
    const after = new Map([
      ["zeta.ts", 1000],
      ["alpha.ts", 1000],
      ["middle.ts", 1000],
    ]);
    expect(diffFiles(before, after)).toEqual(["alpha.ts", "middle.ts", "zeta.ts"]);
  });
});

describe("buildUserPrompt", () => {
  it("lists context artifact paths (not inline JSON) by default to keep the prompt short", () => {
    const prompt = buildUserPrompt({
      agent: "domain-modeler",
      workDir: "/tmp/foo",
      contextArtifacts: { discovery: { domain: "yoga" }, architect: { features: [] } },
    });
    // Path list, not embedded JSON — Windows CLI has ~8191 char limit, ENAMETOOLONG hits ~30KB+
    expect(prompt).toContain("`.atelier/discovery.json`");
    expect(prompt).toContain("`.atelier/architect.json`");
    expect(prompt).not.toContain('"domain": "yoga"');
  });

  it("inlines artifacts that are below the inlineArtifactsBelowBytes threshold", () => {
    const prompt = buildUserPrompt({
      agent: "domain-modeler",
      workDir: "/tmp/foo",
      contextArtifacts: { discovery: { domain: "yoga" } },
      inlineArtifactsBelowBytes: 1024,
    });
    expect(prompt).toContain('"domain": "yoga"');
  });

  it('inserts a "no previous artifacts" note when contextArtifacts is empty', () => {
    const prompt = buildUserPrompt({ agent: "discovery", workDir: "/tmp/foo" });
    expect(prompt).toContain("(no previous artifacts");
  });

  it("includes the agent name in the artifact-write instruction", () => {
    const prompt = buildUserPrompt({
      agent: "ux-ui-designer",
      workDir: "/tmp/foo",
    });
    expect(prompt).toContain(".atelier/ux-ui-designer.json");
  });

  it("includes additionalInstructions when provided", () => {
    const prompt = buildUserPrompt({
      agent: "domain-modeler",
      workDir: "/tmp/foo",
      additionalInstructions: "Skip the audit log feature for this run.",
    });
    expect(prompt).toContain("## Extra instructions");
    expect(prompt).toContain("Skip the audit log feature for this run.");
  });
});

// ─── AGENT_CONFIG_V2 sanity ─────────────────────────────────────────

describe("AGENT_CONFIG_V2", () => {
  it("has an entry for all 17 v2 agents", () => {
    expect(Object.keys(AGENT_CONFIG_V2)).toHaveLength(17);
  });

  it("uses the canonical SCREAMING_SNAKE_CASE for stop sentinels", () => {
    for (const [agent, cfg] of Object.entries(AGENT_CONFIG_V2)) {
      expect(cfg.stopSentinel).toMatch(/^[A-Z_]+_DONE$/);
      expect(cfg.stopSentinel).toBe(agent.toUpperCase().replace(/-/g, "_") + "_DONE");
    }
  });

  it("gives ui-components the largest timeout (most files to write)", () => {
    const ui = AGENT_CONFIG_V2["ui-components"].timeoutMs;
    for (const [agent, cfg] of Object.entries(AGENT_CONFIG_V2)) {
      if (agent === "ui-components") continue;
      expect(ui).toBeGreaterThanOrEqual(cfg.timeoutMs);
    }
  });

  it("seeds-shape gets a smaller timeout because it only writes one file", () => {
    expect(AGENT_CONFIG_V2["seeds-shape"].timeoutMs).toBeLessThanOrEqual(4 * 60_000);
  });
});

// ─── runGeneratorAgentV2 — end-to-end logic via injected executor ─

describe("runGeneratorAgentV2 — happy path", () => {
  it("returns status='completed' when stdout has the sentinel + artifact parses", async () => {
    const events: AgentEvent[] = [];
    const result = await runGeneratorAgentV2({
      agent: "architect",
      systemPrompt: "be the architect",
      workDir: "/tmp/atelier-test",
      _executor: fakeExecutor({ exitCode: 0, stdout: "ARCHITECT_DONE: 4 features" }),
      _walkFiles: fakeWalk(),
      _readArtifact: fakeRead({ features: [], roles: [] }),
      emitEvent: (e) => void events.push(e),
    });
    expect(result.status).toBe("completed");
    expect(result.artifact).toEqual({ features: [], roles: [] });
    expect(result.stopSentinel).toBe("ARCHITECT_DONE: 4 features");
    expect(events.some((e) => e.type === "started")).toBe(true);
    expect(events.some((e) => e.type === "completed")).toBe(true);
  });

  it("emits one file_created event per file detected via mtime diff", async () => {
    const events: AgentEvent[] = [];
    const before: Record<string, number> = { "package.json": 1000 };
    const after: Record<string, number> = {
      "package.json": 1000,
      ".atelier/architect.json": 5000,
      "src/auth/.gitkeep": 5000,
      "docs/ARCHITECTURE.md": 5000,
    };
    let callCount = 0;
    const walker = async (_r: string) =>
      new Map(Object.entries(callCount++ === 0 ? before : after));
    const result = await runGeneratorAgentV2({
      agent: "architect",
      systemPrompt: "be the architect",
      workDir: "/tmp/atelier-test",
      _executor: fakeExecutor({ exitCode: 0, stdout: "ARCHITECT_DONE: ok" }),
      _walkFiles: walker,
      _readArtifact: fakeRead({ features: [] }),
      emitEvent: (e) => void events.push(e),
    });
    const fileEvents = events.filter((e) => e.type === "file_created");
    expect(fileEvents).toHaveLength(3);
    expect(fileEvents.map((e) => e.type === "file_created" && e.path).sort()).toEqual([
      ".atelier/architect.json",
      "docs/ARCHITECTURE.md",
      "src/auth/.gitkeep",
    ]);
    expect(result.filesCreated).toHaveLength(3);
  });
});

describe("runGeneratorAgentV2 — failure modes", () => {
  it("returns status='timeout' when the executor reports timeout AND no artifact survived", async () => {
    const events: AgentEvent[] = [];
    const result = await runGeneratorAgentV2({
      agent: "architect",
      systemPrompt: "x",
      workDir: "/tmp/atelier-test",
      _executor: fakeExecutor({ exitCode: null, killedByTimeout: true, stdout: "..." }),
      _walkFiles: fakeWalk(),
      _readArtifact: async () => {
        throw new Error("ENOENT");
      },
      emitEvent: (e) => void events.push(e),
    });
    expect(result.status).toBe("timeout");
    expect(result.error).toContain("timed out");
    expect(events.some((e) => e.type === "timeout")).toBe(true);
  });

  it("tolerant timeout: status='completed' when timeout fires but artifact survived on disk", async () => {
    const events: AgentEvent[] = [];
    const result = await runGeneratorAgentV2({
      agent: "ux-ui-designer",
      systemPrompt: "x",
      workDir: "/tmp/atelier-test",
      _executor: fakeExecutor({
        exitCode: null,
        killedByTimeout: true,
        stdout: "UX_UI_DESIGNER_DONE: vibe=Calm, screens=6, components=18",
      }),
      _walkFiles: fakeWalk({ ".atelier/ux-ui-designer.json": 9999 }),
      _readArtifact: fakeRead({ vibe: "Calm" }),
      emitEvent: (e) => void events.push(e),
    });
    expect(result.status).toBe("completed");
    expect(result.artifact).toEqual({ vibe: "Calm" });
    const timeoutEvent = events.find((e) => e.type === "timeout");
    expect(timeoutEvent && timeoutEvent.type === "timeout" && timeoutEvent.artifactSurvived).toBe(true);
  });

  it("returns status='failed' when subprocess exits non-zero with no timeout", async () => {
    const events: AgentEvent[] = [];
    const result = await runGeneratorAgentV2({
      agent: "domain-modeler",
      systemPrompt: "x",
      workDir: "/tmp/atelier-test",
      _executor: fakeExecutor({ exitCode: 1, stderr: "claude: invalid model" }),
      _walkFiles: fakeWalk(),
      _readArtifact: fakeRead({}),
      emitEvent: (e) => void events.push(e),
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("exited with code 1");
    expect(result.error).toContain("invalid model");
  });

  it("returns status='failed' when the artifact JSON is missing or malformed", async () => {
    const result = await runGeneratorAgentV2({
      agent: "persistence",
      systemPrompt: "x",
      workDir: "/tmp/atelier-test",
      _executor: fakeExecutor({ exitCode: 0, stdout: "PERSISTENCE_DONE: ok" }),
      _walkFiles: fakeWalk(),
      _readArtifact: async () => "{not-json",
    });
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/persistence\.json/);
  });

  it("returns status='failed' when the agent never emits its stop sentinel", async () => {
    const result = await runGeneratorAgentV2({
      agent: "seeds-shape",
      systemPrompt: "x",
      workDir: "/tmp/atelier-test",
      _executor: fakeExecutor({
        exitCode: 0,
        stdout: "I forgot to say SEEDS_SHAPE-DONE", // missing underscore prefix
      }),
      _walkFiles: fakeWalk(),
      _readArtifact: fakeRead({ users: [], domainData: [] }),
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("did not emit SEEDS_SHAPE_DONE");
  });

  it("returns status='failed' when validateArtifact rejects the JSON", async () => {
    const result = await runGeneratorAgentV2({
      agent: "ux-ui-designer",
      systemPrompt: "x",
      workDir: "/tmp/atelier-test",
      _executor: fakeExecutor({ exitCode: 0, stdout: "UX_UI_DESIGNER_DONE: ok" }),
      _walkFiles: fakeWalk(),
      _readArtifact: fakeRead({ palette: "bad" }),
      validateArtifact: (a) => {
        const obj = a as { palette: unknown };
        if (typeof obj.palette !== "object") return "palette must be an object";
        return null;
      },
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("schema validation");
  });
});

describe("runGeneratorAgentV2 — CLI args", () => {
  it("forwards --model sonnet to the executor when input.model='sonnet'", async () => {
    const captured: { args?: string[] } = {};
    await runGeneratorAgentV2({
      agent: "architect",
      systemPrompt: "x",
      workDir: "/tmp/atelier-test",
      _executor: captureExecutor(captured),
      _walkFiles: fakeWalk(),
      _readArtifact: fakeRead({}),
      model: "sonnet",
    });
    const args = captured.args ?? [];
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("sonnet");
  });

  it("uses the per-agent default model when input.model is omitted (architect=opus)", async () => {
    const captured: { args?: string[] } = {};
    await runGeneratorAgentV2({
      agent: "architect",
      systemPrompt: "x",
      workDir: "/tmp/atelier-test",
      _executor: captureExecutor(captured),
      _walkFiles: fakeWalk(),
      _readArtifact: fakeRead({}),
    });
    const args = captured.args ?? [];
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("opus");
  });

  it("passes the system prompt as a CLI flag value", async () => {
    const captured: { args?: string[] } = {};
    await runGeneratorAgentV2({
      agent: "architect",
      systemPrompt: "you are the architect",
      workDir: "/tmp/atelier-test",
      _executor: captureExecutor(captured),
      _walkFiles: fakeWalk(),
      _readArtifact: fakeRead({}),
    });
    const args = captured.args ?? [];
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("you are the architect");
  });
});

describe("runGeneratorAgentV2 — context injection", () => {
  it("lists contextArtifacts as path references in the user prompt argument (NOT inline JSON)", async () => {
    const captured: { args?: string[] } = {};
    await runGeneratorAgentV2({
      agent: "domain-modeler",
      systemPrompt: "x",
      workDir: "/tmp/atelier-test",
      contextArtifacts: {
        discovery: { domain: "yoga", entities: [] },
        architect: { features: [{ name: "auth" }] },
      },
      _executor: captureExecutor(captured),
      _walkFiles: fakeWalk(),
      _readArtifact: fakeRead({}),
    });
    const userPrompt = captured.args?.[captured.args.length - 1] ?? "";
    expect(userPrompt).toContain("`.atelier/discovery.json`");
    expect(userPrompt).toContain("`.atelier/architect.json`");
    // Critical: NO inline JSON, otherwise Windows ENAMETOOLONG.
    expect(userPrompt).not.toContain('"domain": "yoga"');
    expect(userPrompt.length).toBeLessThan(2048);
  });
});

// ─── ATELIER_TIMEOUT_MULTIPLIER (deuda #25) ─────────────────────────
//
// Closes the F3-run-17..20 whack-a-mole: per-agent timeouts were bumped
// one at a time after each new agent timed out under the systemic ~1.5x
// claude.exe / API slowdown. The env-var multiplier applies uniformly
// at the single resolution site in runGeneratorAgentV2.
//
// Contract under test:
//   - When the multiplier is set, the timeoutMs reaching the executor
//     is the config baseline multiplied (rounded to int).
//   - When the caller passes `input.timeoutMs`, the override is LITERAL
//     (tests passing short values like 100ms must not be silently
//     multiplied — they'd time out unexpectedly).
//   - When the env var is unset or invalid, behavior matches pre-deuda
//     #25 (no multiplication).

function captureTimeoutExecutor(captured: { timeoutMs?: number }): SubprocessExecutor {
  return async (input) => {
    captured.timeoutMs = input.timeoutMs;
    return { exitCode: 0, stdout: "ARCHITECT_DONE: ok", stderr: "", killedByTimeout: false };
  };
}

describe("runGeneratorAgentV2 — ATELIER_TIMEOUT_MULTIPLIER (deuda #25)", () => {
  const ENV_KEY = "ATELIER_TIMEOUT_MULTIPLIER";

  it("passes config.timeoutMs literally when the env var is unset", async () => {
    delete process.env[ENV_KEY];
    const captured: { timeoutMs?: number } = {};
    await runGeneratorAgentV2({
      agent: "architect",
      systemPrompt: "x",
      workDir: "/tmp/atelier-test",
      _executor: captureTimeoutExecutor(captured),
      _walkFiles: fakeWalk(),
      _readArtifact: fakeRead({}),
    });
    expect(captured.timeoutMs).toBe(AGENT_CONFIG_V2.architect.timeoutMs);
  });

  it("multiplies config.timeoutMs uniformly when ATELIER_TIMEOUT_MULTIPLIER=1.5", async () => {
    process.env[ENV_KEY] = "1.5";
    try {
      const captured: { timeoutMs?: number } = {};
      await runGeneratorAgentV2({
        agent: "architect",
        systemPrompt: "x",
        workDir: "/tmp/atelier-test",
        _executor: captureTimeoutExecutor(captured),
        _walkFiles: fakeWalk(),
        _readArtifact: fakeRead({}),
      });
      // architect baseline = 5 * 60_000 = 300_000 → 1.5x = 450_000
      expect(captured.timeoutMs).toBe(Math.round(AGENT_CONFIG_V2.architect.timeoutMs * 1.5));
    } finally {
      delete process.env[ENV_KEY];
    }
  });

  it("does NOT multiply input.timeoutMs overrides (tests pass literal short values)", async () => {
    process.env[ENV_KEY] = "2";
    try {
      const captured: { timeoutMs?: number } = {};
      await runGeneratorAgentV2({
        agent: "architect",
        systemPrompt: "x",
        workDir: "/tmp/atelier-test",
        timeoutMs: 100, // literal override — must survive untouched
        _executor: captureTimeoutExecutor(captured),
        _walkFiles: fakeWalk(),
        _readArtifact: fakeRead({}),
      });
      expect(captured.timeoutMs).toBe(100);
    } finally {
      delete process.env[ENV_KEY];
    }
  });

  it("falls back to 1.0 (no multiplication) on invalid env values", async () => {
    process.env[ENV_KEY] = "garbage";
    try {
      const captured: { timeoutMs?: number } = {};
      await runGeneratorAgentV2({
        agent: "architect",
        systemPrompt: "x",
        workDir: "/tmp/atelier-test",
        _executor: captureTimeoutExecutor(captured),
        _walkFiles: fakeWalk(),
        _readArtifact: fakeRead({}),
      });
      expect(captured.timeoutMs).toBe(AGENT_CONFIG_V2.architect.timeoutMs);
    } finally {
      delete process.env[ENV_KEY];
    }
  });
});
