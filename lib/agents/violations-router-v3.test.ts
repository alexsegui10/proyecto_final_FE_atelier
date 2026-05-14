import { describe, it, expect } from "vitest";

import {
  routeViolationToAgentV3,
  getRoutingTableV3,
} from "./violations-router-v3";
import { AGENT_NAMES_V3, AGENT_NAME_V3_SET, isAgentNameV3 } from "./contracts-v3/agent-names";

describe("AgentNameV3 union", () => {
  it("declares exactly 24 agents (17 v2 + 7 new)", () => {
    expect(AGENT_NAMES_V3).toHaveLength(24);
  });

  it("includes all 7 net-new v3 agents", () => {
    const expected = [
      "bootstrap-devops",
      "layout-architect",
      "brand-identity",
      "animation-choreographer",
      "visual-adapter",
      "accessibility",
      "visual-qa",
    ];
    for (const a of expected) {
      expect(AGENT_NAME_V3_SET.has(a)).toBe(true);
    }
  });

  it("keeps the 17 v2 agent names verbatim", () => {
    const v2 = [
      "discovery", "architect", "ux-ui-designer", "domain-modeler",
      "persistence", "seeds-shape", "service-layer", "auth-security",
      "rbac-authorization", "api-backend", "frontend-architect",
      "ui-components", "forms-validations", "pages-routing",
      "seeds-fixtures", "tests-writer", "qa-reviewer",
    ];
    for (const a of v2) {
      expect(AGENT_NAME_V3_SET.has(a)).toBe(true);
    }
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

  it("routes motion paths to animation-choreographer", () => {
    expect(routeViolationToAgentV3("client/motion/fade-in.ts")).toBe("animation-choreographer");
    expect(routeViolationToAgentV3("client/hooks/useMotionFadeIn.ts")).toBe("animation-choreographer");
  });

  it("routes visual QA paths to visual-qa", () => {
    expect(routeViolationToAgentV3("playwright.config.ts")).toBe("visual-qa");
    expect(routeViolationToAgentV3("tests/visual/home.spec.ts")).toBe("visual-qa");
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
