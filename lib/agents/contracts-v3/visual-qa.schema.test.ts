import { describe, it, expect } from "vitest";

import {
  validateSeedManifest,
  validateVisualQaReport,
  type FlowSummary,
  type SeedManifest,
  type StepResult,
  type VisualQaReport,
  type VisualQaViolation,
} from "./visual-qa.schema";

// ─── Fixture builders ───────────────────────────────────────────────

function seedManifest(over: Partial<SeedManifest> = {}): SeedManifest {
  return {
    domainSlug: "yoga",
    adminEmail: "admin@demo.yoga",
    adminPassword: "demo1234",
    demoClientEmail: "alumno-demo@demo.yoga",
    demoClientPassword: "demo1234",
    entityCounts: { User: 16, Class: 50, Booking: 200, Membership: 30 },
    primaryDemoIds: {
      Class: "demo-clase-vinyasa",
      Booking: "demo-booking-1",
      Membership: "demo-membership-mensual",
    },
    ...over,
  };
}

function step(over: Partial<StepResult> = {}): StepResult {
  return {
    flow: "client-anonymous",
    name: "open / and verify home renders",
    startedAt: "2026-05-13T22:00:00.000Z",
    durationMs: 350,
    status: "ok",
    screenshot: ".atelier/screenshots/client-anonymous-001-home.png",
    ...over,
  };
}

function flow(over: Partial<FlowSummary> = {}): FlowSummary {
  return {
    flow: "client-anonymous",
    startedAt: "2026-05-13T22:00:00.000Z",
    durationMs: 4_000,
    stepsTotal: 5,
    stepsOk: 5,
    stepsFailed: 0,
    stepsSkipped: 0,
    decision: "go",
    ...over,
  };
}

function violation(over: Partial<VisualQaViolation> = {}): VisualQaViolation {
  return {
    rule: "hydration-mismatch",
    severity: "error",
    agent: "ui-components",
    message: "React hydration warning logged on / — client/server render diverged.",
    recommendedFix:
      "Move `localStorage` / `window` reads from initial render into `useEffect` " +
      "or guard with `typeof window !== 'undefined'` AND mark the component 'use client'.",
    ...over,
  };
}

function report(over: Partial<VisualQaReport> = {}): VisualQaReport {
  return {
    generatedAt: "2026-05-13T22:00:00.000Z",
    appUrl: "http://localhost:3000",
    setup: {
      setupCommand: "pnpm setup",
      setupDurationMs: 45_000,
      bootTimeMs: 8_000,
      healthcheckUrl: "http://localhost:3000/",
      healthcheckStatus: 200,
    },
    flows: [
      flow({ flow: "client-anonymous" }),
      flow({ flow: "client-authenticated" }),
      flow({ flow: "admin" }),
    ],
    steps: [
      step({ flow: "client-anonymous" }),
      step({ flow: "client-authenticated", name: "sign in as demo client" }),
      step({ flow: "admin", name: "sign in as admin" }),
    ],
    screenshots: [],
    consoleEvents: [],
    networkEvents: [],
    violations: [],
    decision: "go",
    summary: "All three flows green. Generated app is ready for handoff.",
    playwrightScriptPath: ".atelier/visual-qa-script.spec.ts",
    ...over,
  };
}

// ─── seed-manifest tests ────────────────────────────────────────────

describe("seedManifestSchema", () => {
  it("accepts a valid v1 manifest with the 3 known domain slugs", () => {
    expect(validateSeedManifest(seedManifest({ domainSlug: "yoga" }))).toBeNull();
    expect(validateSeedManifest(seedManifest({ domainSlug: "tutorias" }))).toBeNull();
    expect(validateSeedManifest(seedManifest({ domainSlug: "restaurant" }))).toBeNull();
  });

  it("rejects unknown domainSlug", () => {
    expect(
      validateSeedManifest(seedManifest({ domainSlug: "ecommerce" as never })),
    ).toMatch(/domainSlug/);
  });

  it("rejects non-PascalCase keys in entityCounts", () => {
    expect(
      validateSeedManifest(
        seedManifest({ entityCounts: { user: 10 } as unknown as SeedManifest["entityCounts"] }),
      ),
    ).toMatch(/entityCounts/);
  });

  it("accepts passthrough fields (forward compat with future Seeds Agent)", () => {
    expect(
      validateSeedManifest({
        ...seedManifest(),
        futureField: "ok",
        anotherFutureBlock: { foo: 1 },
      }),
    ).toBeNull();
  });
});

// ─── visualQaReport — happy path + refinements ──────────────────────

describe("visualQaReportSchema — positive", () => {
  it("accepts a fully green report", () => {
    expect(validateVisualQaReport(report())).toBeNull();
  });

  it("accepts a no-go report with a failed flow + error-severity violation", () => {
    expect(
      validateVisualQaReport(
        report({
          flows: [flow({ flow: "client-anonymous", decision: "no-go", stepsFailed: 1, stepsOk: 4 })],
          steps: [
            step({ flow: "client-anonymous" }),
            step({
              flow: "client-anonymous",
              name: "load /shop classes list",
              status: "failed",
              failureMessage: "list rendered empty when seed declares 50 classes",
            }),
          ],
          violations: [violation({ rule: "seed-missing", agent: "seeds-fixtures" })],
          decision: "no-go",
        }),
      ),
    ).toBeNull();
  });
});

describe("visualQaReportSchema — refinements", () => {
  it("R-step-1: declared flow without any step is rejected", () => {
    expect(
      validateVisualQaReport(
        report({
          flows: [flow({ flow: "admin" })],
          steps: [step({ flow: "client-anonymous" })], // no admin step
        }),
      ),
    ).toMatch(/every declared flow must have at least one step/);
  });

  it("R-step-2: failed step without failureMessage is rejected", () => {
    expect(
      validateVisualQaReport(
        report({
          steps: [step({ status: "failed" })], // missing failureMessage
        }),
      ),
    ).toMatch(/failureMessage/);
  });

  it("R-flow-1: flow stepsTotal must equal Ok + Failed + Skipped", () => {
    expect(
      validateVisualQaReport(
        report({
          flows: [flow({ stepsTotal: 5, stepsOk: 2, stepsFailed: 1, stepsSkipped: 0 })],
          steps: [step()],
        }),
      ),
    ).toMatch(/stepsOk \+ stepsFailed \+ stepsSkipped/);
  });

  it("R-decision-go: decision='go' with a failed flow is rejected", () => {
    expect(
      validateVisualQaReport(
        report({
          flows: [flow({ flow: "client-anonymous", decision: "no-go" })],
          decision: "go",
        }),
      ),
    ).toMatch(/decision='go' requires all flows green/);
  });

  it("R-decision-go: decision='go' with an error-severity violation is rejected", () => {
    expect(
      validateVisualQaReport(
        report({
          violations: [violation()], // severity=error default
          decision: "go",
        }),
      ),
    ).toMatch(/decision='go' requires all flows green/);
  });

  it("R-decision-go: decision='go' WITH a warn-severity violation is OK", () => {
    expect(
      validateVisualQaReport(
        report({
          violations: [
            violation({
              severity: "warn",
              rule: "selector-flaky",
              message: "fell back to getByText because no data-testid declared",
              recommendedFix: "add data-testid; tracked by PENDING_V3_DECISIONS.md D2",
            }),
          ],
          decision: "go",
        }),
      ),
    ).toBeNull();
  });

  it("R-decision-no-go: decision='no-go' without evidence is rejected", () => {
    expect(
      validateVisualQaReport(
        report({
          flows: [flow({ decision: "go" })],
          steps: [step()],
          violations: [],
          decision: "no-go",
        }),
      ),
    ).toMatch(/decision='no-go' requires at least one no-go flow/);
  });

  it("R-critical: a critical violation FORCES decision='no-go'", () => {
    expect(
      validateVisualQaReport(
        report({
          flows: [flow({ decision: "go" })],
          steps: [step()],
          violations: [
            violation({
              rule: "app-boot-terminal-failure",
              severity: "critical",
              agent: "bootstrap-devops",
              message: "App failed to boot after 3 fix-loop rounds. Human intervention required.",
              recommendedFix:
                "Investigate Docker / Postgres / migrations manually. See skills/runtime-diagnostics.",
            }),
          ],
          decision: "go", // contradicted by the critical
        }),
      ),
    ).toMatch(/critical-severity violation forces decision='no-go'/);
  });

  it("R-critical: critical violation with decision='no-go' is accepted", () => {
    expect(
      validateVisualQaReport(
        report({
          flows: [flow({ decision: "no-go" })],
          steps: [step({ status: "failed", failureMessage: "boot timeout" })],
          violations: [
            violation({
              rule: "app-boot-terminal-failure",
              severity: "critical",
              agent: "bootstrap-devops",
              message: "App failed to boot after 3 fix-loop rounds. Human intervention required.",
              recommendedFix: "Investigate Docker / Postgres / migrations manually.",
            }),
          ],
          decision: "no-go",
        }),
      ),
    ).toBeNull();
  });
});

describe("visualQaReportSchema — sanity", () => {
  it("rejects rule names that aren't kebab-case", () => {
    expect(
      validateVisualQaReport(
        report({
          violations: [violation({ rule: "HydrationMismatch" })],
          decision: "no-go",
          flows: [flow({ decision: "no-go" })],
          steps: [step({ status: "failed", failureMessage: "x" })],
        }),
      ),
    ).toMatch(/rule must be a kebab-case fault id/);
  });

  it("rejects screenshots paths outside .atelier/screenshots/", () => {
    expect(
      validateVisualQaReport(
        report({
          screenshots: [
            {
              stepName: "home",
              path: "tmp/home.png" as unknown as `.atelier/screenshots/${string}.png`,
              capturedAt: "2026-05-13T22:00:00.000Z",
              url: "http://localhost:3000/",
            },
          ],
        }),
      ),
    ).toMatch(/path/);
  });

  it("rejects playwrightScriptPath that doesn't live under .atelier/", () => {
    expect(
      validateVisualQaReport(
        report({
          playwrightScriptPath: "tests/visual.spec.ts" as never,
        }),
      ),
    ).toMatch(/playwrightScriptPath/);
  });
});
