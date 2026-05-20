/**
 * V3 wave topology — pure data, no Node.js imports.
 *
 * Kept in contracts-v3/ so client components (studio canvas) can import it
 * without pulling in the orchestrator-v3 runtime which imports node:fs.
 */

import type { AgentNameV3 } from "./agent-names";

export type WaveNameV3 =
  | "wave-1-discovery"
  | "wave-1-bootstrap"
  | "wave-1-planning"
  | "wave-2-design"
  | "wave-2-domain"
  | "wave-3-app-security"
  | "wave-4a-api"
  | "wave-4b-frontend-arch"
  | "wave-4c-components-forms"
  | "wave-4d-adapter"
  | "wave-5a-seeds"
  | "wave-5b-tests"
  | "wave-6-static-qa"
  | "wave-7-runtime-qa";

export interface WaveV3 {
  readonly name: WaveNameV3;
  readonly agents: readonly AgentNameV3[];
  readonly dependsOn: readonly WaveNameV3[];
}

export const WAVES_V3: readonly WaveV3[] = [
  { name: "wave-1-discovery",         agents: ["discovery"],                                     dependsOn: [] },
  { name: "wave-1-bootstrap",         agents: ["bootstrap-devops"],                              dependsOn: ["wave-1-discovery"] },
  { name: "wave-1-planning",          agents: ["architect"],                                     dependsOn: ["wave-1-bootstrap"] },
  { name: "wave-2-design",            agents: ["ux-ui-designer", "layout-architect", "brand-identity"], dependsOn: ["wave-1-planning"] },
  { name: "wave-2-domain",            agents: ["domain-modeler", "persistence", "seeds-shape"],  dependsOn: ["wave-2-design"] },
  { name: "wave-3-app-security",      agents: ["service-layer", "auth-security", "rbac-authorization"], dependsOn: ["wave-2-domain"] },
  { name: "wave-4a-api",              agents: ["api-backend"],                                   dependsOn: ["wave-3-app-security"] },
  { name: "wave-4b-frontend-arch",    agents: ["frontend-architect"],                            dependsOn: ["wave-4a-api"] },
  { name: "wave-4c-components-forms", agents: ["ui-components", "forms-validations"],            dependsOn: ["wave-4b-frontend-arch"] },
  { name: "wave-4d-adapter",          agents: ["visual-adapter"],                                dependsOn: ["wave-4c-components-forms"] },
  { name: "wave-5a-seeds",            agents: ["seeds-fixtures"],                                dependsOn: ["wave-4d-adapter"] },
  { name: "wave-5b-tests",            agents: ["tests-writer"],                                  dependsOn: ["wave-5a-seeds"] },
  { name: "wave-6-static-qa",         agents: ["qa-reviewer"],                                   dependsOn: ["wave-5b-tests"] },
  { name: "wave-7-runtime-qa",        agents: ["visual-qa"],                                     dependsOn: ["wave-6-static-qa"] },
] as const;
