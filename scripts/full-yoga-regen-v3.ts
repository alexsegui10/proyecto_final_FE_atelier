/**
 * Atelier v3 — primer run real mínimo (yoga, waves 1-2).
 *
 * Pipeline ESTRECHO a propósito (fase F2.1 del enganche al runtime real):
 *
 *   1. Clone skeleton-v2 → out/yoga-regen-v3-<ts>/ (mismo skeleton que v2;
 *      esta fase no construye lifecycle de Next.js).
 *   2. Convert fixtures/yoga-prd.json → discovery v2 schema, inject como
 *      .atelier/discovery.json (Discovery agent SKIPPED — chat phase
 *      output prearmado, idéntico al v2).
 *   3. Correr orchestrator-v3 sobre el slice waves 1 + 2-design:
 *        wave-1-discovery (no-op, ya tenemos discovery.json)
 *        wave-1-bootstrap (bootstrap-devops, v3 net-new)
 *        wave-1-planning (architect, v2 reusado)
 *        wave-2-design (ux-ui-designer + layout-architect + brand-identity)
 *   4. Modo Stitch:
 *        --stitch-mode fixture (default cuando --real): pre-wave gate
 *          materialises HTML del fixture a disco; Layout Architect lo
 *          consume como manifest. Bucle reprompt usa attempts del fixture.
 *        --stitch-mode real: invoca MCP de Stitch directamente. Requiere
 *          STITCH_API_KEY + cuota. Reservado para corridas de validación
 *          contra Stitch genuino una vez que el cableado esté estable.
 *   5. Gates wired:
 *        preWaveGate wave-2-design: stitch-fixture-preparer (si modo fixture)
 *        postWaveGate wave-2-design: cross-artifact-coherence-scanner
 *        postWaveGate wave-2-design: stitch-completeness-scanner
 *   6. Reportar GO/NO-GO + workDir + requiresHumanReview.
 *
 * NO se incluye:
 *   - Lifecycle de la app generada (no spawneá next dev).
 *   - Wave 3-7 (visual-adapter, qa-reviewer, visual-qa, etc.).
 *   - Visual regression (depende de app corriendo).
 *   - runtime-smoke gate (depende de app corriendo).
 *   - pnpm install / pnpm qa (sin generación completa, no aplica).
 *
 * Usage:
 *   tsx scripts/full-yoga-regen-v3.ts --dry-run
 *   tsx scripts/full-yoga-regen-v3.ts --real --stitch-mode fixture --stitch-fixture fixtures/stitch-yoga.json
 */
import { mkdir, readFile, writeFile, cp, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  runGenerationV3,
  WAVES_V3,
  type AgentRunnerV3,
  type AgentRunInputV3,
  type AgentRunResultV3,
  type OrchestratorV3Event,
  type WaveV3,
  type WaveNameV3,
  type PostWaveGate,
  type PreWaveGate,
  type QaArtifactV3,
} from "../lib/agents/orchestrator-v3";
import { runGeneratorAgentV3 } from "../lib/agents/runtime/runner-generator-v3";
import type { AgentNameV3 } from "../lib/agents/contracts-v3/agent-names";
import { scanCrossArtifactCoherence } from "../lib/agents/runtime/qa-gates/cross-artifact-coherence-scanner";
import { createStitchCompletenessGate } from "../lib/agents/runtime/qa-gates/stitch-completeness-scanner";
import { createStitchFixturePreparerGate } from "../lib/agents/runtime/stitch-fixture-helper";

// ─── Paths + args ───────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, "..");
const SKELETON_V2 = join(REPO_ROOT, "lib", "skeleton-v2");
const PRD_FIXTURE = join(REPO_ROOT, "fixtures", "yoga-prd.json");

const ARGV = process.argv.slice(2);
const MODE_DRY_RUN = ARGV.includes("--dry-run");
const MODE_REAL = ARGV.includes("--real") || !MODE_DRY_RUN;
const STITCH_MODE = readFlagValue("--stitch-mode") ?? (MODE_REAL ? "fixture" : "synthetic");
const STITCH_FIXTURE = readFlagValue("--stitch-fixture");
const SLICE = readFlagValue("--slice") ?? "wave-1-2-design";

function readFlagValue(flag: string): string | null {
  const idx = ARGV.indexOf(flag);
  if (idx < 0 || idx + 1 >= ARGV.length) return null;
  const next = ARGV[idx + 1];
  return next && !next.startsWith("--") ? next : null;
}

// ─── Slice resolution ───────────────────────────────────────────────
//
// Discovery is intentionally absent from every slice: we inject the yoga
// PRD as `.atelier/discovery.json` before invoking the orchestrator, so
// re-running the discovery agent against a pre-baked PRD is wasted tokens.
// Same convention as `scripts/full-yoga-regen.ts` for v2.

const SLICE_DEFS: Record<string, ReadonlyArray<WaveNameV3>> = {
  // wave-1-discovery is included for the orchestrator's dependency check,
  // but its agent list is stripped (discovery.json was injected from the
  // PRD shim before the orchestrator started). The wave runs as a no-op.
  "wave-1-only": ["wave-1-discovery", "wave-1-bootstrap", "wave-1-planning"],
  "wave-1-2-design": [
    "wave-1-discovery",
    "wave-1-bootstrap",
    "wave-1-planning",
    "wave-2-design",
  ],
  all: WAVES_V3.map((w) => w.name),
};

function resolveSlice(): readonly WaveV3[] {
  const names = SLICE_DEFS[SLICE];
  if (!names) {
    throw new Error(
      `Unknown --slice value '${SLICE}'. Valid: ${Object.keys(SLICE_DEFS).join(", ")}`,
    );
  }
  const set = new Set(names);
  return WAVES_V3.filter((w) => set.has(w.name)).map((w) => {
    // Strip "discovery" agent everywhere — its artifact is preloaded.
    return { ...w, agents: w.agents.filter((a) => a !== "discovery") };
  });
}

// ─── Per-agent slot config (v3 real runner) ─────────────────────────
//
// Mirrors v2's AGENT_SLOTS pattern. For agents whose primary artifact
// filename doesn't match `<agent>.json` (e.g. bootstrap-devops emits
// `bootstrap.json`, ux-ui-designer slim emits `design-system.json`) we
// declare the override here. Layout Architect uses `artifactFile: false`
// because it emits three sibling files; we attach a bundleLoader that
// composes them into a single artifact for the orchestrator's
// `artifacts["layout-architect"]` slot (the cross-artifact-coherence and
// stitch-completeness gates both depend on that shape).

interface AgentSlotV3 {
  /** Path to the prompt .md, relative to REPO_ROOT. */
  promptRel: string;
  /** Primary artifact filename in .atelier/, or `false` to skip primary load. */
  artifactFile: string | false;
  /**
   * Optional loader invoked AFTER the runner returns. Receives workDir and
   * produces the artifact value that lands in
   * `result.artifacts[<agent>]`. Use when the agent emits multiple sibling
   * files (Layout Architect) or when the primary artifact needs reshaping.
   */
  bundleLoader?: (workDir: string) => Promise<unknown>;
}

const AGENT_SLOTS_V3: Partial<Record<AgentNameV3, AgentSlotV3>> = {
  "bootstrap-devops": {
    promptRel: "lib/agents/prompts-v3/bootstrap-devops.md",
    artifactFile: "bootstrap.json",
  },
  architect: {
    promptRel: "lib/agents/prompts-v2/architect.md",
    artifactFile: "architect.json",
  },
  "ux-ui-designer": {
    promptRel: "lib/agents/prompts-v3/ux-ui-designer.md",
    artifactFile: "design-system.json",
  },
  "layout-architect": {
    promptRel: "lib/agents/prompts-v3/layout-architect.md",
    artifactFile: false,
    bundleLoader: async (workDir) => {
      const atelier = join(workDir, ".atelier");
      const [lt, sa, tic] = await Promise.all([
        readFile(join(atelier, "layout-tree.json"), "utf8"),
        readFile(join(atelier, "stitch-analysis.json"), "utf8"),
        readFile(join(atelier, "test-id-contract.json"), "utf8"),
      ]);
      return {
        layoutTree: JSON.parse(lt),
        stitchAnalysis: JSON.parse(sa),
        testIdContract: JSON.parse(tic),
      };
    },
  },
  "brand-identity": {
    promptRel: "lib/agents/prompts-v3/brand-identity.md",
    artifactFile: "brand-identity.json",
  },
};

// ─── Pretty logger ──────────────────────────────────────────────────

const TS_START = Date.now();
let LOG_FILE: string | null = null;

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

async function log(stage: string, msg: string): Promise<void> {
  const line = `[${ts()}] [${stage}] ${msg}`;
  console.log(line);
  if (LOG_FILE) await appendFile(LOG_FILE, line + "\n").catch(() => {});
}

function describeEvent(e: OrchestratorV3Event): { stage: string; msg: string } | null {
  switch (e.type) {
    case "generation.started":
      return { stage: "orchestrator", msg: `▶ generation.started id=${e.generationId}` };
    case "generation.completed":
      return { stage: "orchestrator", msg: `✓ generation.completed — ${e.summary}` };
    case "generation.failed":
      return { stage: "orchestrator", msg: `✗ generation.failed — ${e.reason}` };
    case "wave.started":
      return { stage: "wave", msg: `▶ ${e.wave} — agents: [${e.agents.join(", ")}]` };
    case "wave.completed":
      return {
        stage: "wave",
        msg: `✓ ${e.wave} (${(e.durationMs / 1000).toFixed(2)}s) — ${e.results.map((r) => `${r.agent}:${r.status}`).join(" ")}`,
      };
    case "wave.paused":
      return { stage: "wave", msg: `⏸ ${e.wave} — ${e.reason}` };
    case "wave.skipped":
      return { stage: "wave", msg: `⊘ ${e.wave} skipped — ${e.reason}` };
    case "agent.started":
      return { stage: e.agent, msg: `▶ started (${e.wave})` };
    case "agent.completed":
      return { stage: e.agent, msg: `✓ ${e.summary}` };
    case "agent.failed":
      return { stage: e.agent, msg: `✗ ${e.reason}` };
    case "agent.file_created":
      return { stage: e.agent, msg: `  + ${e.path} (${e.lines} lines)` };
    case "gate.started":
      return { stage: "gate", msg: `▶ ${e.gate} on ${e.wave}` };
    case "gate.completed":
      return {
        stage: "gate",
        msg: `${e.passed ? "✓" : "✗"} ${e.gate} on ${e.wave} — ${e.violations} violation(s)`,
      };
    default:
      return null;
  }
}

// ─── Fake runner (dry-run mode) ─────────────────────────────────────

function makeFakeRunner(): AgentRunnerV3 {
  return async (input: AgentRunInputV3): Promise<AgentRunResultV3> => {
    if (input.agent === "qa-reviewer") {
      return {
        artifact: { decision: "go", violations: [] } satisfies QaArtifactV3,
        filesCreated: [],
        summary: "QA_REVIEWER_DONE (dry-run synthetic)",
      };
    }
    return {
      artifact: { agent: input.agent, dryRun: true },
      filesCreated: [],
      summary: `${input.agent.toUpperCase()}_DONE (dry-run synthetic)`,
    };
  };
}

// ─── Real runner (claude.exe subprocess) ────────────────────────────

async function listAtelierContextKeys(
  workDir: string,
  excludeFilename: string | null,
): Promise<string[]> {
  const atelier = join(workDir, ".atelier");
  if (!existsSync(atelier)) return [];
  const fs = await import("node:fs/promises");
  const entries = await fs.readdir(atelier);
  return entries
    .filter((e) => e.endsWith(".json") && (excludeFilename === null || e !== excludeFilename))
    .map((e) => e.replace(/\.json$/, ""));
}

function makeRealRunner(): AgentRunnerV3 {
  return async (input: AgentRunInputV3): Promise<AgentRunResultV3> => {
    const slot = AGENT_SLOTS_V3[input.agent];
    if (!slot) {
      throw new Error(
        `Agent '${input.agent}' has no AGENT_SLOTS_V3 entry in scripts/full-yoga-regen-v3.ts. ` +
          `This script targets the wave-1-2-design slice; out-of-slice agents need a slot registered before --real works.`,
      );
    }

    // Load prompt.
    const promptAbs = join(REPO_ROOT, slot.promptRel);
    const systemPrompt = await readFile(promptAbs, "utf8");

    // Compose contextArtifacts marker map (matches v2 pattern).
    const primaryName =
      typeof slot.artifactFile === "string" ? slot.artifactFile : null;
    const ctxKeys = await listAtelierContextKeys(input.workDir, primaryName);
    const contextArtifacts: Record<string, unknown> = {};
    for (const k of ctxKeys) contextArtifacts[k] = true;

    // Fix-round violations sidecar.
    if (input.fixRound > 0 && input.violations.length > 0) {
      const fname = `_violations-round-${input.fixRound}-${input.agent}.json`;
      await writeFile(
        join(input.workDir, ".atelier", fname),
        JSON.stringify({ round: input.fixRound, violations: input.violations }, null, 2),
        "utf8",
      );
      contextArtifacts[fname.replace(/\.json$/, "")] = true;
    }

    const result = await runGeneratorAgentV3({
      agent: input.agent,
      systemPrompt,
      contextArtifacts,
      workDir: input.workDir,
      artifactFile: slot.artifactFile,
    });

    if (result.status === "failed") {
      throw new Error(result.error ?? `agent ${input.agent} failed (no error)`);
    }
    if (result.status === "timeout" && result.artifact === null) {
      throw new Error(`agent ${input.agent} timed out without artifact`);
    }

    // Bundle composition for agents that emit multiple sibling files.
    let artifact: unknown = result.artifact;
    if (slot.bundleLoader) {
      artifact = await slot.bundleLoader(input.workDir);
    }

    return {
      artifact,
      filesCreated: result.filesCreated,
      summary: result.stopSentinel ?? `${input.agent.toUpperCase()}_COMPLETED_NO_SENTINEL`,
    };
  };
}

// ─── PRD → discovery shim ───────────────────────────────────────────

async function loadDiscoveryFromPrd(workDir: string): Promise<void> {
  if (!existsSync(PRD_FIXTURE)) {
    throw new Error(
      `PRD fixture not found at ${PRD_FIXTURE}. This script expects fixtures/yoga-prd.json from the v2 day-5 work.`,
    );
  }
  const raw = await readFile(PRD_FIXTURE, "utf8");
  const prd: unknown = JSON.parse(raw);
  // The v2 yoga PRD is already discovery-shaped (validated by validateDiscovery
  // in v2). We DON'T re-validate here against v3 discovery schema because v3
  // discovery is a strict superset (adds designVibe canonical enum). Inject
  // verbatim and let architect read what it needs.
  const target = join(workDir, ".atelier", "discovery.json");
  await mkdir(join(workDir, ".atelier"), { recursive: true });
  await writeFile(target, JSON.stringify(prd, null, 2), "utf8");
}

// ─── Gate wiring per slice ──────────────────────────────────────────

function buildGates(opts: {
  stitchMode: string;
  stitchFixture: string | null;
}): {
  preWaveGates?: Partial<Record<WaveNameV3, readonly PreWaveGate[]>>;
  postWaveGates?: Partial<Record<WaveNameV3, readonly PostWaveGate[]>>;
} {
  const preForWave2: PreWaveGate[] = [];
  if (opts.stitchMode === "fixture") {
    if (!opts.stitchFixture) {
      throw new Error(
        "--stitch-mode fixture requires --stitch-fixture <path>. Aborting before invoking the orchestrator.",
      );
    }
    if (!existsSync(opts.stitchFixture)) {
      throw new Error(`Stitch fixture file not found at '${opts.stitchFixture}'.`);
    }
    preForWave2.push(
      createStitchFixturePreparerGate({ fixturePath: resolve(opts.stitchFixture) }),
    );
  }

  // PostWave gates for wave-2-design — coherence + stitch-completeness.
  const coherenceGate: PostWaveGate = {
    name: "cross-artifact-coherence-scanner",
    async run(ctx) {
      const layoutBundle = ctx.artifacts["layout-architect"] as
        | { layoutTree?: unknown; stitchAnalysis?: unknown; testIdContract?: unknown }
        | undefined;
      return scanCrossArtifactCoherence({
        architect: ctx.artifacts["architect"],
        layoutTree: layoutBundle?.layoutTree,
        stitchAnalysis: layoutBundle?.stitchAnalysis,
        testIdContract: layoutBundle?.testIdContract,
      });
    },
  };
  const completenessGate = createStitchCompletenessGate();

  return {
    ...(preForWave2.length > 0
      ? { preWaveGates: { "wave-2-design": preForWave2 } }
      : {}),
    postWaveGates: {
      "wave-2-design": [coherenceGate, completenessGate],
    },
  };
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<number> {
  // 1. Bootstrap workDir.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const workDir = resolve(REPO_ROOT, "out", `yoga-regen-v3-${stamp}`);
  await mkdir(workDir, { recursive: true });
  LOG_FILE = join(workDir, "_orchestration.log");

  await log("init", `mode=${MODE_DRY_RUN ? "dry-run" : "real"} slice=${SLICE} stitch=${STITCH_MODE}`);
  await log("init", `workDir=${workDir}`);

  // 2. Stage skeleton (we use v2 skeleton — v3 doesn't have its own).
  if (existsSync(SKELETON_V2)) {
    await log("init", "cloning skeleton-v2 into workDir...");
    await cp(SKELETON_V2, workDir, {
      recursive: true,
      filter: (src) => !src.includes("node_modules"),
    });
  } else {
    await log("init", "skeleton-v2 not found — proceeding with bare workDir");
  }

  // 3. Inject discovery from yoga PRD fixture.
  await loadDiscoveryFromPrd(workDir);
  await log("init", "discovery.json injected from fixtures/yoga-prd.json");

  // 4. Resolve slice + build gates.
  const waves = resolveSlice();
  await log("init", `slice resolves to ${waves.length} waves: [${waves.map((w) => w.name).join(", ")}]`);

  let gates;
  try {
    gates = buildGates({
      stitchMode: STITCH_MODE,
      stitchFixture: STITCH_FIXTURE,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log("init", `✗ gate wiring failed: ${msg}`);
    return 2;
  }

  // 5. Pick runner.
  const runner = MODE_DRY_RUN ? makeFakeRunner() : makeRealRunner();

  // 6. Run.
  const events: OrchestratorV3Event[] = [];
  let result;
  try {
    result = await runGenerationV3({
      generationId: `yoga-v3-${stamp}`,
      prd: JSON.parse(await readFile(PRD_FIXTURE, "utf8")),
      workDir,
      runner,
      emit: async (e) => {
        events.push(e);
        const d = describeEvent(e);
        if (d) await log(d.stage, d.msg);
      },
      waves,
      ...gates,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log("done", `✗ uncaught: ${msg}`);
    return 3;
  }

  // 7. Summarise.
  const durationMs = Date.now() - TS_START;
  const summary = [
    `mode=${MODE_DRY_RUN ? "dry-run" : "real"}`,
    `slice=${SLICE}`,
    `stitch=${STITCH_MODE}`,
    `duration=${(durationMs / 1000).toFixed(2)}s`,
    `waves=${events.filter((e) => e.type === "wave.completed").length}`,
    `agents=${events.filter((e) => e.type === "agent.completed").length}`,
    `gateViolations=${result.gateViolations.length}`,
    `skipped=${result.skippedWaves.length}`,
    `qa.decision=${result.qa?.decision ?? "n/a"}`,
    `failedAt=${result.failedAt ? `${result.failedAt.wave}/${result.failedAt.agent}` : "—"}`,
    `requiresHumanReview=${result.requiresHumanReview ? "YES" : "no"}`,
  ].join(" ");

  await log("done", `▣ ${result.failedAt ? "FAIL" : "DONE"} — ${summary}`);
  await log("done", `workDir=${workDir}`);

  return result.failedAt ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(99);
  },
);
