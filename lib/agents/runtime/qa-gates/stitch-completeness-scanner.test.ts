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

// HTML that misses critical elements (no <form> for signin).
const SIGNIN_HTML_MISSING_FORM = `
<!doctype html>
<html><body>
  <header><nav><a href="/">Home</a></nav></header>
  <main><h1>Sign in</h1><p>Please contact admin.</p></main>
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
    { selector: "header-root", criticality: "critical", requiredOn: { layoutGroup: "public" } },
    { selector: "nav-primary", criticality: "critical", requiredOn: { layoutGroup: "public" } },
    { selector: "signin-form", criticality: "critical", requiredOn: { layoutGroup: "public" } },
    { selector: "signout-button", criticality: "critical", requiredOn: { layoutGroup: "dashboard" } },
    { selector: "signout-button", criticality: "critical", requiredOn: { layoutGroup: "admin" } },
    { selector: "admin-create-class", criticality: "critical", requiredOn: { layoutGroup: "admin" } },
    { selector: "public-list-root", criticality: "recommended", requiredOn: { layoutGroup: "public" } },
  ],
};

function makeReadFile(map: Record<string, string>): (path: string) => Promise<string> {
  return async (path: string) => {
    const key = Object.keys(map).find((k) => path.endsWith(k.replace(/\//g, "\\")) || path.endsWith(k));
    if (key === undefined) throw new Error(`mock _readFile: no fixture for ${path}`);
    const content = map[key];
    if (content === undefined) throw new Error(`mock _readFile: no fixture for ${path}`);
    return content;
  };
}

function makeAllExist(): StitchCompletenessOptions["_readFile"] {
  return makeReadFile({
    ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
    ".atelier/stitch-html/sign-in.html": SIGNIN_HTML,
    ".atelier/stitch-html/dashboard.html": DASHBOARD_HTML,
    ".atelier/stitch-html/admin-classes.html": ADMIN_CLASSES_HTML,
  });
}

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
  it("returns 0 violations + shouldReprompt=false when all 4 pages are complete", async () => {
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
      expect(report.violations).toEqual([]);
      expect(report.pageFailures).toEqual([]);
      expect(report.shouldReprompt).toBe(false);
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
  it("emits stitch-missing-critical-element when signin-form has no <form> in /sign-in HTML", async () => {
    const workDir = setupTmpWorkDir({
      ".atelier/stitch-html/home.html": PUBLIC_HOME_HTML,
      ".atelier/stitch-html/sign-in.html": SIGNIN_HTML_MISSING_FORM,
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
      const signinFormFailures = missingEl.filter((v) => v.message.includes("signin-form"));
      expect(signinFormFailures.length).toBeGreaterThanOrEqual(1);
      const failureForSignIn = report.pageFailures.find((f) => f.pageRoute === "/sign-in");
      expect(failureForSignIn?.missingCriticalElements).toContain("signin-form");
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
          v.rule === "stitch-missing-critical-element" && v.message.includes("public-list-root"),
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
      expect(thin.some((v) => v.message.includes("/"))).toBe(true);
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
