import { describe, it, expect } from "vitest";

import type { QaArtifact } from "./shared-state";
import {
  routeViolation,
  routeViolationsToAgents,
  type Violation,
} from "./violations-router";

function v(where: string, severity: Violation["severity"] = "error"): Violation {
  return {
    rule: "test",
    where,
    issue: "test issue",
    severity,
  };
}

describe("routeViolation", () => {
  it("routes domain files to domain-persistence", () => {
    expect(routeViolation(v("src/domain/bookings/entity.ts:12"))).toBe("domain-persistence");
    expect(routeViolation(v("src/domain/_shared/errors.ts"))).toBe("domain-persistence");
  });

  it("routes prisma schema and infra repos to domain-persistence", () => {
    expect(routeViolation(v("prisma/schema.prisma"))).toBe("domain-persistence");
    expect(routeViolation(v("prisma.config.ts"))).toBe("domain-persistence");
    expect(routeViolation(v("prisma.config.ts:7"))).toBe("domain-persistence");
    expect(routeViolation(v("src/infrastructure/bookings/repository.ts:42"))).toBe("domain-persistence");
    expect(routeViolation(v("src/infrastructure/classes/mapper.ts:1"))).toBe("domain-persistence");
    expect(routeViolation(v("src/infrastructure/db/client.ts:11"))).toBe("domain-persistence");
  });

  it("routes anything under src/application/auth to auth-rbac (special case)", () => {
    expect(routeViolation(v("src/application/auth/abilities.ts:68"))).toBe("auth-rbac");
  });

  it("routes other src/application files to use-cases", () => {
    expect(routeViolation(v("src/application/bookings/use-cases/createBooking.ts:30"))).toBe("use-cases");
    expect(routeViolation(v("src/application/_shared/transaction.ts"))).toBe("use-cases");
  });

  it("routes auth infrastructure files (Better Auth, mapper) to auth-rbac", () => {
    expect(routeViolation(v("src/infrastructure/auth/better-auth.ts"))).toBe("auth-rbac");
    expect(routeViolation(v("src/infrastructure/auth/mapper.ts:13"))).toBe("auth-rbac");
  });

  it("routes proxy.ts to auth-rbac (it owns middleware)", () => {
    expect(routeViolation(v("proxy.ts:19"))).toBe("auth-rbac");
  });

  it("routes app/api/auth to auth-rbac", () => {
    expect(routeViolation(v("app/api/auth/[...all]/route.ts"))).toBe("auth-rbac");
  });

  it("routes app/api/<feature> and pages to api-frontend", () => {
    expect(routeViolation(v("app/api/bookings/route.ts:12"))).toBe("api-frontend");
    expect(routeViolation(v("app/(dashboard)/clases/page.tsx:5"))).toBe("api-frontend");
    expect(routeViolation(v("components/builder/top-nav.tsx"))).toBe("api-frontend");
    expect(routeViolation(v("src/presentation/bookings/controller.ts"))).toBe("api-frontend");
  });

  it("routes tests/** to qa-reviewer", () => {
    expect(routeViolation(v("tests/bookings.smoke.test.ts:10"))).toBe("qa-reviewer");
  });

  it("returns null for unmapped paths", () => {
    expect(routeViolation(v(""))).toBeNull();
    expect(routeViolation(v("scripts/something.ts"))).toBeNull();
    expect(routeViolation(v("README.md"))).toBeNull();
  });

  it("handles backslashes (Windows paths) by normalising", () => {
    expect(routeViolation(v("src\\domain\\bookings\\entity.ts:12"))).toBe("domain-persistence");
    expect(routeViolation(v("app\\api\\bookings\\route.ts"))).toBe("api-frontend");
  });
});

describe("routeViolationsToAgents", () => {
  const baseQa: QaArtifact = {
    checks: [],
    decision: "no-go",
    violations: [],
    summary: "test",
  };

  it("groups errors by responsible agent and skips warnings", () => {
    const qa: QaArtifact = {
      ...baseQa,
      violations: [
        v("src/domain/bookings/entity.ts:5", "error"),
        v("src/infrastructure/bookings/repository.ts:42", "error"),
        v("src/application/auth/abilities.ts:68", "error"),
        v("app/(dashboard)/reservas/page.tsx:59", "error"),
        v("proxy.ts:19", "warn"), // skipped
      ],
    };
    const { byAgent, unrouteable } = routeViolationsToAgents(qa);
    expect(byAgent.get("domain-persistence")).toHaveLength(2);
    expect(byAgent.get("auth-rbac")).toHaveLength(1);
    expect(byAgent.get("api-frontend")).toHaveLength(1);
    expect(byAgent.get("use-cases")).toBeUndefined();
    expect(unrouteable).toHaveLength(0);
  });

  it("collects unrouteable violations separately so the loop can surface them", () => {
    const qa: QaArtifact = {
      ...baseQa,
      violations: [
        v("README.md", "error"),
        v("scripts/build.ts", "error"),
        v("src/domain/bookings/entity.ts", "error"),
      ],
    };
    const { byAgent, unrouteable } = routeViolationsToAgents(qa);
    expect(byAgent.get("domain-persistence")).toHaveLength(1);
    expect(unrouteable).toHaveLength(2);
  });
});
