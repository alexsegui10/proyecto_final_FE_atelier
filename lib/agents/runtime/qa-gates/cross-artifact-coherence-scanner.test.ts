import { describe, it, expect } from "vitest";

import { scanCrossArtifactCoherence } from "./cross-artifact-coherence-scanner";

// ─── Fixtures ────────────────────────────────────────────────────────

const ARCHITECT = {
  features: [
    {
      publicRoutes: ["/", "/shop", "/shop/[slug]"],
      privateRoutes: ["/my/profile"],
      adminRoutes: ["/admin/classes"],
    },
  ],
};

const LAYOUT_TREE_OK = {
  pages: [
    { pageRoute: "/" },
    { pageRoute: "/shop" },
    { pageRoute: "/sign-in" }, // implicit auth route allowed
    { pageRoute: "/my/profile" },
    { pageRoute: "/admin/classes" },
  ],
};

const STITCH_OK = {
  pages: [
    { pageRoute: "/" },
    { pageRoute: "/shop" },
  ],
};

const TEST_ID_OK = {
  entries: [
    { selector: "header-root", consumedByFlow: ["client-anonymous"] },
    { selector: "signin-form", consumedByFlow: ["client-anonymous", "client-authenticated"] },
  ],
};

// ─── Positive ───────────────────────────────────────────────────────

describe("scanCrossArtifactCoherence — positive", () => {
  it("returns 0 violations when all 3 artifacts are coherent", () => {
    const v = scanCrossArtifactCoherence({
      architect: ARCHITECT,
      layoutTree: LAYOUT_TREE_OK,
      stitchAnalysis: STITCH_OK,
      testIdContract: TEST_ID_OK,
    });
    expect(v).toEqual([]);
  });

  it("accepts when stitchAnalysis is undefined (early-pipeline state)", () => {
    expect(
      scanCrossArtifactCoherence({ architect: ARCHITECT, layoutTree: LAYOUT_TREE_OK }),
    ).toEqual([]);
  });

  it("accepts implicit auth routes /sign-in /sign-up even if not in architect", () => {
    const v = scanCrossArtifactCoherence({
      architect: { features: [{ publicRoutes: ["/"] }] },
      layoutTree: { pages: [{ pageRoute: "/" }, { pageRoute: "/sign-in" }, { pageRoute: "/sign-up" }] },
    });
    expect(v).toEqual([]);
  });
});

// ─── Test adverso 1: layout-tree-orphan ────────────────────────────

describe("scanCrossArtifactCoherence — adverse case 1: layout-tree page not in architect", () => {
  it("emits layout-tree-orphan routed to architect", () => {
    const v = scanCrossArtifactCoherence({
      architect: ARCHITECT,
      layoutTree: {
        pages: [
          { pageRoute: "/" },
          { pageRoute: "/admin/users" }, // not in architect.adminRoutes
        ],
      },
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("layout-tree-orphan");
    expect(v[0]?.agent).toBe("architect");
    expect(v[0]?.severity).toBe("error");
    expect(v[0]?.message).toContain("/admin/users");
  });

  it("emits multiple violations when multiple pages are orphan", () => {
    const v = scanCrossArtifactCoherence({
      architect: { features: [{ publicRoutes: ["/"] }] },
      layoutTree: {
        pages: [
          { pageRoute: "/" },
          { pageRoute: "/orphan-a" },
          { pageRoute: "/orphan-b" },
        ],
      },
    });
    const rules = v.map((x) => x.rule);
    expect(rules.filter((r) => r === "layout-tree-orphan")).toHaveLength(2);
  });
});

// ─── Test adverso 2: stitch-analysis-orphan ────────────────────────

describe("scanCrossArtifactCoherence — adverse case 2: stitch-analysis page not in layout-tree", () => {
  it("emits stitch-analysis-orphan routed to layout-architect", () => {
    const v = scanCrossArtifactCoherence({
      architect: ARCHITECT,
      layoutTree: LAYOUT_TREE_OK,
      stitchAnalysis: {
        pages: [
          { pageRoute: "/" },
          { pageRoute: "/marketing-landing" }, // not in layout-tree
        ],
      },
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("stitch-analysis-orphan");
    expect(v[0]?.agent).toBe("layout-architect");
    expect(v[0]?.severity).toBe("error");
    expect(v[0]?.message).toContain("/marketing-landing");
  });
});

// ─── Test adverso 3: test-id-invalid-flow ──────────────────────────

describe("scanCrossArtifactCoherence — adverse case 3: test-id contract references unknown flow", () => {
  it("emits test-id-invalid-flow routed to layout-architect", () => {
    const v = scanCrossArtifactCoherence({
      architect: ARCHITECT,
      layoutTree: LAYOUT_TREE_OK,
      testIdContract: {
        entries: [
          {
            selector: "mobile-tab-bar",
            consumedByFlow: ["mobile-app"], // not in VALID_FLOWS
          },
        ],
      },
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.rule).toBe("test-id-invalid-flow");
    expect(v[0]?.agent).toBe("layout-architect");
    expect(v[0]?.severity).toBe("error");
    expect(v[0]?.message).toContain("mobile-app");
  });

  it("emits one violation per invalid flow", () => {
    const v = scanCrossArtifactCoherence({
      architect: ARCHITECT,
      layoutTree: LAYOUT_TREE_OK,
      testIdContract: {
        entries: [
          { selector: "x", consumedByFlow: ["mobile-app", "ios"] },
          { selector: "y", consumedByFlow: ["client-anonymous"] }, // OK
          { selector: "z", consumedByFlow: ["whatever"] },
        ],
      },
    });
    expect(v.filter((x) => x.rule === "test-id-invalid-flow")).toHaveLength(3);
  });
});

// ─── B-w4-5a: malformed artifacts → violation, never throw ──────────

describe("scanCrossArtifactCoherence — defensive (B-w4-5a)", () => {
  it("testIdContract with `selectors` instead of `entries` → violation, not throw", () => {
    // Exact F3-run-10a shape: LLM emitted { selectors: [...] }, so
    // `.entries` is undefined. Old code did `for..of undefined` → throw.
    let v: ReturnType<typeof scanCrossArtifactCoherence> | undefined;
    expect(() => {
      v = scanCrossArtifactCoherence({
        architect: ARCHITECT,
        layoutTree: { pages: [] },
        stitchAnalysis: { pages: [] },
        testIdContract: { selectors: [{ selector: "x" }] },
      });
    }).not.toThrow();
    expect(v!.some((x) => x.rule === "test-id-contract-malformed")).toBe(true);
    expect(v!.find((x) => x.rule === "test-id-contract-malformed")?.severity).toBe("error");
  });

  it("layoutTree.pages / stitchAnalysis.pages not arrays → violations, not throw", () => {
    let v: ReturnType<typeof scanCrossArtifactCoherence> | undefined;
    expect(() => {
      v = scanCrossArtifactCoherence({
        architect: ARCHITECT,
        layoutTree: { pages: "oops" },
        stitchAnalysis: { pages: { wrong: true } },
        testIdContract: { entries: [] },
      });
    }).not.toThrow();
    const rules = new Set(v!.map((x) => x.rule));
    expect(rules).toContain("layout-tree-malformed");
    expect(rules).toContain("stitch-analysis-malformed");
  });
});

// ─── Combined ──────────────────────────────────────────────────────

describe("scanCrossArtifactCoherence — combined failures", () => {
  it("collects violations from all 3 invariants in a single run", () => {
    const v = scanCrossArtifactCoherence({
      architect: ARCHITECT,
      layoutTree: { pages: [{ pageRoute: "/orphan-x" }] },
      stitchAnalysis: { pages: [{ pageRoute: "/orphan-y" }] },
      testIdContract: {
        entries: [{ selector: "x", consumedByFlow: ["nope"] }],
      },
    });
    const rules = new Set(v.map((x) => x.rule));
    expect(rules).toContain("layout-tree-orphan");
    expect(rules).toContain("stitch-analysis-orphan");
    expect(rules).toContain("test-id-invalid-flow");
  });
});
