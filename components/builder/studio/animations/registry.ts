import type { AgentNameV3 } from "@/lib/agents/contracts-v3/agent-names";

import { ArchitectCompass } from "./architect-compass";
import { DomainCubes } from "./domain-cubes";
import { UseCasesGears } from "./usecases-gears";
import { AuthShield } from "./auth-shield";
import { ApiGrid } from "./api-grid";
import { QaScanner } from "./qa-scanner";
import { GenericPulse } from "./generic-pulse";

type AnimationComponent = React.ComponentType<{ active: boolean }>;

const ANIMATION_MAP: Partial<Record<AgentNameV3, AnimationComponent>> = {
  // v3 agent → closest v1 animation
  "architect":          ArchitectCompass,   // architect-compass
  "layout-architect":   ArchitectCompass,   // same visual — layout is still architecture
  "domain-modeler":     DomainCubes,        // domain-cubes
  "persistence":        DomainCubes,        // closely related to domain modeling
  "service-layer":      UseCasesGears,      // usecases-gears
  "auth-security":      AuthShield,         // auth-shield
  "rbac-authorization": AuthShield,         // same shield metaphor
  "api-backend":        ApiGrid,            // api-grid
  "qa-reviewer":        QaScanner,          // qa-scanner
  "visual-qa":          QaScanner,          // same scanner, different target
};

export function getAnimationForAgent(agent: AgentNameV3): AnimationComponent {
  return ANIMATION_MAP[agent] ?? GenericPulse;
}
