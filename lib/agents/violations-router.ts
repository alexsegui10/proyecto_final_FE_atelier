import type {
  GeneratorAgentName,
  QaArtifact,
} from "./shared-state";

export type Violation = QaArtifact["violations"][number];

/**
 * Map a QA violation to the agent responsible for fixing it, based on the
 * `where` field (file path). The mapping mirrors the architectural layers
 * each agent owns, plus a few special cases (auth/proxy/schema) where the
 * file's path doesn't follow the standard `src/<layer>/<feature>/` pattern.
 *
 * If a violation has no `where` field or no rule matches, returns null.
 * Caller decides what to do with unrouteable violations (default: surface
 * them as "manual fix needed" and skip the fix loop for that one).
 */
export function routeViolation(violation: Violation): GeneratorAgentName | null {
  const where = violation.where ?? "";
  const path = where.split(":")[0]; // strip line numbers
  const norm = path.replace(/\\/g, "/").trim();
  if (norm.length === 0) return null;

  // Auth-related — owned by auth-rbac.
  if (
    norm.startsWith("src/application/auth/") ||
    norm.startsWith("src/infrastructure/auth/") ||
    norm.startsWith("src/presentation/auth/") ||
    norm.startsWith("app/api/auth/") ||
    norm === "proxy.ts"
  ) {
    return "auth-rbac";
  }

  // Schema + Prisma client + mappers + infra repos — owned by domain-persistence.
  if (
    norm === "prisma/schema.prisma" ||
    norm.startsWith("prisma/") ||
    norm.startsWith("src/domain/") ||
    norm.startsWith("src/infrastructure/db/") ||
    /^src\/infrastructure\/[^/]+\/(repository|mapper)\.ts$/.test(norm)
  ) {
    return "domain-persistence";
  }

  // Application use cases.
  if (norm.startsWith("src/application/")) {
    return "use-cases";
  }

  // Presentation: route handlers, controllers, schemas, pages, components.
  if (
    norm.startsWith("src/presentation/") ||
    norm.startsWith("app/api/") ||
    norm.startsWith("app/(") ||
    norm.startsWith("app/") ||
    norm.startsWith("components/")
  ) {
    return "api-frontend";
  }

  // Tests live with QA.
  if (norm.startsWith("tests/")) {
    return "qa-reviewer";
  }

  return null;
}

export interface RoutingResult {
  /** Violations grouped by responsible agent, ready to feed back as fix context. */
  byAgent: Map<GeneratorAgentName, Violation[]>;
  /** Violations we couldn't map — caller should surface these for manual review. */
  unrouteable: Violation[];
}

export function routeViolationsToAgents(qa: QaArtifact): RoutingResult {
  const byAgent = new Map<GeneratorAgentName, Violation[]>();
  const unrouteable: Violation[] = [];

  for (const v of qa.violations) {
    if (v.severity === "warn") continue; // only errors trigger fix attempts
    const agent = routeViolation(v);
    if (agent === null) {
      unrouteable.push(v);
      continue;
    }
    const list = byAgent.get(agent) ?? [];
    list.push(v);
    byAgent.set(agent, list);
  }

  return { byAgent, unrouteable };
}
