import { describe, it, expect } from "vitest";

import {
  buildDefaultProbes,
  runSmokeProbes,
  toQaViolation,
  type SmokeFetch,
} from "./runtime-smoke-scanner";
import { validateRuntimeSmokeReport } from "../../contracts-v3/runtime-smoke.schema";

// Helper: build a deterministic _fetch stub from a map.
function stubFetch(
  responses: Record<string, { status?: number; throws?: string }>,
  options: { latencyMs?: number } = {},
): SmokeFetch {
  return async (url) => {
    if (options.latencyMs) {
      await new Promise<void>((r) => setTimeout(r, options.latencyMs));
    }
    const path = new URL(url).pathname;
    const r = responses[path];
    if (!r) throw new Error(`stubFetch: no response configured for ${path}`);
    if (r.throws) throw new Error(r.throws);
    return { status: r.status ?? 200 };
  };
}

const ARCHITECT_FIXTURE = {
  features: [
    {
      name: "auth",
      publicRoutes: ["/sign-in", "/sign-up"],
      privateRoutes: ["/profile"],
      adminRoutes: [],
    },
    {
      name: "classes",
      publicRoutes: ["/", "/shop", "/shop/[slug]"],
      privateRoutes: ["/my/classes"],
      adminRoutes: ["/admin/classes"],
    },
  ],
};

// ─── runSmokeProbes ─────────────────────────────────────────────────

describe("runSmokeProbes — happy path", () => {
  it("returns decision=pass when all 5 probes succeed", async () => {
    const probes = buildDefaultProbes(ARCHITECT_FIXTURE);
    const report = await runSmokeProbes({
      appUrl: "http://test.local",
      probes,
      _fetch: stubFetch({
        "/": { status: 200 },
        "/sign-in": { status: 200 },
        "/sign-up": { status: 200 },
        "/profile": { status: 401 },
        "/shop": { status: 200 },
      }),
    });
    expect(validateRuntimeSmokeReport(report)).toBeNull();
    expect(report.decision).toBe("pass");
    expect(report.results.every((r) => r.passed)).toBe(true);
    expect(report.violations).toHaveLength(0);
  });
});

describe("runSmokeProbes — failure modes", () => {
  it("emits home-500 + decision=fail when root returns 500", async () => {
    const probes = buildDefaultProbes(ARCHITECT_FIXTURE);
    const report = await runSmokeProbes({
      appUrl: "http://test.local",
      probes,
      _fetch: stubFetch({
        "/": { status: 500 },
        "/sign-in": { status: 200 },
        "/sign-up": { status: 200 },
        "/profile": { status: 401 },
        "/shop": { status: 200 },
      }),
    });
    expect(report.decision).toBe("fail");
    const home500 = report.violations.find((v) => v.rule === "home-500");
    expect(home500).toBeDefined();
    expect(home500?.agent).toBe("pages-routing");
    expect(home500?.severity).toBe("error");
  });

  it("emits app-not-running (critical) when root throws (ECONNREFUSED-style)", async () => {
    const probes = buildDefaultProbes(ARCHITECT_FIXTURE);
    const report = await runSmokeProbes({
      appUrl: "http://test.local",
      probes,
      _fetch: stubFetch({
        "/": { throws: "fetch failed: ECONNREFUSED" },
        "/sign-in": { status: 200 },
        "/sign-up": { status: 200 },
        "/profile": { status: 401 },
        "/shop": { status: 200 },
      }),
    });
    expect(report.decision).toBe("fail");
    const v = report.violations.find((x) => x.rule === "app-not-running");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("critical");
    expect(v?.agent).toBe("bootstrap-devops");
  });

  it("emits route-not-protected when private route returns 200 unauthed", async () => {
    const probes = buildDefaultProbes(ARCHITECT_FIXTURE);
    const report = await runSmokeProbes({
      appUrl: "http://test.local",
      probes,
      _fetch: stubFetch({
        "/": { status: 200 },
        "/sign-in": { status: 200 },
        "/sign-up": { status: 200 },
        "/profile": { status: 200 }, // BUG: should redirect or 401
        "/shop": { status: 200 },
      }),
    });
    expect(report.decision).toBe("fail");
    const v = report.violations.find((x) => x.rule === "route-not-protected");
    expect(v).toBeDefined();
    expect(v?.agent).toBe("auth-security");
    expect(v?.severity).toBe("error");
  });

  it("emits app-crashed-during-smoke (critical) when probe N>0 throws mid-suite", async () => {
    const probes = buildDefaultProbes(ARCHITECT_FIXTURE);
    const report = await runSmokeProbes({
      appUrl: "http://test.local",
      probes,
      _fetch: stubFetch({
        "/": { status: 200 },
        "/sign-in": { status: 200 },
        "/sign-up": { throws: "fetch failed: connection reset" },
        "/profile": { throws: "fetch failed: connection reset" },
        "/shop": { throws: "fetch failed: connection reset" },
      }),
    });
    expect(report.decision).toBe("fail");
    const crashed = report.violations.find((v) => v.rule === "app-crashed-during-smoke");
    expect(crashed).toBeDefined();
    expect(crashed?.severity).toBe("critical");
  });

  it("emits auth-page-missing when /sign-in returns 404", async () => {
    const probes = buildDefaultProbes(ARCHITECT_FIXTURE);
    const report = await runSmokeProbes({
      appUrl: "http://test.local",
      probes,
      _fetch: stubFetch({
        "/": { status: 200 },
        "/sign-in": { status: 404 },
        "/sign-up": { status: 200 },
        "/profile": { status: 401 },
        "/shop": { status: 200 },
      }),
    });
    const v = report.violations.find((x) => x.rule === "auth-page-missing");
    expect(v).toBeDefined();
    expect(v?.agent).toBe("pages-routing");
  });
});

// ─── buildDefaultProbes ─────────────────────────────────────────────

describe("buildDefaultProbes — inference from architect.json", () => {
  it("produces 5 probes when architect has public + private routes", () => {
    const probes = buildDefaultProbes(ARCHITECT_FIXTURE);
    const ids = probes.map((p) => p.id);
    expect(ids).toEqual([
      "root-ok",
      "sign-in-ok",
      "sign-up-ok",
      "private-redirects",
      "public-list-ok",
    ]);
    expect(probes.find((p) => p.id === "private-redirects")?.path).toBe("/profile");
    expect(probes.find((p) => p.id === "public-list-ok")?.path).toBe("/shop");
  });

  it("falls back to adminRoutes when no privateRoutes", () => {
    const probes = buildDefaultProbes({
      features: [
        {
          name: "admin-only",
          publicRoutes: ["/shop"],
          privateRoutes: [],
          adminRoutes: ["/admin/users"],
        },
      ],
    });
    expect(probes.find((p) => p.id === "private-redirects")?.path).toBe("/admin/users");
  });

  it("returns just the 3 defaults when architect has no routes", () => {
    const probes = buildDefaultProbes({});
    expect(probes.map((p) => p.id)).toEqual(["root-ok", "sign-in-ok", "sign-up-ok"]);
  });

  it("skips dynamic [slug] paths when picking a public listing", () => {
    const probes = buildDefaultProbes({
      features: [
        { name: "x", publicRoutes: ["/shop/[slug]"], privateRoutes: [], adminRoutes: [] },
      ],
    });
    // No usable public list → only 3 defaults
    expect(probes.map((p) => p.id)).toEqual(["root-ok", "sign-in-ok", "sign-up-ok"]);
  });
});

// ─── toQaViolation ──────────────────────────────────────────────────

describe("toQaViolation", () => {
  it("preserves severity warn", () => {
    const out = toQaViolation({
      rule: "probe-slow",
      severity: "warn",
      agent: "api-backend",
      probeId: "root-ok",
      message: "slow probe",
      recommendedFix: "profile the handler",
    });
    expect(out.severity).toBe("warn");
    expect(out.rule).toBe("probe-slow");
    expect(out.agent).toBe("api-backend");
  });

  it("collapses critical → error to match v2/v3 QaViolation enum", () => {
    const out = toQaViolation({
      rule: "app-not-running",
      severity: "critical",
      agent: "bootstrap-devops",
      probeId: "root-ok",
      message: "app dead",
      recommendedFix: "start docker",
    });
    // QaViolationV3 only has "error" | "warn" — critical maps to error so
    // the orchestrator still treats it as fix-loop-worthy. The critical
    // signal is preserved at the runtime-smoke artifact level.
    expect(out.severity).toBe("error");
  });
});
