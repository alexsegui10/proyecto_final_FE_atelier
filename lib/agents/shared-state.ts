/**
 * Type definitions for the artifacts produced by the 6 generator agents.
 * Each agent writes its own artifact to `.atelier/<agent>.json` in the
 * workDir; the orchestrator tracks them here for type-safe handoffs.
 */

import type { PRDState } from "./prd-state";

export type GeneratorAgentName =
  | "architect"
  | "domain-persistence"
  | "use-cases"
  | "auth-rbac"
  | "api-frontend"
  | "qa-reviewer";

export const GENERATOR_AGENT_ORDER: readonly GeneratorAgentName[] = [
  "architect",
  "domain-persistence",
  "use-cases",
  "auth-rbac",
  "api-frontend",
  "qa-reviewer",
] as const;

/**
 * Execution phases for `runGeneration`. Each entry is a list of agents that
 * run together in parallel. Single-agent entries run serially. The DAG is:
 *
 *   architect → domain-persistence → [use-cases || auth-rbac] → api-frontend → qa-reviewer
 *
 * `use-cases` and `auth-rbac` both consume domain-persistence output but
 * write to disjoint paths (auth-rbac owns src/{application,infrastructure,
 * presentation}/auth/ + app/api/auth/ + proxy.ts; use-cases owns the rest of
 * src/application/). Running them concurrently saves ~3 minutes per
 * generation.
 */
export const GENERATOR_PHASES: ReadonlyArray<readonly GeneratorAgentName[]> = [
  ["architect"],
  ["domain-persistence"],
  ["use-cases", "auth-rbac"],
  ["api-frontend"],
  ["qa-reviewer"],
] as const;

/**
 * Per-agent default model. Reasoning-heavy agents (architecture, business
 * logic, validation) get Opus; mechanical / high-volume code-translation
 * agents (Prisma schema, auth wiring, route handlers) get Sonnet for ~5x
 * speed at acceptable quality.
 *
 * Override via `runGeneratorAgent({ model })` when needed.
 */
export type AgentModel = "opus" | "sonnet" | "haiku";

/**
 * Per-agent timeout in milliseconds. api-frontend writes the most files
 * (~30+) and empirically can run up to ~16-18 min including trailing tokens
 * after the artifact is already on disk. Bumped to 20 min specifically.
 *
 * Override per-call via `runGeneratorAgent({ timeoutMs })` for tests.
 */
export const AGENT_DEFAULT_TIMEOUT_MS: Record<GeneratorAgentName, number> = {
  // Camino 3 timeouts — bumped because the new prompts produce poli-style
  // structure (one-file-per-thing) which means much more output per agent.
  // architect produces a richer plan (pages[] + components[]).
  architect: 5 * 60_000,
  // domain-persistence writes 5 files per entity instead of 4.
  "domain-persistence": 15 * 60_000,
  // use-cases (Service) consolidates methods into one Service class per
  // feature but adds tests; net similar size, give it room.
  "use-cases": 20 * 60_000,
  "auth-rbac": 15 * 60_000,
  // api-frontend explodes — backend presentation + frontend (services,
  // hooks, context, components, pages, app router). Target 80-130 files.
  "api-frontend": 35 * 60_000,
  // QA: 4 gates over a much bigger codebase + smoke tests.
  "qa-reviewer": 30 * 60_000,
};

export const AGENT_DEFAULT_MODEL: Record<GeneratorAgentName, AgentModel> = {
  architect: "opus",
  // domain-persistence: empirical run with Sonnet was 4 min slower than
  // Opus on the yoga fixture (10m31s vs 6m22s). The "mechanical" heuristic
  // didn't pay off — Sonnet second-guesses Prisma syntax across many turns.
  "domain-persistence": "opus",
  "use-cases": "opus",
  // auth-rbac is short (~2 min either way); Sonnet is fine here.
  "auth-rbac": "sonnet",
  // api-frontend stays on Opus: empirical run shows Sonnet exceeds the
  // 15-min per-agent timeout on this volume of files (Opus completes in
  // ~12-13 min). Mechanical heuristic doesn't apply when output is large.
  "api-frontend": "opus",
  "qa-reviewer": "opus",
};

/** PRD reuses the Discovery state shape. */
export type PRD = PRDState;

export interface ArchitectArtifact {
  features: Array<{ name: string; domain: string; description: string }>;
  roles: string[];
  decisions: Record<string, string>;
  folder_layout: Record<string, string[]>;
}

export interface DomainPersistenceArtifact {
  models: Array<{
    name: string;
    fields: Array<Record<string, unknown>>;
    indexes?: string[];
    softDelete?: boolean;
  }>;
  relations?: Array<{ from: string; to: string; kind: string }>;
}

export interface UseCasesArtifact {
  useCases: Array<{
    feature: string;
    name: string;
    input: Record<string, string>;
    output: Record<string, string>;
    throws: string[];
  }>;
}

export interface AuthRbacArtifact {
  auth: string;
  session_strategy: string;
  roles: string[];
  abilities_per_role: Record<string, string[]>;
}

export interface ApiFrontendArtifact {
  endpoints: Array<{
    method: string;
    path: string;
    useCase: string;
    guards?: string[];
  }>;
  pages: Array<{
    path: string;
    feature: string;
    rolesVisible: string[];
  }>;
}

export interface QaCheck {
  name: "typecheck" | "lint" | "deps:check" | "test";
  status: "pass" | "fail";
  detail: string;
}

export interface QaArtifact {
  checks: QaCheck[];
  decision: "go" | "no-go";
  violations: Array<{
    rule: string;
    where?: string;
    issue: string;
    severity: "error" | "warn";
    /**
     * Optional one-line patch the QA agent recommends. When present, the
     * fix loop surfaces this VERBATIM at the top of the violation context
     * sent to the responsible agent — they should apply it as-is rather
     * than reinventing the pattern.
     */
    recommendedFix?: string;
  }>;
  summary: string;
}

export interface SharedState {
  prd: PRD;
  architect?: ArchitectArtifact;
  domainPersistence?: DomainPersistenceArtifact;
  useCases?: UseCasesArtifact;
  authRbac?: AuthRbacArtifact;
  apiFrontend?: ApiFrontendArtifact;
  qa?: QaArtifact;
}

/**
 * Mapping from agent → which prior artifacts it needs to read. Used by the
 * orchestrator to compose the user prompt that points the agent at the
 * relevant `.atelier/*.json` files. The agent itself reads them via its
 * Read tool inside the workDir.
 */
export const AGENT_INPUT_DEPENDENCIES: Record<GeneratorAgentName, GeneratorAgentName[]> = {
  architect: [],
  "domain-persistence": ["architect"],
  "use-cases": ["architect", "domain-persistence"],
  "auth-rbac": ["architect", "domain-persistence", "use-cases"],
  "api-frontend": ["architect", "domain-persistence", "use-cases", "auth-rbac"],
  "qa-reviewer": [
    "architect",
    "domain-persistence",
    "use-cases",
    "auth-rbac",
    "api-frontend",
  ],
};
