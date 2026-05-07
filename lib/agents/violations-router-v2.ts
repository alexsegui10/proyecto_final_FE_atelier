/**
 * V2 violations router — maps file paths to one of the 17 v2 agents.
 *
 * Supports both layouts:
 *   - v2 (feature-first): src/<feature>/{domain,application,infrastructure,presentation}/...
 *   - v1 (layer-first):   src/{domain,application,infrastructure,presentation}/<feature>/...
 *
 * In both cases, paths are mapped to the SAME v2 agent name so that when v2 QA
 * runs against a v1-style codebase (or a partially-migrated repo), violations
 * still reach the right agent.
 *
 * The v1 router at `./violations-router.ts` is left untouched — the v1
 * orchestrator continues to use it. v2 callers import from this file.
 */

export type AgentNameV2 =
  | "discovery"
  | "architect"
  | "ux-ui-designer"
  | "domain-modeler"
  | "persistence"
  | "seeds-shape"
  | "service-layer"
  | "auth-security"
  | "rbac-authorization"
  | "api-backend"
  | "frontend-architect"
  | "ui-components"
  | "forms-validations"
  | "pages-routing"
  | "seeds-fixtures"
  | "tests-writer"
  | "qa-reviewer";

export const AGENT_NAMES_V2: readonly AgentNameV2[] = [
  "discovery",
  "architect",
  "ux-ui-designer",
  "domain-modeler",
  "persistence",
  "seeds-shape",
  "service-layer",
  "auth-security",
  "rbac-authorization",
  "api-backend",
  "frontend-architect",
  "ui-components",
  "forms-validations",
  "pages-routing",
  "seeds-fixtures",
  "tests-writer",
  "qa-reviewer",
] as const;

interface RouteRule {
  pattern: RegExp;
  agent: AgentNameV2;
  /** When > 1, takes precedence over lower-priority rules for the same path. */
  priority: number;
}

/**
 * Ordered routing table. First match wins for ties; explicit `priority` lets
 * narrow rules (e.g. RBAC files inside the auth feature) win over broad rules.
 */
const ROUTING_TABLE: RouteRule[] = [
  // ─── Wave 1 ─────────────────────────────────────────────────────────
  // Architect owns top-level docs and architecture decisions.
  { pattern: /^docs\/ARCHITECTURE\.md$/i, agent: "architect", priority: 5 },
  { pattern: /^README\.md$/i, agent: "architect", priority: 5 },
  // UX/UI Designer owns the design system and global theme.
  { pattern: /^client\/theme\//, agent: "ux-ui-designer", priority: 8 },
  { pattern: /^app\/globals\.css$/, agent: "ux-ui-designer", priority: 8 },
  { pattern: /^tailwind\.config\.(ts|js|cjs|mjs)$/, agent: "ux-ui-designer", priority: 5 },

  // ─── Wave 2 — Persistence wins over Domain on Prisma + repo-impl files ──
  { pattern: /^prisma\/schema\.prisma$/, agent: "persistence", priority: 10 },
  { pattern: /^prisma\/migrations\//, agent: "persistence", priority: 10 },
  { pattern: /^prisma\.config\.(ts|js|cjs|mjs)$/, agent: "persistence", priority: 10 },
  // v2 feature-first: src/<feature>/infrastructure/repository|mapper/...
  {
    pattern: /^src\/[^/]+\/infrastructure\/(repository|mapper)\//,
    agent: "persistence",
    priority: 9,
  },
  {
    pattern: /^src\/[^/]+\/infrastructure\/db\//,
    agent: "persistence",
    priority: 9,
  },
  // Shared db client / Prisma generated code
  { pattern: /^src\/_shared\/infrastructure\/db\//, agent: "persistence", priority: 9 },
  // v2 feature-first: src/<feature>/application/mapper/  (mapper between entity ↔ DTO)
  {
    pattern: /^src\/[^/]+\/application\/mapper\//,
    agent: "persistence",
    priority: 7,
  },
  // v1 layer-first compat: src/infrastructure/<feature>/{repository,mapper}.ts
  {
    pattern: /^src\/infrastructure\/[^/]+\/(repository|mapper)\.ts$/,
    agent: "persistence",
    priority: 9,
  },
  { pattern: /^src\/infrastructure\/db\//, agent: "persistence", priority: 9 },

  // ─── Wave 2 — Domain Modeler ────────────────────────────────────────
  // v2 feature-first: src/<feature>/domain/...
  { pattern: /^src\/[^/]+\/domain\//, agent: "domain-modeler", priority: 7 },
  { pattern: /^src\/_shared\/domain\//, agent: "domain-modeler", priority: 7 },
  // v1 layer-first compat: src/domain/<feature>/...
  { pattern: /^src\/domain\//, agent: "domain-modeler", priority: 7 },

  // ─── Wave 2 — Seeds Shape Designer (planning artifact, not code yet) ─
  { pattern: /^docs\/seeds-plan\.md$/, agent: "seeds-shape", priority: 8 },

  // ─── Wave 3 — Auth & Security ───────────────────────────────────────
  // High priority: auth feature. Check BEFORE generic application/service rules.
  { pattern: /^src\/auth\/.*Service\.ts$/, agent: "auth-security", priority: 11 },
  { pattern: /^src\/auth\/application\/service\//, agent: "auth-security", priority: 11 },
  { pattern: /^src\/auth\/infrastructure\/filter\//, agent: "auth-security", priority: 11 },
  { pattern: /^src\/auth\/presentation\/(controller|router|request|response)\//, agent: "auth-security", priority: 11 },
  { pattern: /^app\/api\/auth\//, agent: "auth-security", priority: 11 },
  // v1 compat: src/{application,infrastructure,presentation}/auth/
  { pattern: /^src\/application\/auth\/(?!abilities|.*Authorization)/, agent: "auth-security", priority: 10 },
  { pattern: /^src\/infrastructure\/auth\//, agent: "auth-security", priority: 10 },
  { pattern: /^src\/presentation\/auth\//, agent: "auth-security", priority: 10 },
  { pattern: /^proxy\.ts$/, agent: "auth-security", priority: 10 },
  { pattern: /^middleware\.ts$/, agent: "auth-security", priority: 10 },

  // ─── Wave 3 — RBAC & Authorization (subset of auth, higher priority) ─
  { pattern: /^src\/auth\/(application\/)?abilities\.ts$/, agent: "rbac-authorization", priority: 12 },
  { pattern: /^src\/auth\/.*Authorization.*\.ts$/, agent: "rbac-authorization", priority: 12 },
  { pattern: /^src\/auth\/infrastructure\/middleware\/withAuthorization\.ts$/, agent: "rbac-authorization", priority: 12 },
  // v1 compat
  { pattern: /^src\/application\/auth\/abilities\.ts$/, agent: "rbac-authorization", priority: 12 },
  { pattern: /^src\/application\/auth\/AuthorizationService\.ts$/, agent: "rbac-authorization", priority: 12 },

  // ─── Wave 3 — Service Layer ─────────────────────────────────────────
  // v2: src/<feature>/application/service/<Feature>Service.ts (NOT under auth/)
  { pattern: /^src\/(?!auth\/)[^/]+\/application\/service\//, agent: "service-layer", priority: 7 },
  { pattern: /^src\/_shared\/application\//, agent: "service-layer", priority: 6 },
  // v1: src/application/<feature>/use-cases/...
  { pattern: /^src\/application\/(?!auth\/)/, agent: "service-layer", priority: 6 },

  // ─── Wave 4 — API Backend (controllers, routers, request/response) ──
  // v2 feature-first
  {
    pattern: /^src\/[^/]+\/presentation\/(controller|router|request|response)\//,
    agent: "api-backend",
    priority: 7,
  },
  { pattern: /^src\/_shared\/presentation\//, agent: "api-backend", priority: 7 },
  // Next.js api route handlers (excluding auth — handled above by auth-security)
  { pattern: /^app\/api\/(?!auth\/)/, agent: "api-backend", priority: 6 },
  // v1 layer-first compat
  { pattern: /^src\/presentation\/(?!auth\/)/, agent: "api-backend", priority: 6 },
  // OpenAPI doc
  { pattern: /^docs\/api\//, agent: "api-backend", priority: 7 },

  // ─── Wave 4 — Frontend Architect (state, hooks, services wiring) ─────
  { pattern: /^client\/context\//, agent: "frontend-architect", priority: 7 },
  { pattern: /^client\/hooks\/(queries|mutations)\//, agent: "frontend-architect", priority: 7 },
  { pattern: /^client\/services\/(queries|mutations)\//, agent: "frontend-architect", priority: 7 },
  { pattern: /^client\/services\/(apiBackend|JwtService)\.ts$/, agent: "frontend-architect", priority: 8 },
  { pattern: /^client\/types\//, agent: "frontend-architect", priority: 5 },

  // ─── Wave 4 — Forms & Validations (NARROWER than UI Components) ─────
  { pattern: /^client\/components\/forms\//, agent: "forms-validations", priority: 9 },
  { pattern: /^client\/lib\/schemas\//, agent: "forms-validations", priority: 9 },
  { pattern: /^client\/hooks\/useFormError\.ts$/, agent: "forms-validations", priority: 9 },

  // ─── Wave 4 — UI Components (everything else under client/components/) ─
  { pattern: /^client\/components\/(ui|Auth|Layout|Home|Shop|Profile|Admin|Shared)\//, agent: "ui-components", priority: 6 },
  { pattern: /^client\/components\//, agent: "ui-components", priority: 4 },
  // v1 compat: src/components/* (the old layout)
  { pattern: /^src\/components\/(?!forms\/)/, agent: "ui-components", priority: 4 },

  // ─── Wave 4 — Pages & Routing ───────────────────────────────────────
  { pattern: /^app\/(?!api\/).+\/page\.tsx$/, agent: "pages-routing", priority: 7 },
  { pattern: /^app\/(?!api\/).+\/layout\.tsx$/, agent: "pages-routing", priority: 7 },
  { pattern: /^app\/(?!api\/).+\/(loading|error|template|default)\.tsx$/, agent: "pages-routing", priority: 7 },
  { pattern: /^app\/page\.tsx$/, agent: "pages-routing", priority: 7 },
  { pattern: /^app\/layout\.tsx$/, agent: "pages-routing", priority: 7 },
  { pattern: /^app\/not-found\.tsx$/, agent: "pages-routing", priority: 7 },

  // ─── Wave 5 — Seeds & Fixtures ──────────────────────────────────────
  { pattern: /^prisma\/seed\.ts$/, agent: "seeds-fixtures", priority: 9 },
  { pattern: /^prisma\/seed-data\//, agent: "seeds-fixtures", priority: 9 },
  { pattern: /^tests\/fixtures\//, agent: "seeds-fixtures", priority: 7 },

  // ─── Wave 5 — Tests Writer ──────────────────────────────────────────
  { pattern: /^tests\/(unit|integration|e2e)\//, agent: "tests-writer", priority: 8 },
  { pattern: /^tests\/helpers\//, agent: "tests-writer", priority: 7 },
  // Per-module test files (e.g. <Feature>Service.test.ts in v2 feature-first).
  // Priority 13 so tests-writer always wins over the file's source-area owner
  // (e.g. forms-validations on a forms test file).
  { pattern: /^src\/.+\.test\.tsx?$/, agent: "tests-writer", priority: 13 },
  { pattern: /^client\/.+\.test\.tsx?$/, agent: "tests-writer", priority: 13 },
  { pattern: /^app\/.+\.test\.tsx?$/, agent: "tests-writer", priority: 13 },
];

/**
 * Map a workspace file path to the v2 agent that owns it.
 * Returns null if the path doesn't match any agent's territory.
 */
export function routeViolationToAgent(rawPath: string): AgentNameV2 | null {
  // Strip `:line:col` suffixes that QA adds to violation paths.
  const path = rawPath.split(":")[0] ?? "";
  // Normalize Windows backslashes.
  const norm = path.replace(/\\/g, "/").trim();
  if (norm.length === 0) return null;

  let best: { agent: AgentNameV2; priority: number } | null = null;
  for (const rule of ROUTING_TABLE) {
    if (!rule.pattern.test(norm)) continue;
    if (best === null || rule.priority > best.priority) {
      best = { agent: rule.agent, priority: rule.priority };
    }
  }
  return best?.agent ?? null;
}

/** Snapshot of the routing table — handy for documentation and tooling. */
export function getRoutingTable(): ReadonlyArray<{ pattern: string; agent: AgentNameV2; priority: number }> {
  return ROUTING_TABLE.map((r) => ({ pattern: r.pattern.source, agent: r.agent, priority: r.priority }));
}
