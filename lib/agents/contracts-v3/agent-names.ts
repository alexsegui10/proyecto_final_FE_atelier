/**
 * Atelier v3 agent namespace.
 *
 * v3 = 17 v2 agents + 6 new agents = 23 total (visual-adapter added in
 * the Stitch preserve-design rework, see ROADMAP_V3 § 5.1 reinterpreted;
 * animation-choreographer removed as a ghost — reduced-motion moved to
 * bootstrap-devops globals.css, see V3_PROGRESS.md "Cambios arquitecturales").
 *
 * The 17 existing agents keep their v2 names verbatim. The 6 net-new are:
 * - bootstrap-devops    (wave 1, between discovery and architect)
 * - layout-architect    (wave 2, after ux-ui-designer)
 * - brand-identity      (wave 2, parallel with layout-architect)
 * - visual-adapter      (wave 4, after ui-components — owns Stitch HTML adaptation)
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
  | "visual-adapter"
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
  "visual-adapter",
  "accessibility",
  "visual-qa",
] as const;

/** Membership check that narrows the union, useful for parsing strings. */
export function isAgentNameV3(value: string): value is AgentNameV3 {
  return (AGENT_NAMES_V3 as readonly string[]).includes(value);
}

/** Set form for fast lookups (used by violations router etc.). */
export const AGENT_NAME_V3_SET: ReadonlySet<string> = new Set<string>(AGENT_NAMES_V3);
