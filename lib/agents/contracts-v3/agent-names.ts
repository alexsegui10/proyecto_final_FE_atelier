/**
 * Atelier v3 agent namespace.
 *
 * v3 = 17 v2 agents + 6 new agents = 23 total.
 *
 * The 17 existing agents keep their v2 names verbatim. The 6 new ones are:
 * - bootstrap-devops    (wave 1, between discovery and architect)
 * - layout-architect    (wave 2, after ux-ui-designer)
 * - brand-identity      (wave 2, parallel with layout-architect)
 * - animation-choreographer (wave 4, after ui-components)
 * - accessibility       (wave 5)
 * - visual-qa           (wave 7)
 *
 * See `ROADMAP_V3.md` § 6 for the wave assignment and `PENDING_V3_DECISIONS.md`
 * for why `api-contract` is NOT a separate agent (it's the artifact filename
 * produced by `api-backend`).
 */

export type AgentNameV3 =
  // ── 17 agents inherited from v2 ────────────────────────────────────
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
  | "qa-reviewer"
  // ── 6 net-new agents in v3 ─────────────────────────────────────────
  | "bootstrap-devops"
  | "layout-architect"
  | "brand-identity"
  | "animation-choreographer"
  | "accessibility"
  | "visual-qa";

export const AGENT_NAMES_V3: readonly AgentNameV3[] = [
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
  "bootstrap-devops",
  "layout-architect",
  "brand-identity",
  "animation-choreographer",
  "accessibility",
  "visual-qa",
] as const;

/** Membership check that narrows the union, useful for parsing strings. */
export function isAgentNameV3(value: string): value is AgentNameV3 {
  return (AGENT_NAMES_V3 as readonly string[]).includes(value);
}

/** Set form for fast lookups (used by violations router etc.). */
export const AGENT_NAME_V3_SET: ReadonlySet<string> = new Set<string>(AGENT_NAMES_V3);
