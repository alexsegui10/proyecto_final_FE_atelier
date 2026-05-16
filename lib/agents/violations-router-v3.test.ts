import { describe, it, expect } from "vitest";

import {
  routeViolationToAgentV3,
  getRoutingTableV3,
} from "./violations-router-v3";
import { AGENT_NAMES_V3, AGENT_NAME_V3_SET, isAgentNameV3 } from "./contracts-v3/agent-names";

describe("AgentNameV3 union", () => {
  it("declares exactly 22 agents (16 v2 + 6 new; pages-routing dropped in v3)", () => {
    expect(AGENT_NAMES_V3).toHaveLength(22);
  });

  it("includes all 6 net-new v3 agents", () => {
    const expected = [
      "bootstrap-devops",
      "layout-architect",
      "brand-identity",
      "visual-adapter",
      "accessibility",
      "visual-qa",
    ];
    for (const a of expected) {
      expect(AGENT_NAME_V3_SET.has(a)).toBe(true);
    }
  });

  it("keeps 16 of the 17 v2 agent names verbatim (pages-routing dropped in v3)", () => {
    const v2Kept = [
      "discovery", "architect", "ux-ui-designer", "domain-modeler",
      "persistence", "seeds-shape", "service-layer", "auth-security",
      "rbac-authorization", "api-backend", "frontend-architect",
      "ui-components", "forms-validations",
      "seeds-fixtures", "tests-writer", "qa-reviewer",
    ];
    for (const a of v2Kept) {
      expect(AGENT_NAME_V3_SET.has(a)).toBe(true);
    }
    // pages-routing was removed in v3 (role absorbed by visual-adapter).
    expect(AGENT_NAME_V3_SET.has("pages-routing")).toBe(false);
  });

  it("isAgentNameV3 narrows strings correctly", () => {
    expect(isAgentNameV3("bootstrap-devops")).toBe(true);
    expect(isAgentNameV3("does-not-exist")).toBe(false);
  });
});

describe("routeViolationToAgentV3 — v3 additions", () => {
  it.each([
    [".env.example", "bootstrap-devops"],
    [".env.local", "bootstrap-devops"],
    ["docker-compose.yml", "bootstrap-devops"],
    ["docker-compose.yaml", "bootstrap-devops"],
    ["scripts/setup.ps1", "bootstrap-devops"],
    ["scripts/setup.sh", "bootstrap-devops"],
    ["src/_shared/config/env.ts", "bootstrap-devops"],
    ["src/_shared/config/check-environment.ts", "bootstrap-devops"],
    ["README.md", "bootstrap-devops"],
  ])("routes %s → %s", (path, expected) => {
    expect(routeViolationToAgentV3(path)).toBe(expected);
  });

  it("routes brand identity paths to brand-identity", () => {
    expect(routeViolationToAgentV3("client/brand/logo.svg")).toBe("brand-identity");
    expect(routeViolationToAgentV3("client/i18n/es.json")).toBe("brand-identity");
    expect(routeViolationToAgentV3("client/lib/microcopy.ts")).toBe("brand-identity");
  });

  it("routes motion paths to ui-components (animation-choreographer removed)", () => {
    expect(routeViolationToAgentV3("client/motion/fade-in.ts")).toBe("ui-components");
    expect(routeViolationToAgentV3("client/hooks/useMotionFadeIn.ts")).toBe("ui-components");
  });

  it("routes visual QA paths to visual-qa", () => {
    expect(routeViolationToAgentV3("playwright.config.ts")).toBe("visual-qa");
    expect(routeViolationToAgentV3("tests/visual/home.spec.ts")).toBe("visual-qa");
  });

  it("routes App Router paths to visual-adapter (pages-routing removed, B-w4-7)", () => {
    // pages-routing was removed in v3; visual-adapter is the single owner of
    // app/*. These v3 rules override the v2 base (which still maps to the
    // now-nonexistent pages-routing via fall-through).
    expect(routeViolationToAgentV3("app/page.tsx")).toBe("visual-adapter");
    expect(routeViolationToAgentV3("app/(dashboard)/profile/page.tsx")).toBe("visual-adapter");
    expect(routeViolationToAgentV3("app/(public)/layout.tsx")).toBe("visual-adapter");
    expect(routeViolationToAgentV3("app/not-found.tsx")).toBe("visual-adapter");
    expect(routeViolationToAgentV3("app/error.tsx")).toBe("visual-adapter");
  });
});

describe("routeViolationToAgentV3 — v2 superset", () => {
  it("falls through to v2 router for unchanged paths", () => {
    // Persistence territory — should still resolve identically to v2.
    expect(routeViolationToAgentV3("prisma/schema.prisma")).toBe("persistence");
    expect(routeViolationToAgentV3("src/auth/domain/entity/User.ts")).toBe("domain-modeler");
    expect(routeViolationToAgentV3("src/auth/application/service/AuthService.ts"))
      .toBe("auth-security");
    expect(routeViolationToAgentV3("client/components/Shop/Card.tsx")).toBe("ui-components");
  });

  it("returns null for unknown paths", () => {
    expect(routeViolationToAgentV3("random/file/that/no-one/owns.txt")).toBeNull();
    expect(routeViolationToAgentV3("")).toBeNull();
  });

  it("strips line/col suffix before matching", () => {
    expect(routeViolationToAgentV3("docker-compose.yml:12:5")).toBe("bootstrap-devops");
    expect(routeViolationToAgentV3("prisma/schema.prisma:3")).toBe("persistence");
  });

  it("handles Windows backslashes", () => {
    expect(routeViolationToAgentV3("client\\brand\\logo.svg")).toBe("brand-identity");
    expect(routeViolationToAgentV3("scripts\\setup.ps1")).toBe("bootstrap-devops");
  });
});

describe("getRoutingTableV3 snapshot", () => {
  it("exposes both v2 and v3 sources", () => {
    const table = getRoutingTableV3();
    const sources = new Set(table.map((r) => r.source));
    expect(sources.has("v2")).toBe(true);
    expect(sources.has("v3")).toBe(true);
  });

  it("every entry has a valid agent name", () => {
    for (const entry of getRoutingTableV3()) {
      expect(AGENT_NAME_V3_SET.has(entry.agent)).toBe(true);
    }
  });
});
