import type {
  GeneratorAgentName,
  QaArtifact,
} from "./shared-state";

export type Violation = QaArtifact["violations"][number];

/**
 * Map a workspace file path to the agent that owns it. Used to:
 *   1. Attribute `agent.file_created` events when multiple agents run in
 *      parallel within a single phase.
 *   2. Route QA violations to the responsible agent for the fix loop
 *      (via `routeViolation`).
 *
 * Returns null if the path doesn't match any agent's territory.
 */
export function routeFilePath(rawPath: string): GeneratorAgentName | null {
  const path = rawPath.split(":")[0]; // strip line:col suffixes from violations
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

/**
 * Map a QA violation to the agent responsible for fixing it.
 * Thin wrapper over `routeFilePath`.
 */
export function routeViolation(violation: Violation): GeneratorAgentName | null {
  return routeFilePath(violation.where ?? "");
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
