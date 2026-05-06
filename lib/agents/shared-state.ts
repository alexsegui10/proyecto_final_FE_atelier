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
