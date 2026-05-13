/**
 * Día 5 — Atelier v2 yoga end-to-end real regeneration.
 *
 * Pipeline:
 *   1. Clone skeleton-v2 → out/yoga-regen-v2-<ts>/
 *   2. Convert fixtures/yoga-prd.json → discovery v2 schema, inject as
 *      .atelier/discovery.json (Discovery agent is SKIPPED — chat phase
 *      output is preassembled).
 *   3. Run orchestrator-v2 over waves 1-planning … 6-validation (16 agents,
 *      Discovery agent removed from the wave list).
 *   4. In --real mode: spawn real `claude` subprocesses via
 *      runGeneratorAgentV2. In --dry-run mode: a fake runner drops the
 *      canonical yoga fixture artifacts into .atelier/ (lets us exercise
 *      the orchestrator + plumbing without burning LLM tokens).
 *   5. Internal fix loop (orchestrator-v2 maxFixRounds = 3) when qa-reviewer
 *      decides no-go.
 *   6. Install deps + prisma generate + `pnpm qa` in the workDir.
 *   7. Tag GO/NO-GO + total duration + workDir path.
 *
 * Per-agent timestamps are logged both to the console and to the file
 * `<workDir>/_orchestration.log`.
 *
 * Usage:
 *   tsx scripts/full-yoga-regen.ts --real        # full LLM regen
 *   tsx scripts/full-yoga-regen.ts --dry-run     # synthetic regen (fast)
 */
import { mkdir, rm, readFile, writeFile, cp, readdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  runGenerationV2,
  WAVES_V2,
  type AgentRunner,
  type AgentRunInput,
  type AgentRunResult,
  type OrchestratorV2Event,
  type Wave,
} from "../lib/agents/orchestrator-v2";
import { runGeneratorAgentV2 } from "../lib/agents/runtime/runner-generator-v2";
import type { AgentNameV2 } from "../lib/agents/violations-router-v2";

import {
  discoverySchema,
  type Discovery,
} from "../lib/agents/contracts-v2/discovery.schema";
import { validateDiscovery } from "../lib/agents/contracts-v2/discovery.schema";
import { validateArchitect } from "../lib/agents/contracts-v2/architect.schema";
import { validateDomainModel } from "../lib/agents/contracts-v2/domain-model.schema";
import { validatePersistence } from "../lib/agents/contracts-v2/persistence.schema";
import { validateSeedsPlan } from "../lib/agents/contracts-v2/seeds-plan.schema";
import { validateServices } from "../lib/agents/contracts-v2/services.schema";
import { validateAuthMechanics } from "../lib/agents/contracts-v2/auth-mechanics.schema";
import { validateRbacPolicy } from "../lib/agents/contracts-v2/rbac-policy.schema";
import { validateApiContract } from "../lib/agents/contracts-v2/api-contract.schema";
import { validateFrontendArchitecture } from "../lib/agents/contracts-v2/frontend-architecture.schema";
import { validateComponentsCatalog } from "../lib/agents/contracts-v2/components-catalog.schema";
import { validateFormsValidations } from "../lib/agents/contracts-v2/forms-validations.schema";
import { validatePagesRouting } from "../lib/agents/contracts-v2/pages-routing.schema";
import { validateSeedsFixtures } from "../lib/agents/contracts-v2/seeds-fixtures.schema";
import { validateTestsWriter } from "../lib/agents/contracts-v2/tests-writer.schema";
import { validateQaReport } from "../lib/agents/contracts-v2/qa-report.schema";

// ─── Paths ──────────────────────────────────────────────────────────
const REPO_ROOT = resolve(__dirname, "..");
const SKELETON_V2 = join(REPO_ROOT, "lib", "skeleton-v2");
const PROMPTS_DIR = join(REPO_ROOT, "lib", "agents", "prompts-v2");
const FIXTURES_DIR = join(REPO_ROOT, "lib", "agents", "__tests__", "fixtures");
const PRD_FIXTURE = join(REPO_ROOT, "fixtures", "yoga-prd.json");

// ─── Args ───────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);
const MODE_DRY_RUN = ARGV.includes("--dry-run");
const MODE_REAL = ARGV.includes("--real") || !MODE_DRY_RUN; // default: real
const MAX_FIX_ROUNDS = 3;

/** Resume value: `null` = fresh run; string path = resume that workDir;
 * `"latest"` = auto-pick most recent out/yoga-regen-v2-* directory. */
function parseResumeArg(): string | null {
  const idx = ARGV.indexOf("--resume");
  if (idx < 0) return null;
  const next = ARGV[idx + 1];
  if (!next || next.startsWith("--")) return "latest";
  return next;
}
const RESUME_ARG = parseResumeArg();

// ─── Per-agent artifact map ─────────────────────────────────────────
// The runner reads `<artifactsDir>/<filename>` after the agent run. For
// agents whose primary artifact filename does NOT match `<agent>.json`
// we override here. Use `false` to skip primary-artifact loading (the
// agent emits sibling files instead — they're validated/consumed later).
interface AgentSlot {
  /** Primary artifact filename in .atelier/. `false` = skip primary load. */
  artifactFile: string | false;
  /** Optional Zod validator for the primary artifact. */
  validate?: (a: unknown) => string | null;
  /** Fixture used by --dry-run (relative to FIXTURES_DIR). */
  dryRunFixture?: string;
  /** Extra fixtures the fake runner also drops (filename → fixture file). */
  dryRunExtraFiles?: ReadonlyArray<{ filename: string; fixture: string }>;
  /** If true, post-run we mirror the primary file to an alias path. */
  aliasFile?: string;
}

const AGENT_SLOTS: Record<AgentNameV2, AgentSlot> = {
  discovery: {
    artifactFile: "discovery.json",
    validate: validateDiscovery,
    dryRunFixture: "yoga-discovery.json",
  },
  architect: {
    artifactFile: "architect.json",
    validate: validateArchitect,
    dryRunFixture: "yoga-architect.json",
  },
  "ux-ui-designer": {
    artifactFile: "ux-ui-designer.json",
    dryRunFixture: undefined,
    dryRunExtraFiles: [
      { filename: "design-system.json", fixture: "yoga-design-system.json" },
      { filename: "screens-map.json", fixture: "yoga-screens-map.json" },
    ],
  },
  "domain-modeler": {
    artifactFile: "domain-modeler.json",
    validate: validateDomainModel,
    dryRunFixture: "yoga-domain-model.json",
    // Downstream prompts reference `.atelier/domain-model.json`. Mirror.
    aliasFile: "domain-model.json",
  },
  persistence: {
    artifactFile: "persistence.json",
    validate: validatePersistence,
    dryRunFixture: "yoga-persistence.json",
  },
  "seeds-shape": {
    artifactFile: "seeds-shape.json",
    validate: validateSeedsPlan,
    dryRunFixture: "yoga-seeds-plan.json",
  },
  "service-layer": {
    artifactFile: "services.json",
    validate: validateServices,
    dryRunFixture: "yoga-service-layer.json",
  },
  "auth-security": {
    artifactFile: "auth-mechanics.json",
    validate: validateAuthMechanics,
    dryRunFixture: "yoga-auth-mechanics.json",
  },
  "rbac-authorization": {
    artifactFile: "rbac-policy.json",
    validate: validateRbacPolicy,
    dryRunFixture: "yoga-rbac-policy.json",
  },
  "api-backend": {
    artifactFile: "api-contract.json",
    validate: validateApiContract,
    dryRunFixture: "yoga-api-contract.json",
  },
  "frontend-architect": {
    artifactFile: "frontend-architecture.json",
    validate: validateFrontendArchitecture,
    dryRunFixture: "yoga-frontend-architecture.json",
  },
  "ui-components": {
    artifactFile: "components-catalog.json",
    validate: validateComponentsCatalog,
    dryRunFixture: "yoga-components-catalog.json",
  },
  "forms-validations": {
    artifactFile: "forms-validations.json",
    validate: validateFormsValidations,
    dryRunFixture: "yoga-forms-validations.json",
  },
  "pages-routing": {
    artifactFile: "pages-routing.json",
    validate: validatePagesRouting,
    dryRunFixture: "yoga-pages-routing.json",
  },
  "seeds-fixtures": {
    artifactFile: "seeds-fixtures.json",
    validate: validateSeedsFixtures,
    dryRunFixture: "yoga-seeds-fixtures.json",
  },
  "tests-writer": {
    artifactFile: "tests-writer.json",
    validate: validateTestsWriter,
    dryRunFixture: "yoga-tests-writer.json",
  },
  "qa-reviewer": {
    artifactFile: "qa-report.json",
    validate: validateQaReport,
    dryRunFixture: "yoga-qa-report.json",
  },
};

// ─── PRD → Discovery v2 conversion ──────────────────────────────────
interface PrdFixture {
  readonly objective: string;
  readonly roles: ReadonlyArray<string>;
  readonly entities: ReadonlyArray<{
    readonly name: string;
    readonly fields: ReadonlyArray<string>;
    readonly notes?: string;
  }>;
  readonly useCases: ReadonlyArray<string>;
  readonly notes?: ReadonlyArray<string>;
}

const ROLE_TRANSLATIONS: Record<string, string> = {
  profesor: "teacher",
  alumno: "student",
  admin: "admin",
};

const USECASE_ACTORS: Record<string, string> = {
  admin: "admin",
  profesor: "teacher",
  teacher: "teacher",
  alumno: "student",
  student: "student",
};

function inferFieldType(fieldName: string): string {
  const n = fieldName.toLowerCase();
  if (n.endsWith("id")) return "reference";
  if (n.includes("password")) return "string";
  if (n.includes("email")) return "string";
  if (n.includes("role") || n.includes("level") || n.includes("tier") || n.includes("status"))
    return "enum";
  if (n.endsWith("at") || n.includes("date") || n.includes("from") || n.includes("until"))
    return "date";
  if (
    n.includes("duration") ||
    n.includes("count") ||
    n.includes("credits") ||
    n.includes("capacity") ||
    n.includes("amount") ||
    n.includes("price")
  )
    return "number";
  if (n.startsWith("is") || n.startsWith("has") || n === "active") return "boolean";
  return "string";
}

function isRequiredField(fieldName: string): boolean {
  const n = fieldName.toLowerCase();
  return !n.includes("cancelled") && !n.includes("deletedat");
}

function ensureCoreFields(
  fieldNames: ReadonlyArray<string>,
): Array<{ name: string; type: string; required: boolean }> {
  const out: Array<{ name: string; type: string; required: boolean }> = [];
  const seen = new Set<string>();
  // Always prepend id/slug if missing — discovery contract demands ≥3 fields
  // and downstream agents rely on these existing.
  if (!fieldNames.some((f) => f.toLowerCase() === "id")) {
    out.push({ name: "id", type: "string", required: true });
    seen.add("id");
  }
  if (!fieldNames.some((f) => f.toLowerCase() === "slug")) {
    out.push({ name: "slug", type: "string", required: true });
    seen.add("slug");
  }
  for (const f of fieldNames) {
    const key = f.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: f, type: inferFieldType(f), required: isRequiredField(f) });
  }
  return out;
}

function parseUseCase(raw: string): { actor: string; action: string; constraints?: string[] } {
  // Heuristic: "alumno reserva una clase (consume crédito ...)" →
  //   actor=student, action="reserva una clase", constraints=["consume crédito ..."]
  const parenMatch = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const head = (parenMatch?.[1] ?? raw).trim();
  const constraint = parenMatch?.[2]?.trim();

  const words = head.split(/\s+/);
  const firstWord = words[0]?.toLowerCase() ?? "";
  const actor = USECASE_ACTORS[firstWord] ?? firstWord ?? "user";
  const action = words.slice(1).join(" ").trim() || head;

  const cleanAction =
    action.length >= 5 ? action.charAt(0).toUpperCase() + action.slice(1) : `Do ${action}`;

  const result: { actor: string; action: string; constraints?: string[] } = {
    actor,
    action: cleanAction,
  };
  if (constraint) result.constraints = [constraint];
  return result;
}

function convertPrdToDiscovery(prd: PrdFixture): Discovery {
  const discovery: Discovery = {
    objective: prd.objective,
    domain: "yoga",
    designVibe: "Calm",
    roles: prd.roles.map((r) => ROLE_TRANSLATIONS[r] ?? r.toLowerCase()),
    entities: prd.entities.map((e) => {
      const businessRules = e.notes
        ? e.notes
            .split(/\.\s+/)
            .map((s) => s.trim().replace(/\.$/, ""))
            .filter((s) => s.length > 0)
        : [];
      return {
        name: e.name,
        fields: ensureCoreFields(e.fields),
        ...(businessRules.length > 0 ? { businessRules } : {}),
      };
    }),
    useCases: prd.useCases.map(parseUseCase),
    ...(prd.notes && prd.notes.length > 0 ? { specialRequirements: [...prd.notes] } : {}),
  };
  return discovery;
}

// ─── Logging ────────────────────────────────────────────────────────
function ts(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

async function makeLogger(logFile: string): Promise<(stage: string, msg: string) => Promise<void>> {
  // touch the file
  await writeFile(logFile, `# yoga-regen v2 — started ${ts()}\n\n`, "utf-8");
  return async (stage: string, msg: string) => {
    const line = `[${ts()}] [${stage}] ${msg}`;
    console.log(line);
    try {
      await appendFile(logFile, line + "\n", "utf-8");
    } catch {
      /* logging best-effort */
    }
  };
}

function summarizeEvent(event: OrchestratorV2Event): { stage: string; msg: string } | null {
  switch (event.type) {
    case "generation.started":
      return { stage: "orchestrator", msg: `▶ generation.started id=${event.generationId}` };
    case "generation.completed":
      return { stage: "orchestrator", msg: `✓ generation.completed — ${event.summary}` };
    case "generation.failed":
      return { stage: "orchestrator", msg: `✗ generation.failed — ${event.reason}` };
    case "wave.started":
      return {
        stage: "wave",
        msg: `▶ ${event.wave} — agents: [${event.agents.join(", ")}]`,
      };
    case "wave.completed":
      return {
        stage: "wave",
        msg: `✓ ${event.wave} done in ${(event.durationMs / 1000).toFixed(1)}s — ${event.results
          .map((r) => `${r.agent}:${r.status}`)
          .join(" ")}`,
      };
    case "agent.started":
      return { stage: event.agent, msg: `▶ started (wave=${event.wave})` };
    case "agent.completed":
      return { stage: event.agent, msg: `✓ ${event.summary}` };
    case "agent.failed":
      return { stage: event.agent, msg: `✗ ${event.reason}` };
    case "agent.file_created":
      return {
        stage: event.agent,
        msg: `  + ${event.path} (${event.lines} lines)`,
      };
    case "qa.fix_round":
      return {
        stage: "qa-loop",
        msg: `↺ round ${event.round}/${event.maxRounds} — ${event.violations} violations to fix`,
      };
    case "agent.fix_started":
      return {
        stage: event.agent,
        msg: `↺ fix-round ${event.round} — ${event.violations} violations targeted`,
      };
    case "agent.fix_completed":
      return { stage: event.agent, msg: `✓ fix-round ${event.round} done` };
    default:
      return null;
  }
}

// ─── Workdir setup ──────────────────────────────────────────────────
async function setupWorkDir(workDir: string, log: (s: string, m: string) => Promise<void>): Promise<void> {
  if (existsSync(workDir)) {
    await log("setup", `workDir already exists — removing: ${workDir}`);
    await rm(workDir, { recursive: true, force: true });
  }
  await mkdir(workDir, { recursive: true });
  await log("setup", `cloning skeleton-v2 → ${workDir}`);
  await cp(SKELETON_V2, workDir, {
    recursive: true,
    filter: (src) => !src.includes("node_modules"),
  });
  await mkdir(join(workDir, ".atelier"), { recursive: true });
}

async function injectDiscovery(
  workDir: string,
  log: (s: string, m: string) => Promise<void>,
): Promise<Discovery> {
  await log("discovery", `loading PRD from ${PRD_FIXTURE}`);
  const raw = await readFile(PRD_FIXTURE, "utf-8");
  const prd = JSON.parse(raw) as PrdFixture;
  const discovery = convertPrdToDiscovery(prd);
  const parsed = discoverySchema.safeParse(discovery);
  if (!parsed.success) {
    const err = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`converted discovery fails schema: ${err}`);
  }
  const target = join(workDir, ".atelier", "discovery.json");
  await writeFile(target, JSON.stringify(parsed.data, null, 2) + "\n", "utf-8");
  await log("discovery", `✓ injected ${target} (${discovery.entities.length} entities, ${discovery.useCases.length} useCases)`);
  return parsed.data;
}

// ─── Runner adapters ────────────────────────────────────────────────
async function listAtelierContextKeys(workDir: string, exclude: string): Promise<string[]> {
  const dir = join(workDir, ".atelier");
  let files: string[] = [];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const keys: string[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    if (f === exclude) continue;
    if (f.startsWith("_")) continue; // internal sidecars
    keys.push(f.replace(/\.json$/, ""));
  }
  return keys.sort();
}

/**
 * Resume-skip helper: if --resume is active AND the agent's primary artifact
 * already exists on disk AND validates (or has no validator), return a
 * synthetic AgentRunResult without invoking the LLM. Returns null otherwise.
 *
 * Skipped only for round 0 — fix rounds always re-run.
 */
async function tryResumeSkip(
  input: AgentRunInput,
  log: (s: string, m: string) => Promise<void>,
): Promise<AgentRunResult | null> {
  if (input.fixRound !== 0) return null;
  const slot = AGENT_SLOTS[input.agent];
  if (typeof slot.artifactFile !== "string") return null;
  const artifactPath = join(input.workDir, ".atelier", slot.artifactFile);
  if (!existsSync(artifactPath)) return null;
  let raw: string;
  try {
    raw = await readFile(artifactPath, "utf-8");
  } catch {
    return null;
  }
  let artifact: unknown;
  try {
    artifact = JSON.parse(raw);
  } catch (err) {
    await log(input.agent, `↩ resume: existing ${slot.artifactFile} is not valid JSON (${(err as Error).message}); will re-run`);
    return null;
  }
  if (slot.validate) {
    const err = slot.validate(artifact);
    if (err) {
      await log(input.agent, `↩ resume: existing ${slot.artifactFile} fails schema (${err.slice(0, 200)}); will re-run`);
      return null;
    }
  }
  await log(input.agent, `↩ resumed (artifact valid: .atelier/${slot.artifactFile})`);
  // Mirror alias if needed (e.g. domain-modeler.json → domain-model.json)
  if (slot.aliasFile) {
    const dst = join(input.workDir, ".atelier", slot.aliasFile);
    if (!existsSync(dst)) {
      try {
        await cp(artifactPath, dst);
        await log(input.agent, `  + alias .atelier/${slot.aliasFile} (mirror of ${slot.artifactFile})`);
      } catch {
        /* best-effort */
      }
    }
  }
  return {
    artifact,
    filesCreated: [{ path: `.atelier/${slot.artifactFile}`, lines: raw.split("\n").length }],
    summary: `${input.agent.toUpperCase()}_RESUMED`,
  };
}

function buildRealRunner(
  log: (s: string, m: string) => Promise<void>,
  opts: { resume: boolean },
): AgentRunner {
  return async (input: AgentRunInput): Promise<AgentRunResult> => {
    if (opts.resume) {
      const skipped = await tryResumeSkip(input, log);
      if (skipped) return skipped;
    }
    const slot = AGENT_SLOTS[input.agent];
    const promptPath = join(PROMPTS_DIR, `${input.agent}.md`);
    let systemPrompt: string;
    try {
      systemPrompt = await readFile(promptPath, "utf-8");
    } catch (err) {
      throw new Error(`could not load prompt ${promptPath}: ${(err as Error).message}`);
    }

    const primaryFilename =
      typeof slot.artifactFile === "string" ? slot.artifactFile : `${input.agent}.json`;
    const ctxKeys = await listAtelierContextKeys(input.workDir, primaryFilename);
    const contextArtifacts: Record<string, unknown> = {};
    for (const key of ctxKeys) {
      // Value is unused (path-list mode in buildUserPrompt). Marker only.
      contextArtifacts[key] = true;
    }

    // Fix-round: write violations sidecar so the agent can Read it.
    if (input.fixRound > 0 && input.violations.length > 0) {
      const fname = `_violations-round-${input.fixRound}-${input.agent}.json`;
      await writeFile(
        join(input.workDir, ".atelier", fname),
        JSON.stringify({ round: input.fixRound, violations: input.violations }, null, 2),
        "utf-8",
      );
      contextArtifacts[fname.replace(/\.json$/, "")] = true;
    }

    const result = await runGeneratorAgentV2({
      agent: input.agent,
      systemPrompt,
      contextArtifacts,
      workDir: input.workDir,
      artifactFile: slot.artifactFile,
      ...(slot.validate ? { validateArtifact: slot.validate } : {}),
    });

    if (result.status === "failed") {
      throw new Error(result.error ?? `agent ${input.agent} failed (no error)`);
    }
    if (result.status === "timeout" && result.artifact === null) {
      throw new Error(`agent ${input.agent} timed out without artifact`);
    }

    // Alias mirror: e.g. domain-modeler.json → domain-model.json for
    // downstream prompts that reference the legacy filename.
    if (slot.aliasFile && typeof slot.artifactFile === "string") {
      const src = join(input.workDir, ".atelier", slot.artifactFile);
      const dst = join(input.workDir, ".atelier", slot.aliasFile);
      try {
        await cp(src, dst);
        await log(input.agent, `  + alias .atelier/${slot.aliasFile} (mirror of ${slot.artifactFile})`);
      } catch (err) {
        await log(input.agent, `  ! alias copy failed: ${(err as Error).message}`);
      }
    }

    return {
      artifact: result.artifact,
      filesCreated: result.filesCreated,
      summary: result.stopSentinel ?? `${input.agent.toUpperCase()}_DONE`,
    };
  };
}

function buildFakeRunner(
  log: (s: string, m: string) => Promise<void>,
  opts: { resume: boolean },
): AgentRunner {
  return async (input: AgentRunInput): Promise<AgentRunResult> => {
    if (opts.resume) {
      const skipped = await tryResumeSkip(input, log);
      if (skipped) return skipped;
    }
    const slot = AGENT_SLOTS[input.agent];
    const filesCreated: Array<{ path: string; lines: number }> = [];

    // Drop primary artifact fixture (if any)
    let artifact: unknown = { ok: true, agent: input.agent };
    if (slot.dryRunFixture && typeof slot.artifactFile === "string") {
      const src = join(FIXTURES_DIR, slot.dryRunFixture);
      const dst = join(input.workDir, ".atelier", slot.artifactFile);
      await cp(src, dst);
      const raw = await readFile(dst, "utf-8");
      artifact = JSON.parse(raw);
      if (slot.validate) {
        const err = slot.validate(artifact);
        if (err) throw new Error(`fixture ${slot.dryRunFixture} fails schema: ${err}`);
      }
      filesCreated.push({ path: `.atelier/${slot.artifactFile}`, lines: raw.split("\n").length });
    }

    // Drop sibling artifacts (e.g. ux-ui-designer → design-system + screens-map)
    if (slot.dryRunExtraFiles) {
      for (const extra of slot.dryRunExtraFiles) {
        const src = join(FIXTURES_DIR, extra.fixture);
        const dst = join(input.workDir, ".atelier", extra.filename);
        await cp(src, dst);
        const raw = await readFile(dst, "utf-8");
        filesCreated.push({ path: `.atelier/${extra.filename}`, lines: raw.split("\n").length });
      }
      // For ux-ui-designer (no primary fixture): synthesize a manifest.
      if (!slot.dryRunFixture && typeof slot.artifactFile === "string") {
        const manifest = { designSystem: "see design-system.json", screensMap: "see screens-map.json" };
        const dst = join(input.workDir, ".atelier", slot.artifactFile);
        await writeFile(dst, JSON.stringify(manifest, null, 2), "utf-8");
        artifact = manifest;
        filesCreated.push({ path: `.atelier/${slot.artifactFile}`, lines: 4 });
      }
    }

    // Alias mirror
    if (slot.aliasFile && typeof slot.artifactFile === "string") {
      const src = join(input.workDir, ".atelier", slot.artifactFile);
      const dst = join(input.workDir, ".atelier", slot.aliasFile);
      await cp(src, dst);
      filesCreated.push({ path: `.atelier/${slot.aliasFile}`, lines: 0 });
    }

    await log(input.agent, `(dry-run) dropped fixtures: ${filesCreated.map((f) => f.path).join(", ")}`);

    return {
      artifact,
      filesCreated,
      summary: `${input.agent.toUpperCase()}_DONE (dry-run)`,
    };
  };
}

// ─── Post-orchestration: pnpm qa ────────────────────────────────────
interface QaOutcome {
  ok: boolean;
  exitCode: number;
  stage: "install" | "prisma-generate" | "qa" | "ok";
  notes: string;
}

async function installAndQa(
  workDir: string,
  log: (s: string, m: string) => Promise<void>,
): Promise<QaOutcome> {
  const isWin = process.platform === "win32";

  await log("post", "pnpm install (--ignore-workspace --prefer-offline)");
  const install = spawnSync(
    "pnpm",
    ["install", "--ignore-workspace", "--prefer-offline", "--reporter=silent"],
    { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", shell: isWin },
  );
  if (install.status !== 0) {
    await log("post", `✗ pnpm install failed (exit ${install.status})`);
    if (install.stdout) await log("post", install.stdout.slice(-1500));
    if (install.stderr) await log("post", install.stderr.slice(-1500));
    return { ok: false, exitCode: install.status ?? 1, stage: "install", notes: "pnpm install failed" };
  }

  await log("post", "prisma generate");
  const prismaGen = spawnSync(
    "pnpm",
    ["exec", "prisma", "generate", "--schema", "prisma/schema.prisma"],
    { cwd: workDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8", shell: isWin },
  );
  if (prismaGen.status !== 0) {
    await log("post", `✗ prisma generate failed (exit ${prismaGen.status})`);
    if (prismaGen.stdout) await log("post", prismaGen.stdout.slice(-1500));
    if (prismaGen.stderr) await log("post", prismaGen.stderr.slice(-1500));
    return {
      ok: false,
      exitCode: prismaGen.status ?? 1,
      stage: "prisma-generate",
      notes: "prisma generate failed",
    };
  }

  await log("post", "pnpm qa (typecheck + lint + format:check + deps:check + test)");
  const qa = spawnSync("pnpm", ["qa"], {
    cwd: workDir,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
    shell: isWin,
  });
  if (qa.status !== 0) {
    await log("post", `✗ pnpm qa failed (exit ${qa.status})`);
    if (qa.stdout) await log("post", qa.stdout.slice(-3000));
    if (qa.stderr) await log("post", qa.stderr.slice(-1500));
    return { ok: false, exitCode: qa.status ?? 1, stage: "qa", notes: "pnpm qa failed" };
  }
  await log("post", "✓ pnpm qa green");
  return { ok: true, exitCode: 0, stage: "ok", notes: "all checks green" };
}

async function resolveResumeWorkDir(arg: string): Promise<string> {
  if (arg === "latest") {
    const outDir = join(REPO_ROOT, "out");
    let entries: string[] = [];
    try {
      entries = await readdir(outDir);
    } catch {
      throw new Error(`out/ does not exist; cannot resolve --resume latest`);
    }
    const matches = entries
      .filter((e) => e.startsWith("yoga-regen-v2-"))
      .sort()
      .reverse();
    const newest = matches[0];
    if (!newest) throw new Error(`no out/yoga-regen-v2-* directories found for --resume latest`);
    return join(outDir, newest);
  }
  return resolve(arg);
}

// ─── Main ───────────────────────────────────────────────────────────
async function main(): Promise<number> {
  const startedAt = Date.now();
  const tsTag = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/T/, "_")
    .slice(0, 19);

  let workDir: string;
  const resumeActive = RESUME_ARG !== null;
  if (resumeActive) {
    try {
      workDir = await resolveResumeWorkDir(RESUME_ARG);
    } catch (err) {
      console.error(`✗ --resume: ${(err as Error).message}`);
      return 2;
    }
    if (!existsSync(workDir)) {
      console.error(`✗ --resume: workDir does not exist: ${workDir}`);
      return 2;
    }
  } else {
    workDir = resolve(REPO_ROOT, "out", `yoga-regen-v2-${tsTag}`);
    await mkdir(workDir, { recursive: true });
  }

  const logFile = join(workDir, "_orchestration.log");
  const log = await makeLogger(logFile);

  await log("init", `MODE=${MODE_DRY_RUN ? "--dry-run (synthetic)" : "--real (LLM)"}${resumeActive ? " [+resume]" : ""}`);
  await log("init", `workDir = ${workDir}`);
  await log("init", `maxFixRounds = ${MODE_DRY_RUN ? 0 : MAX_FIX_ROUNDS}`);

  if (!resumeActive) {
    try {
      await setupWorkDir(workDir, log);
    } catch (err) {
      await log("setup", `✗ setup failed: ${(err as Error).message}`);
      return 2;
    }
  } else {
    const discoveryFile = join(workDir, ".atelier", "discovery.json");
    if (!existsSync(discoveryFile)) {
      await log("setup", `✗ resume: missing ${discoveryFile} — cannot resume without an injected discovery`);
      return 2;
    }
    await log("setup", `↩ resume: reusing workDir (.atelier/discovery.json present)`);
  }

  let discovery: Discovery;
  try {
    if (resumeActive) {
      const raw = await readFile(join(workDir, ".atelier", "discovery.json"), "utf-8");
      const parsed = discoverySchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        const err = parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ");
        throw new Error(`resume discovery.json fails schema: ${err}`);
      }
      discovery = parsed.data;
      await log("discovery", `↩ resume: loaded existing discovery.json (${discovery.entities.length} entities, ${discovery.useCases.length} useCases)`);
    } else {
      discovery = await injectDiscovery(workDir, log);
    }
  } catch (err) {
    await log("discovery", `✗ ${(err as Error).message}`);
    return 2;
  }

  // Skip wave-1-discovery (PRD pre-injected). Strip its dep from downstream.
  const wavesWithoutDiscovery: Wave[] = WAVES_V2.filter((w) => w.name !== "wave-1-discovery").map(
    (w) => ({
      ...w,
      dependsOn: w.dependsOn.filter((d) => d !== "wave-1-discovery"),
    }),
  );

  await log(
    "init",
    `running ${wavesWithoutDiscovery.length} waves (Discovery skipped): ${wavesWithoutDiscovery
      .map((w) => w.name)
      .join(" → ")}`,
  );

  const runner: AgentRunner = MODE_REAL
    ? buildRealRunner(log, { resume: resumeActive })
    : buildFakeRunner(log, { resume: resumeActive });
  const emit = async (event: OrchestratorV2Event): Promise<void> => {
    const s = summarizeEvent(event);
    if (s) await log(s.stage, s.msg);
  };

  let orchestratorResult;
  try {
    orchestratorResult = await runGenerationV2({
      generationId: `yoga-${tsTag}`,
      prd: discovery,
      workDir,
      emit,
      runner,
      waves: wavesWithoutDiscovery,
      maxFixRounds: MODE_DRY_RUN ? 0 : MAX_FIX_ROUNDS,
    });
  } catch (err) {
    await log("orchestrator", `✗ unhandled error: ${(err as Error).message}`);
    return 3;
  }

  const orchMs = orchestratorResult.durationMs;
  const qaDecision = orchestratorResult.qa?.decision ?? "unknown";
  const filesCount = orchestratorResult.files.length;
  await log(
    "orchestrator",
    `summary: duration=${(orchMs / 1000).toFixed(1)}s files=${filesCount} qa.decision=${qaDecision}`,
  );

  if (orchestratorResult.failedAt) {
    const f = orchestratorResult.failedAt;
    await log("orchestrator", `✗ failedAt wave=${f.wave} agent=${f.agent} reason=${f.reason}`);
    await log("done", tagLine({ decision: "NO-GO", durationMs: Date.now() - startedAt, workDir, note: `orchestrator-failed:${f.agent}` }));
    return 4;
  }

  // Dry-run skips pnpm qa to keep the validation fast.
  if (MODE_DRY_RUN) {
    const totalMs = Date.now() - startedAt;
    const decision = qaDecision === "go" ? "GO" : "NO-GO";
    await log("done", tagLine({ decision, durationMs: totalMs, workDir, note: "dry-run (pnpm qa skipped)" }));
    return decision === "GO" ? 0 : 1;
  }

  // Real run: install + prisma generate + pnpm qa
  const qa = await installAndQa(workDir, log);
  const totalMs = Date.now() - startedAt;
  const final = qa.ok && qaDecision === "go" ? "GO" : "NO-GO";
  const note = qa.ok
    ? `qa-reviewer=${qaDecision} pnpm-qa=ok`
    : `qa-reviewer=${qaDecision} pnpm-qa=fail(${qa.stage})`;
  await log("done", tagLine({ decision: final, durationMs: totalMs, workDir, note }));
  return final === "GO" ? 0 : 1;
}

function tagLine(input: { decision: string; durationMs: number; workDir: string; note: string }): string {
  const mins = (input.durationMs / 60_000).toFixed(2);
  return `▣ FINAL: ${input.decision} | duration=${mins}min | workDir=${input.workDir} | ${input.note}`;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(99);
  },
);
