/**
 * Atelier v3 violations router.
 *
 * Maps workspace file paths to the v3 agent that owns them. Extends the v2
 * routing table with rules for the 7 net-new agents (bootstrap-devops,
 * layout-architect, brand-identity, animation-choreographer, visual-adapter,
 * accessibility, visual-qa). visual-adapter violations typically arrive
 * with their `agent` field pre-set by visual-regression-scanner or
 * stitch-completeness-scanner, so the path-based routing rules below are
 * minimal — only the artifact JSON path is registered.
 *
 * Same priority semantics as v2: higher number wins, ties resolved by
 * first declaration. We keep the v2 rules verbatim so v3 behaviour is a
 * strict superset of v2 — anything routed in v2 routes the same way in v3.
 */
import type { AgentNameV3 } from "./contracts-v3/agent-names";
import {
  getRoutingTable as getRoutingTableV2,
  routeViolationToAgent as routeViolationToAgentV2,
  type AgentNameV2,
} from "./violations-router-v2";

interface RouteRuleV3 {
  pattern: RegExp;
  agent: AgentNameV3;
  priority: number;
}

/**
 * v3-only additions. The v2 table is composed in {@link routeViolationToAgentV3}
 * via fall-through, not duplicated here, so any future v2 router fix
 * propagates automatically.
 */
const V3_ADDITIONS: RouteRuleV3[] = [
  // ─── Wave 1 — Bootstrap & DevOps ────────────────────────────────────
  // Owns env / docker / setup / runtime-check / boot README scaffolding.
  // Priority 12: must outrank architect's generic README rule.
  { pattern: /^\.env(\..+)?$/, agent: "bootstrap-devops", priority: 12 },
  { pattern: /^docker-compose\.ya?ml$/, agent: "bootstrap-devops", priority: 12 },
  { pattern: /^scripts\/setup\.(ps1|sh|cmd)$/, agent: "bootstrap-devops", priority: 12 },
  { pattern: /^src\/_shared\/config\/(env|check-environment)\.ts$/, agent: "bootstrap-devops", priority: 12 },
  // Bootstrap owns the top-level README in v3 (architect cedes it for the
  // boot-friendly content). Priority 6 beats architect's 5 above.
  { pattern: /^README\.md$/i, agent: "bootstrap-devops", priority: 6 },

  // ─── Wave 2 — Layout Architect ──────────────────────────────────────
  // Stitch / global layout decisions. The actual generated layout.tsx files
  // remain owned by pages-routing (priority 7) — layout-architect owns the
  // PLANNING artifacts and any high-level documentation about layout tree.
  { pattern: /^docs\/layout-tree\.md$/, agent: "layout-architect", priority: 8 },
  // App-router root + group layouts are jointly owned: pages-routing writes
  // them, but if the bug is "missing header", that's a layout-architect issue.
  // We keep pages-routing's priority 7 default and let qa-reviewer surface
  // layout-architect violations directly via `agent` field rather than path.

  // ─── Wave 2 — Brand Identity ────────────────────────────────────────
  // Owns brand tokens + microcopy bundle. Tokens live alongside theme files
  // (ux-ui-designer's territory) but the brand JSON manifest is its own.
  { pattern: /^client\/brand\//, agent: "brand-identity", priority: 9 },
  { pattern: /^client\/i18n\//, agent: "brand-identity", priority: 9 },
  { pattern: /^client\/lib\/microcopy\.ts$/, agent: "brand-identity", priority: 9 },
  // SVG logos (we put them under client/brand/ by convention)
  { pattern: /^client\/brand\/logo.*\.svg$/, agent: "brand-identity", priority: 10 },

  // ─── Wave 4 — Animation Choreographer ──────────────────────────────
  // Owns motion code. Animations are usually applied as wrappers over
  // components, so the component files themselves remain ui-components'
  // territory; only dedicated motion files belong here.
  { pattern: /^client\/motion\//, agent: "animation-choreographer", priority: 9 },
  { pattern: /^client\/hooks\/useMotion.*\.ts$/, agent: "animation-choreographer", priority: 9 },

  // ─── Wave 5 — Accessibility ─────────────────────────────────────────
  // The accessibility agent can patch files owned by other agents; it has
  // no exclusive path territory. We DO own the audit report itself.
  { pattern: /^docs\/accessibility-audit\.md$/, agent: "accessibility", priority: 8 },

  // ─── Wave 7 — Visual QA ─────────────────────────────────────────────
  // Playwright config + e2e visual specs + visual diff baseline.
  { pattern: /^playwright\.config\.(ts|js)$/, agent: "visual-qa", priority: 9 },
  { pattern: /^tests\/visual\//, agent: "visual-qa", priority: 9 },
  { pattern: /^tests\/e2e\/visual\//, agent: "visual-qa", priority: 9 },
  { pattern: /^docs\/visual-qa-report\.md$/, agent: "visual-qa", priority: 8 },
];

export function routeViolationToAgentV3(rawPath: string): AgentNameV3 | null {
  // Strip `:line:col` suffixes.
  const path = rawPath.split(":")[0] ?? "";
  const norm = path.replace(/\\/g, "/").trim();
  if (norm.length === 0) return null;

  // Find the best v3-specific match.
  let bestV3: { agent: AgentNameV3; priority: number } | null = null;
  for (const rule of V3_ADDITIONS) {
    if (!rule.pattern.test(norm)) continue;
    if (bestV3 === null || rule.priority > bestV3.priority) {
      bestV3 = { agent: rule.agent, priority: rule.priority };
    }
  }

  // Find the best v2 match (v2 names are also valid v3 names — superset).
  const v2Hit = routeViolationToAgentV2(norm);
  const bestV2Priority = highestV2PriorityForPath(norm);

  if (bestV3 && (!v2Hit || bestV3.priority >= bestV2Priority)) {
    return bestV3.agent;
  }
  return (v2Hit as AgentNameV3 | null) ?? null;
}

/**
 * Compute the highest priority among v2 rules that match `path`. We can't
 * import the v2 rule list directly without leaking internal types, so we
 * read it via the public `getRoutingTable` snapshot.
 */
function highestV2PriorityForPath(path: string): number {
  let best = -Infinity;
  for (const r of getRoutingTableV2()) {
    let re: RegExp;
    try {
      re = new RegExp(r.pattern);
    } catch {
      continue;
    }
    if (re.test(path) && r.priority > best) best = r.priority;
  }
  return best;
}

/** Snapshot for tooling / debugging. */
export function getRoutingTableV3(): ReadonlyArray<{
  pattern: string;
  agent: AgentNameV3;
  priority: number;
  source: "v2" | "v3";
}> {
  const v2 = getRoutingTableV2().map((r) => ({
    pattern: r.pattern,
    agent: r.agent as AgentNameV3,
    priority: r.priority,
    source: "v2" as const,
  }));
  const v3 = V3_ADDITIONS.map((r) => ({
    pattern: r.pattern.source,
    agent: r.agent,
    priority: r.priority,
    source: "v3" as const,
  }));
  return [...v2, ...v3];
}

// Re-export the v2 type guard at the v3 level for ergonomics.
export type { AgentNameV2 };
