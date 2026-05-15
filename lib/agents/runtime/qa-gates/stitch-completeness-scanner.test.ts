import { describe, it, expect } from "vitest";

import {
  scanStitchCompleteness,
  type StitchCompletenessOptions,
  type LayoutTreeLike,
  type StitchAnalysisLike,
  type TestIdContractLike,
} from "./stitch-completeness-scanner";

// ─── Fixtures ────────────────────────────────────────────────────────

const PUBLIC_HOME_HTML = `
<!doctype html>
<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Inter"></head>
<body>
  <header class="hero"><nav><a href="/">Home</a><a href="/sign-in">Sign in</a></nav></header>
  <main>
    <section class="hero"><h1>Welcome</h1><a class="cta" href="/shop">Shop now</a></section>
    <section><ul><li>Class A</li><li>Class B</li></ul></section>
  </main>
  <footer>© Atelier</footer>
</body></html>
`;

const SIGNIN_HTML = `
<!doctype html>
<html><body>
  <header><nav><a href="/">Home</a></nav></header>
  <main>
    <form class="signin-form" aria-label="signin">
      <input type="email" />
      <input type="password" />
      <button type="submit">Sign in</button>
    </form>
  </main>
</body></html>
`;

const DASHBOARD_HTML = `
<!doctype html>
<html><body>
  <aside><nav><a href="/dashboard">Overview</a><a href="/my/classes">Classes</a></nav></aside>
  <main>
    <h1>My dashboard</h1>
    <button>Sign out</button>
  </main>
</body></html>
`;

const ADMIN_CLASSES_HTML = `
<!doctype html>
<html><body>
  <aside><nav><a href="/admin/classes">Classes</a></nav></aside>
  <main>
    <h1>Classes</h1>
    <button>Create new class</button>
    <button>Sign out</button>
    <table><tr><th>Name</th></tr></table>
  </main>
</body></html>
`;

// HTML missing a critical layoutGroup-based element (no <nav>).
const HOME_HTML_MISSING_NAV = `
<!doctype html>
<html><body>
  <header><h1>Atelier</h1></header>
  <main><section><h2>Welcome</h2><p>Hello.</p></section></main>
</body></html>
`;

// HTML that's a thin "stub" — public page without main/section.
const THIN_PUBLIC_HTML = `<html><body><div>Coming soon</div></body></html>`;

// Common artifacts
const LAYOUT_TREE: LayoutTreeLike = {
  pages: [
    { pageRoute: "/", layoutGroup: "public" },
    { pageRoute: "/sign-in", layoutGroup: "public" },
    { pageRoute: "/dashboard", layoutGroup: "dashboard" },
    { pageRoute: "/admin/classes", layoutGroup: "admin" },
  ],
  layoutCompositions: {
    public: { slots: ["header", "main", "footer"] },
    dashboard: { slots: ["header", "main"] },
    admin: { slots: ["header", "sidebar", "main", "breadcrumbs"] },
  },
};

const STITCH_ANALYSIS_OK: StitchAnalysisLike = {
  stitchAttempt: 0,
  stitchHealth: "clean",
  pages: [
    { pageRoute: "/", rawHtmlPath: ".atelier/stitch-html/home.html" },
    { pageRoute: "/sign-in", rawHtmlPath: ".atelier/stitch-html/sign-in.html" },
    { pageRoute: "/dashboard", rawHtmlPath: ".atelier/stitch-html/dashboard.html" },
    { pageRoute: "/admin/classes", rawHtmlPath: ".atelier/stitch-html/admin-classes.html" },
  ],
};

const TEST_ID_CONTRACT: TestIdContractLike = {
  entries: [
    // layoutGroup-based criticals: must appear on EVERY page of that group.
    { selector: "header-root", criticality: "critical", requiredOn: { layoutGroup: "public" } },
    { selector: "nav-primary", criticality: "critical", requiredOn: { layoutGroup: "public" } },
    { selector: "signout-button", criticality: "critical", requiredOn: { layoutGroup: "dashboard" } },
    { selector: "signout-button-admin", criticality: "critical", requiredOn: { layoutGroup: "admin" } },
    // pageRoute-based critical (new variant in three-variant model).
    { selector: "signin-form", criticality: "critical", requiredOn: { pageRoute: "/sign-in" } },
    // component-based critical — deferred to wave-4 with warn-summary,
    // NOT silently skipped (closes B1 of F3 triage).
    { selector: "admin-create-class", criticality: "critical", requiredOn: { component: "AdminCreateButton" } },
    // Recommended (any variant) — never blocks, never warned about.
    { selector: "public-list-root", criticality: "recommended", requiredOn: { layoutGroup: "public" } },
  ],
};

// existsSync uses the real FS — we need actual files for the "happy path"
// tests. The simplest way without mocking node:fs is to drop fixtures into a
// real temp dir. For these scanner tests we use vitest's tmp facility.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setupTmpWorkDir(htmlByPath: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "scanner-test-"));
  for (const [rel, content] of Object.entries(htmlByPath)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

// ─── Positive: clean run on coherent artifacts ──────────────────────

describe("scanStitchCompleteness — positive", () => {
  it("emits no ERROR violations + shouldReprompt=false when all 4 pages are complete (component-deferred warn is acceptable)", async () => {
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: TEST_ID_CONTRACT,
      });
      // No error-severity violations — all required selectors present.
      expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
      expect(report.pageFailures).toEqual([]);
      expect(report.shouldReprompt).toBe(false);
      // But the component-deferred warn-summary IS expected (admin-create-class).
      const summary = report.violations.find(
        (v) => v.rule === "stitch-completeness-component-deferred",
      );
      expect(summary?.severity).toBe("warn");
      expect(summary?.message).toContain("admin-create-class");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

// ─── Check 1: missing rawHtmlPath / missing file ────────────────────

describe("scanStitchCompleteness — check 1: missing HTML", () => {
  it("emits stitch-missing-page when layout-tree page has no entry in stitch-analysis", async () => {
    const workDir = setupTmpWorkDir({});
    try {
      const sa: StitchAnalysisLike = {
        stitchAttempt: 0,
        stitchHealth: "clean",
        pages: [
          { pageRoute: "/", rawHtmlPath: ".atelier/stitch-html/home.html" },
          // /sign-in, /dashboard, /admin/classes all missing
        ],
      };
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: sa,
        testIdContract: TEST_ID_CONTRACT,
      });
      expect(report.violations.filter((v) => v.rule === "stitch-missing-page")).toHaveLength(4);
      // The "/" page also fires because its file doesn't exist either
      expect(report.pageFailures.map((f) => f.pageRoute).sort()).toEqual(
        ["/", "/admin/classes", "/dashboard", "/sign-in"],
      );
      expect(report.shouldReprompt).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("emits stitch-missing-page when rawHtmlPath is declared but file is missing on disk", async () => {
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      // sign-in.html intentionally not written
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: TEST_ID_CONTRACT,
      });
      const missing = report.violations.filter((v) => v.rule === "stitch-missing-page");
      expect(missing).toHaveLength(1);
      expect(missing[0]?.message).toContain("sign-in.html");
      expect(report.pageFailures.find((f) => f.pageRoute === "/sign-in")?.missingHtml).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

// ─── Check 2: critical test-id has no expected element ──────────────

describe("scanStitchCompleteness — check 2: missing critical elements", () => {
  it("emits stitch-missing-critical-element when nav-primary has no <nav> in the page HTML", async () => {
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": HOME_HTML_MISSING_NAV,
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: TEST_ID_CONTRACT,
      });
      const missingEl = report.violations.filter((v) => v.rule === "stitch-missing-critical-element");
      const navFailures = missingEl.filter((v) => v.message?.includes("nav-primary") ?? false);
      expect(navFailures.length).toBeGreaterThanOrEqual(1);
      const failureForHome = report.pageFailures.find((f) => f.pageRoute === "/");
      expect(failureForHome?.missingCriticalElements).toContain("nav-primary");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("recommended selectors do NOT trigger violations even when missing", async () => {
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": "<html><body><header><nav>x</nav></header><main><h1>x</h1></main></body></html>",
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: TEST_ID_CONTRACT,
      });
      // public-list-root is RECOMMENDED, not critical — should NOT produce
      // a violation even though the trimmed home has no <ul>/<table>.
      expect(
        report.violations.find((v) =>
          v.rule === "stitch-missing-critical-element" &&
          (v.message?.includes("public-list-root") ?? false),
        ),
      ).toBeUndefined();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

// ─── Check 3: minimum sections per layoutGroup ──────────────────────

describe("scanStitchCompleteness — check 3: thin sections", () => {
  it("emits stitch-thin-section when a public page has no header/main", async () => {
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": THIN_PUBLIC_HTML,
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: TEST_ID_CONTRACT,
      });
      const thin = report.violations.filter((v) => v.rule === "stitch-thin-section");
      expect(thin.some((v) => v.message?.includes("/") ?? false)).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  // ─── B13 — per-layoutGroup chrome flexibility ────────────────────
  //
  // F3-run-6 surfaced 5 false positives: Stitch renders admin/dashboard
  // pages with navigation embedded INSIDE the <header>, not as a sibling
  // <nav>/<aside>. The previous heuristic demanded a sibling nav, so
  // pages with header+main+buttons were flagged "thin". These tests use
  // the exact HTML shapes from out/yoga-regen-v3-2026-05-15T08-57-06 as
  // golden — same structure, fewer attributes, same conclusion.
  //
  // Contract under test:
  //   - admin + dashboard: chrome = (<header> OR <nav>/<aside>) + <main>
  //   - public: keeps strict header + content (unchanged)
  //   - empty/chromeless pages of any group still fail

  const F3_ADMIN_HTML_HEADER_NAV_EMBEDDED = `
    <!doctype html>
    <html><body>
      <header>
        <a href="/">Logo</a>
        <a href="/admin/classes">Classes</a>
        <button>Sign out</button>
      </header>
      <main>
        <h1>Classes</h1>
        <section><table><tr><th>Name</th></tr></table></section>
        <button>Create class</button>
      </main>
    </body></html>
  `;

  const F3_DASHBOARD_HTML_HEADER_NAV_EMBEDDED = `
    <!doctype html>
    <html><body>
      <header>
        <a href="/">Logo</a>
        <a href="/my/membership">Membership</a>
        <button>Sign out</button>
      </header>
      <main>
        <h1>My membership</h1>
        <ul><li>Plan: Monthly</li></ul>
      </main>
    </body></html>
  `;

  const F3_ADMIN_TEST_ID_CONTRACT: TestIdContractLike = {
    entries: [
      // Minimal — keep only what these pages actually need + 1 deferred so
      // the test doesn't co-fire with check 2 noise. signout-button is the
      // sole layoutGroup critical and both pages have a Sign out button.
      { selector: "signout-button", criticality: "critical", requiredOn: { layoutGroup: "dashboard" } },
      { selector: "signout-button-admin", criticality: "critical", requiredOn: { layoutGroup: "admin" } },
    ],
  };

  const F3_LAYOUT_TREE: LayoutTreeLike = {
    pages: [
      { pageRoute: "/admin/classes", layoutGroup: "admin" },
      { pageRoute: "/my/membership", layoutGroup: "dashboard" },
    ],
    layoutCompositions: {
      dashboard: { slots: ["header", "main"] },
      admin: { slots: ["header", "main"] },
    },
  };

  const F3_STITCH_ANALYSIS: StitchAnalysisLike = {
    stitchAttempt: 0,
    stitchHealth: "clean",
    pages: [
      { pageRoute: "/admin/classes", rawHtmlPath: ".atelier/stitch-html/admin-classes.html" },
      { pageRoute: "/my/membership", rawHtmlPath: ".atelier/stitch-html/my-membership.html" },
    ],
  };

  it("admin pages with header-embedded nav (no sibling <nav>) are NOT thin — B13 golden from F3-run-6", async () => {
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/admin-classes.html": F3_ADMIN_HTML_HEADER_NAV_EMBEDDED,
      ".atelier/stitch-html/my-membership.html": F3_DASHBOARD_HTML_HEADER_NAV_EMBEDDED,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: F3_LAYOUT_TREE,
        stitchAnalysis: F3_STITCH_ANALYSIS,
        testIdContract: F3_ADMIN_TEST_ID_CONTRACT,
      });
      const thin = report.violations.filter((v) => v.rule === "stitch-thin-section");
      // Pre-B13 this returned 2 violations (one per page). Post-B13: 0.
      expect(thin).toHaveLength(0);
      expect(report.pageFailures.filter((f) => f.thinSections)).toEqual([]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("admin pages with NEITHER header NOR nav DO fail (regression guard — escalada honesta sigue activa)", async () => {
    const chromelessHtml = `<html><body><main><h1>Admin</h1><button>Save</button></main></body></html>`;
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/admin-classes.html": chromelessHtml,
      ".atelier/stitch-html/my-membership.html": chromelessHtml,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: F3_LAYOUT_TREE,
        stitchAnalysis: F3_STITCH_ANALYSIS,
        testIdContract: F3_ADMIN_TEST_ID_CONTRACT,
      });
      const thin = report.violations.filter((v) => v.rule === "stitch-thin-section");
      // Both admin and dashboard demand chrome. No header AND no nav → thin.
      expect(thin).toHaveLength(2);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("public pages still need header explicitly (regression guard — no permisividad indebida)", async () => {
    const navOnlyPublicHtml = `<html><body><nav><a href="/">x</a></nav><main><h1>x</h1></main></body></html>`;
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": navOnlyPublicHtml,
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: TEST_ID_CONTRACT,
      });
      const thinForHome = report.violations.find(
        (v) => v.rule === "stitch-thin-section" && (v.message?.includes("'/'") ?? false),
      );
      expect(thinForHome).toBeDefined();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

// ─── Reprompt budget ───────────────────────────────────────────────

describe("scanStitchCompleteness — reprompt budget", () => {
  it("shouldReprompt=true when failures exist and attempt < 2", async () => {
    const workDir = setupTmpWorkDir({});
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: { ...STITCH_ANALYSIS_OK, stitchAttempt: 1, pages: [] },
        testIdContract: TEST_ID_CONTRACT,
      });
      expect(report.shouldReprompt).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("shouldReprompt=false when failures exist but attempt has reached 2 (plan B kicks in)", async () => {
    const workDir = setupTmpWorkDir({});
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: { ...STITCH_ANALYSIS_OK, stitchAttempt: 2, pages: [] },
        testIdContract: TEST_ID_CONTRACT,
      });
      expect(report.shouldReprompt).toBe(false);
      // violations still emitted; orchestrator's plan B reads them
      expect(report.violations.length).toBeGreaterThan(0);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

// ─── Three-variant model: layoutGroup vs pageRoute vs component ────

describe("scanStitchCompleteness — three-variant requiredOn model (B1 closure)", () => {
  /**
   * Custom HTML that misses the <form> on /sign-in. Used to verify that
   * a pageRoute-based critical IS verified (vs the old behaviour where
   * component-based criticals were silently skipped).
   */
  const SIGNIN_HTML_NO_FORM = `
    <!doctype html>
    <html><body>
      <header><nav><a href="/">Home</a></nav></header>
      <main><h1>Sign in</h1><p>Form is broken in this fixture for testing.</p></main>
    </body></html>
  `;

  it("pageRoute-based critical is verified and FAILS when the target page lacks the expected element", async () => {
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML_NO_FORM,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: TEST_ID_CONTRACT,
      });
      // signin-form is declared with pageRoute=/sign-in. The HTML lacks
      // a <form> there → the scanner MUST emit the missing-critical
      // violation. This is the key behavior that B1 had broken.
      const signinFormFailures = report.violations.filter(
        (v) =>
          v.rule === "stitch-missing-critical-element" &&
          (v.message?.includes("signin-form") ?? false),
      );
      expect(signinFormFailures.length).toBeGreaterThanOrEqual(1);
      expect(signinFormFailures[0]?.message).toContain("/sign-in");
      // Reprompt should trigger since pageFailures exist + attempt < 2.
      expect(report.shouldReprompt).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("pageRoute-based critical PASSES when the target page has the expected element", async () => {
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML, // has <form>
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: TEST_ID_CONTRACT,
      });
      const signinFormFailures = report.violations.filter(
        (v) =>
          v.rule === "stitch-missing-critical-element" &&
          (v.message?.includes("signin-form") ?? false),
      );
      expect(signinFormFailures).toEqual([]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("component-based critical is NOT silently skipped — emits the warn-summary violation", async () => {
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: TEST_ID_CONTRACT,
      });
      const deferred = report.violations.find(
        (v) => v.rule === "stitch-completeness-component-deferred",
      );
      expect(deferred).toBeDefined();
      expect(deferred?.severity).toBe("warn"); // visible, not blocking
      expect(deferred?.agent).toBe("layout-architect");
      expect(deferred?.message).toMatch(/admin-create-class/);
      expect(deferred?.recommendedFix).toMatch(/pageRoute/);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("warn-summary is SINGLE per scan, not one per deferred entry (noise control)", async () => {
    const contractWithManyComponentEntries: TestIdContractLike = {
      entries: [
        { selector: "header-root", criticality: "critical", requiredOn: { layoutGroup: "public" } },
        { selector: "nav-primary", criticality: "critical", requiredOn: { layoutGroup: "public" } },
        // 5 component-deferred criticals — should yield ONE warn-summary.
        { selector: "x-1", criticality: "critical", requiredOn: { component: "X1" } },
        { selector: "x-2", criticality: "critical", requiredOn: { component: "X2" } },
        { selector: "x-3", criticality: "critical", requiredOn: { component: "X3" } },
        { selector: "x-4", criticality: "critical", requiredOn: { component: "X4" } },
        { selector: "x-5", criticality: "critical", requiredOn: { component: "X5" } },
      ],
    };
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: contractWithManyComponentEntries,
      });
      const deferredViolations = report.violations.filter(
        (v) => v.rule === "stitch-completeness-component-deferred",
      );
      expect(deferredViolations).toHaveLength(1);
      // The single message lists all five selectors.
      const msg = deferredViolations[0]?.message ?? "";
      for (const sel of ["x-1", "x-2", "x-3", "x-4", "x-5"]) {
        expect(msg).toContain(sel);
      }
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("pageRoute-scoped form selector accepts any <form> on the page — relaxed heuristic (B9)", async () => {
    // HTML for /sign-in with a <form> that does NOT match the keyword
    // heuristic (no signin/login/auth in class/id/aria/text). The
    // strict matcher would reject; relaxed matcher accepts because
    // the entry is pageRoute-scoped and the page identity is implicit.
    const signinWithCreativeFormClass = `
      <!doctype html>
      <html><body>
        <header><nav>x</nav></header>
        <main>
          <form class="centered-card neutral-form">
            <input type="email" />
            <input type="password" />
            <button>Continuar</button>
          </form>
        </main>
      </body></html>
    `;
    const pageRouteScopedContract: TestIdContractLike = {
      entries: [
        { selector: "header-root", criticality: "critical", requiredOn: { layoutGroup: "public" } },
        { selector: "nav-primary", criticality: "critical", requiredOn: { layoutGroup: "public" } },
        // pageRoute scope → relaxed matcher accepts any <form>.
        { selector: "signin-form", criticality: "critical", requiredOn: { pageRoute: "/sign-in" } },
      ],
    };
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      ".atelier/stitch-html/sign-in.html": signinWithCreativeFormClass,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: pageRouteScopedContract,
      });
      const signinFormFailures = report.violations.filter(
        (v) =>
          v.rule === "stitch-missing-critical-element" &&
          (v.message?.includes("signin-form") ?? false),
      );
      // Strict matcher would have flagged; relaxed accepts.
      expect(signinFormFailures).toEqual([]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("layoutGroup-scoped form selector STILL uses strict matcher (relaxation does not apply)", async () => {
    // A signin-form-like selector with requiredOn.layoutGroup applies to
    // many pages — disambiguation requires keyword matching. Verify the
    // strict matcher still trips when the form lacks identifying hints.
    const SIGNIN_HTML_NO_FORM_KEYWORDS = `
      <!doctype html><html><body>
        <header><nav>x</nav></header>
        <main>
          <form class="generic-form">
            <input/><input/><button>X</button>
          </form>
        </main>
      </body></html>
    `;
    const layoutGroupScopedContract: TestIdContractLike = {
      entries: [
        { selector: "header-root", criticality: "critical", requiredOn: { layoutGroup: "public" } },
        { selector: "nav-primary", criticality: "critical", requiredOn: { layoutGroup: "public" } },
        // layoutGroup → strict matcher applies even though the page
        // happens to have a <form>. Strict needs keyword hints.
        { selector: "signin-form", criticality: "critical", requiredOn: { layoutGroup: "public" } },
      ],
    };
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML, // no form at all
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML_NO_FORM_KEYWORDS,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: layoutGroupScopedContract,
      });
      // The home is public and has NO form → strict matcher reports it.
      const signinFormFailures = report.violations.filter(
        (v) =>
          v.rule === "stitch-missing-critical-element" &&
          (v.message?.includes("signin-form") ?? false),
      );
      expect(signinFormFailures.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("zero component-deferred criticals → no warn-summary", async () => {
    const pureContract: TestIdContractLike = {
      entries: [
        { selector: "header-root", criticality: "critical", requiredOn: { layoutGroup: "public" } },
        { selector: "nav-primary", criticality: "critical", requiredOn: { layoutGroup: "public" } },
        { selector: "signin-form", criticality: "critical", requiredOn: { pageRoute: "/sign-in" } },
      ],
    };
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: pureContract,
      });
      expect(
        report.violations.find((v) => v.rule === "stitch-completeness-component-deferred"),
      ).toBeUndefined();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

// ─── Check 4: layoutCompositions slot coverage (B10) ───────────────

describe("scanStitchCompleteness — check 4: layout-composition slot coverage (B10)", () => {
  it("passes when every used layoutGroup declares header + main", async () => {
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE, // declares header+main for public, dashboard, admin
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: TEST_ID_CONTRACT,
      });
      expect(
        report.violations.find((v) => v.rule === "stitch-missing-layout-slot"),
      ).toBeUndefined();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("flags missing header slot in dashboard composition", async () => {
    const ltMissingHeader: LayoutTreeLike = {
      pages: [
        { pageRoute: "/", layoutGroup: "public" },
        { pageRoute: "/dashboard", layoutGroup: "dashboard" },
      ],
      layoutCompositions: {
        public: { slots: ["header", "main"] },
        dashboard: { slots: ["main", "footer"] }, // <-- no header
      },
    };
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: ltMissingHeader,
        stitchAnalysis: {
          ...STITCH_ANALYSIS_OK,
          pages: [
            { pageRoute: "/", rawHtmlPath: ".atelier/stitch-html/home.html" },
            { pageRoute: "/dashboard", rawHtmlPath: ".atelier/stitch-html/dashboard.html" },
          ],
        },
        testIdContract: TEST_ID_CONTRACT,
      });
      const slotViolations = report.violations.filter(
        (v) => v.rule === "stitch-missing-layout-slot",
      );
      expect(slotViolations.length).toBeGreaterThanOrEqual(1);
      expect(slotViolations[0]?.severity).toBe("error");
      expect(slotViolations[0]?.message).toContain("dashboard");
      expect(slotViolations[0]?.message).toContain("header");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("flags a missing composition entry entirely (group used by pages but not in layoutCompositions)", async () => {
    const ltMissingAdmin: LayoutTreeLike = {
      pages: [
        { pageRoute: "/", layoutGroup: "public" },
        { pageRoute: "/admin/classes", layoutGroup: "admin" },
      ],
      layoutCompositions: {
        public: { slots: ["header", "main"] },
        // admin missing entirely
      },
    };
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: ltMissingAdmin,
        stitchAnalysis: {
          ...STITCH_ANALYSIS_OK,
          pages: [
            { pageRoute: "/", rawHtmlPath: ".atelier/stitch-html/home.html" },
            { pageRoute: "/admin/classes", rawHtmlPath: ".atelier/stitch-html/admin-classes.html" },
          ],
        },
        testIdContract: TEST_ID_CONTRACT,
      });
      const slotViolations = report.violations.filter(
        (v) => v.rule === "stitch-missing-layout-slot",
      );
      expect(slotViolations.length).toBeGreaterThanOrEqual(1);
      expect(slotViolations[0]?.message).toContain("admin");
      expect(slotViolations[0]?.message).toContain("no entry in layoutCompositions");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("does NOT flag groups that have no pages (admin missing fine if no admin pages)", async () => {
    const ltPublicOnly: LayoutTreeLike = {
      pages: [{ pageRoute: "/", layoutGroup: "public" }],
      layoutCompositions: {
        public: { slots: ["header", "main"] },
        // admin not declared, but also no admin pages exist
      },
    };
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: ltPublicOnly,
        stitchAnalysis: {
          ...STITCH_ANALYSIS_OK,
          pages: [{ pageRoute: "/", rawHtmlPath: ".atelier/stitch-html/home.html" }],
        },
        testIdContract: TEST_ID_CONTRACT,
      });
      expect(
        report.violations.find((v) => v.rule === "stitch-missing-layout-slot"),
      ).toBeUndefined();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("standalone-only pages do NOT require a composition (auth pages are chromeless by design)", async () => {
    const ltStandaloneOnly: LayoutTreeLike = {
      pages: [
        { pageRoute: "/sign-in", layoutGroup: "standalone" },
        { pageRoute: "/sign-up", layoutGroup: "standalone" },
      ],
      // no compositions at all — fine because standalone wants none
    };
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML,
      ".atelier/stitch-html/sign-up.html": SIGNIN_HTML,
    });
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: ltStandaloneOnly,
        stitchAnalysis: {
          ...STITCH_ANALYSIS_OK,
          pages: [
            { pageRoute: "/sign-in", rawHtmlPath: ".atelier/stitch-html/sign-in.html" },
            { pageRoute: "/sign-up", rawHtmlPath: ".atelier/stitch-html/sign-up.html" },
          ],
        },
        testIdContract: TEST_ID_CONTRACT,
      });
      expect(
        report.violations.find((v) => v.rule === "stitch-missing-layout-slot"),
      ).toBeUndefined();
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

// ─── Test seam ─────────────────────────────────────────────────────

describe("scanStitchCompleteness — _readFile seam", () => {
  it("uses the injected _readFile when provided", async () => {
    // We still need existsSync to return true → real FS empty file is enough.
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": "<empty>",
      ".atelier/stitch-html/sign-in.html": "<empty>",
      ".atelier/stitch-html/dashboard.html": "<empty>",
      ".atelier/stitch-html/admin-classes.html": "<empty>",
    });
    try {
      let calls = 0;
      const fakeRead: NonNullable<StitchCompletenessOptions["_readFile"]> = async () => {
        calls++;
        return PUBLIC_HOME_HTML;
      };
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: LAYOUT_TREE,
        stitchAnalysis: STITCH_ANALYSIS_OK,
        testIdContract: TEST_ID_CONTRACT,
        _readFile: fakeRead,
      });
      expect(calls).toBe(4); // one read per page
      // every page would be "public-shaped" via the fake, so dashboard+admin
      // pages fail check 2 + 3 — which proves the seam actually fed our HTML.
      expect(report.violations.length).toBeGreaterThan(0);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
