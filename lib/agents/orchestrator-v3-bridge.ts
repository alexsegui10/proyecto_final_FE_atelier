/**
 * Atelier V3 UI bridge.
 *
 * Connects the HTTP generation API route to orchestrator-v3.  Exposes the
 * same fire-and-forget interface as v1's `runGeneration` so
 * `app/api/generate/start/route.ts` only needs to swap one import.
 *
 * Key design decisions:
 *
 * 1. Event persistence — the Event table uses a free-form String for `type`
 *    and Json for `payload`, so all 20 v3 event types (generation.*, wave.*,
 *    gate.*, agent.*, qa.fix_round, format_rescue.*) are persisted verbatim.
 *    No migration needed.
 *
 * 2. ATELIER_TIMEOUT_MULTIPLIER — applied inside runGeneratorAgentV2
 *    (via applyTimeoutMultiplier at the subprocess executor site).  v3 agents
 *    pass through the same code path via configOverride.  Nothing extra to
 *    forward here.
 *
 * 3. Runner construction — mirrors the `makeRealRunner` pattern from
 *    scripts/full-yoga-regen-v3.ts.  The AGENT_SLOTS_V3 table is the single
 *    source of truth: prompt path, primary artifact filename, optional
 *    bundleLoader and boundary validators.
 *
 * 4. Discovery injection — the v3 orchestrator includes wave-1-discovery in
 *    WAVES_V3 for dependency-order validation, but the "discovery" agent slot
 *    is intentionally omitted from AGENT_SLOTS_V3.  The PRD received from the
 *    HTTP request is written to `.atelier/discovery.json` before invoking the
 *    orchestrator, and the `discovery` artifact is seeded so the orchestrator
 *    auto-skips that agent.
 */

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "@/lib/db/client";
import {
  runGenerationV3,
  type AgentRunInputV3,
  type AgentRunResultV3,
  type AgentRunnerV3,
  type OrchestratorV3Event,
  type QaArtifactV3,
} from "./orchestrator-v3";
import { runGeneratorAgentV3 } from "./runtime/runner-generator-v3";
import {
  assertArtifactsValid,
  type ArtifactValidator,
} from "./runtime/artifact-boundary";
import type { AgentNameV3 } from "./contracts-v3/agent-names";
import { validateTestIdContract } from "./contracts-v3/test-id-contract.schema";
import { validateComponentsCatalogV3 } from "./contracts-v3/components-catalog.schema";
import { validatePageAdaptations } from "./contracts-v3/page-adaptation.schema";
import { validateFormsValidationsV3 } from "./contracts-v3/forms-validations.schema";
import { validateSeedsFixtures } from "./contracts-v3/seeds-fixtures.schema";
import { validateTestsWriter } from "./contracts-v3/tests-writer.schema";

// ─── Public interface ─────────────────────────────────────────────────

export interface RunGenerationV3Input {
  generationId: string;
  projectId: string;
  prd: unknown;
  workDir: string;
}

// ─── Agent slot table ─────────────────────────────────────────────────
//
// Mirrors AGENT_SLOTS_V3 from scripts/full-yoga-regen-v3.ts.
// This is the canonical per-agent config for the UI pipeline.  The
// "discovery" agent is intentionally absent — its artifact is injected
// from the PRD (see injectDiscoveryArtifact below).

interface AgentSlot {
  promptRel: string;
  artifactFile: string | false;
  bundleLoader?: (workDir: string) => Promise<unknown>;
  aliasFile?: string;
  aliasFrom?: string;
  validators?: Record<string, ArtifactValidator>;
}

const REPO_ROOT = join(process.cwd());

const AGENT_SLOTS: Partial<Record<AgentNameV3, AgentSlot>> = {
  // ── wave-1 ──────────────────────────────────────────────────────
  "bootstrap-devops": {
    promptRel: "lib/agents/prompts-v3/bootstrap-devops.md",
    artifactFile: "bootstrap.json",
  },
  architect: {
    promptRel: "lib/agents/prompts-v2/architect.md",
    artifactFile: "architect.json",
  },

  // ── wave-2-design ────────────────────────────────────────────────
  "ux-ui-designer": {
    promptRel: "lib/agents/prompts-v3/ux-ui-designer.md",
    artifactFile: "design-system.json",
  },
  "layout-architect": {
    promptRel: "lib/agents/prompts-v3/layout-architect.md",
    artifactFile: false,
    bundleLoader: async (workDir: string) => {
      const atelier = join(workDir, ".atelier");
      const [lt, sa, tic] = await Promise.all([
        readFile(join(atelier, "layout-tree.json"), "utf8"),
        readFile(join(atelier, "stitch-analysis.json"), "utf8"),
        readFile(join(atelier, "test-id-contract.json"), "utf8"),
      ]);
      let summary: unknown = null;
      try {
        summary = JSON.parse(
          await readFile(join(atelier, "layout-architect.json"), "utf8"),
        );
      } catch {
        // optional — not an error when absent
      }
      return {
        layoutTree: JSON.parse(lt),
        stitchAnalysis: JSON.parse(sa),
        testIdContract: JSON.parse(tic),
        ...(summary !== null ? { summary } : {}),
      };
    },
    aliasFile: "screens-map.json",
    aliasFrom: "layout-tree.json",
    validators: { "test-id-contract.json": validateTestIdContract },
  },
  "brand-identity": {
    promptRel: "lib/agents/prompts-v3/brand-identity.md",
    artifactFile: "brand-identity.json",
  },

  // ── wave-2-domain (v2-reused) ─────────────────────────────────────
  "domain-modeler": {
    promptRel: "lib/agents/prompts-v2/domain-modeler.md",
    artifactFile: "domain-modeler.json",
    aliasFile: "domain-model.json",
  },
  persistence: {
    promptRel: "lib/agents/prompts-v2/persistence.md",
    artifactFile: "persistence.json",
  },
  "seeds-shape": {
    promptRel: "lib/agents/prompts-v2/seeds-shape.md",
    artifactFile: "seeds-shape.json",
  },

  // ── wave-3-app-security (v2-reused) ──────────────────────────────
  "service-layer": {
    promptRel: "lib/agents/prompts-v2/service-layer.md",
    artifactFile: "services.json",
  },
  "auth-security": {
    promptRel: "lib/agents/prompts-v2/auth-security.md",
    artifactFile: "auth-mechanics.json",
  },
  "rbac-authorization": {
    promptRel: "lib/agents/prompts-v2/rbac-authorization.md",
    artifactFile: "rbac-policy.json",
  },

  // ── wave-4 (sub-divided) ──────────────────────────────────────────
  "api-backend": {
    promptRel: "lib/agents/prompts-v2/api-backend.md",
    artifactFile: "api-contract.json",
  },
  "frontend-architect": {
    promptRel: "lib/agents/prompts-v2/frontend-architect.md",
    artifactFile: "frontend-architecture.json",
  },
  "ui-components": {
    promptRel: "lib/agents/prompts-v3/ui-components.md",
    artifactFile: "components-catalog.json",
    validators: { "components-catalog.json": validateComponentsCatalogV3 },
  },
  "forms-validations": {
    promptRel: "lib/agents/prompts-v3/forms-validations.md",
    artifactFile: "forms-validations.json",
    validators: { "forms-validations.json": validateFormsValidationsV3 },
  },
  "visual-adapter": {
    promptRel: "lib/agents/prompts-v3/visual-adapter.md",
    artifactFile: "page-adaptations.json",
    validators: { "page-adaptations.json": validatePageAdaptations },
  },

  // ── wave-5 ────────────────────────────────────────────────────────
  "seeds-fixtures": {
    promptRel: "lib/agents/prompts-v3/seeds-fixtures.md",
    artifactFile: "seeds-fixtures.json",
    validators: { "seeds-fixtures.json": validateSeedsFixtures },
  },
  "tests-writer": {
    promptRel: "lib/agents/prompts-v3/tests-writer.md",
    artifactFile: "tests-writer.json",
    validators: { "tests-writer.json": validateTestsWriter },
  },

  // ── wave-6 + wave-7 ───────────────────────────────────────────────
  "qa-reviewer": {
    promptRel: "lib/agents/prompts-v3/qa-reviewer.md",
    artifactFile: "qa-report.json",
  },
  "visual-qa": {
    promptRel: "lib/agents/prompts-v3/visual-qa.md",
    artifactFile: "visual-qa-report.json",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────

async function listAtelierContextKeys(
  workDir: string,
  excludeFilename: string | null,
): Promise<string[]> {
  const atelier = join(workDir, ".atelier");
  if (!existsSync(atelier)) return [];
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(atelier);
  return entries
    .filter(
      (e) =>
        e.endsWith(".json") &&
        (excludeFilename === null || e !== excludeFilename),
    )
    .map((e) => e.replace(/\.json$/, ""));
}

async function injectDiscoveryArtifact(
  workDir: string,
  prd: unknown,
): Promise<void> {
  const target = join(workDir, ".atelier", "discovery.json");
  await mkdir(join(workDir, ".atelier"), { recursive: true });
  await writeFile(target, JSON.stringify(prd, null, 2), "utf8");
}

// ─── Runner factory ───────────────────────────────────────────────────

function makeRunner(): AgentRunnerV3 {
  return async (input: AgentRunInputV3): Promise<AgentRunResultV3> => {
    const slot = AGENT_SLOTS[input.agent];
    if (!slot) {
      throw new Error(
        `Agent '${input.agent}' has no entry in AGENT_SLOTS. ` +
          `Add a slot entry in lib/agents/orchestrator-v3-bridge.ts to enable this agent in the UI pipeline.`,
      );
    }

    const promptAbs = join(REPO_ROOT, slot.promptRel);
    const systemPrompt = await readFile(promptAbs, "utf8");

    const primaryName =
      typeof slot.artifactFile === "string" ? slot.artifactFile : null;
    const ctxKeys = await listAtelierContextKeys(input.workDir, primaryName);
    const contextArtifacts: Record<string, unknown> = {};
    for (const k of ctxKeys) contextArtifacts[k] = true;

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
      throw new Error(result.error ?? `agent ${input.agent} failed`);
    }
    if (result.status === "timeout" && result.artifact === null) {
      throw new Error(`agent ${input.agent} timed out without artifact`);
    }

    // Mirror alias file when declared (e.g. domain-modeler.json → domain-model.json).
    const aliasSrcName =
      slot.aliasFrom ??
      (typeof slot.artifactFile === "string" ? slot.artifactFile : undefined);
    if (slot.aliasFile && aliasSrcName) {
      const src = join(input.workDir, ".atelier", aliasSrcName);
      const dst = join(input.workDir, ".atelier", slot.aliasFile);
      await cp(src, dst).catch(() => undefined);
    }

    await assertArtifactsValid(
      input.agent,
      input.workDir,
      slot.validators,
      () => undefined,
    );

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

// ─── Persist event to DB ──────────────────────────────────────────────

async function persistEvent(
  generationId: string,
  event: OrchestratorV3Event,
): Promise<void> {
  try {
    await prisma.event.create({
      data: {
        generationId,
        type: event.type,
        payload: event as never,
      },
    });
  } catch (err) {
    console.error("[orchestrator-v3-bridge] failed to persist event", event.type, err);
  }
}

// ─── Entry point (fire-and-forget) ───────────────────────────────────

/**
 * Drop-in replacement for v1's `runGeneration`, called fire-and-forget from
 * the API route.  Updates the Generation row on completion.
 */
export async function runGenerationV3Bridge(
  input: RunGenerationV3Input,
): Promise<void> {
  const { generationId, prd, workDir } = input;

  await injectDiscoveryArtifact(workDir, prd);

  const runner = makeRunner();
  const emit = (event: OrchestratorV3Event) =>
    persistEvent(generationId, event);

  let result: Awaited<ReturnType<typeof runGenerationV3>>;
  try {
    result = await runGenerationV3({
      generationId,
      prd,
      workDir,
      emit,
      runner,
      // discovery artifact is pre-seeded; mark it so the orchestrator
      // auto-skips the discovery agent slot.
      seedArtifacts: { discovery: prd },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "orchestrator-v3 crashed";
    await persistEvent(generationId, {
      type: "generation.failed",
      generationId,
      reason,
    });
    await prisma.generation
      .update({
        where: { id: generationId },
        data: { status: "failed", finishedAt: new Date() },
      })
      .catch(() => undefined);
    return;
  }

  const failed = !!result.failedAt;
  await prisma.generation
    .update({
      where: { id: generationId },
      data: {
        status: failed ? "failed" : "complete",
        finishedAt: new Date(),
        result: {
          workDir,
          durationMs: result.durationMs,
          filesCreated: result.files.length,
          summary: (result.qa as QaArtifactV3 | null)?.summary ?? null,
          decision: (result.qa as QaArtifactV3 | null)?.decision ?? null,
          skippedWaves: result.skippedWaves,
          requiresHumanReview: result.requiresHumanReview ?? false,
        },
      },
    })
    .catch(() => undefined);
}
