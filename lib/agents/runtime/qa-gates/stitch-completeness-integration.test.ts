/**
 * Golden-file integration test for stitch-completeness-scanner.
 *
 * Uses the ACTUAL test-id-contract.json that the Layout Architect LLM
 * produced in the F3 first-real-run (workDir
 * `out/yoga-regen-v3-2026-05-14T10-32-24/`). That contract had all
 * critical selectors declared as `requiredOn.component` — which the
 * pre-rework scanner silently skipped (B1 of the F3 triage). After the
 * rework:
 *
 *   - The scanner now emits a single warn-summary listing the deferred
 *     selectors instead of staying silent.
 *   - The scanner verifies a pageRoute-based critical we inject for
 *     /sign-in (matching what the post-rework layout-architect prompt
 *     R5 instructs the LLM to emit), and fires when its target page
 *     lacks a <form>.
 *
 * This test exists to prove that the silent-skip path is dead. If a
 * future change accidentally restores it, this test goes red.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  scanStitchCompleteness,
  type TestIdContractLike,
  type LayoutTreeLike,
  type StitchAnalysisLike,
} from "./stitch-completeness-scanner";

// ─── F3 golden contract — verbatim shape the LLM produced ───────────
//
// Only the keys the scanner reads. consumedByFlow / purpose stripped
// for brevity. ALL entries use requiredOn.component — exactly the
// shape that caused B1 in F3.

const F3_GOLDEN_CONTRACT: TestIdContractLike = {
  entries: [
    { selector: "header-root", criticality: "critical", requiredOn: { component: "AppHeader" } },
    { selector: "nav-primary", criticality: "critical", requiredOn: { component: "NavPrimary" } },
    { selector: "signin-form", criticality: "critical", requiredOn: { component: "SignInForm" } },
    { selector: "signup-form", criticality: "critical", requiredOn: { component: "SignUpForm" } },
    { selector: "signout-button", criticality: "critical", requiredOn: { component: "SignOutButton" } },
    { selector: "admin-create-class", criticality: "critical", requiredOn: { component: "AdminCreateButton" } },
    { selector: "admin-create-membership", criticality: "critical", requiredOn: { component: "AdminCreateButton" } },
    { selector: "public-list-root", criticality: "critical", requiredOn: { component: "ClassesList" } },
    { selector: "reservation-button", criticality: "critical", requiredOn: { component: "ReservationButton" } },
    // recommended/optional — never block, never deferred-warned.
    { selector: "hero-cta", criticality: "recommended", requiredOn: { component: "HomeHero" } },
    { selector: "my-agenda-root", criticality: "recommended", requiredOn: { component: "MyAgendaPage" } },
    { selector: "footer-root", criticality: "recommended", requiredOn: { component: "AppFooter" } },
  ],
};

// Synthetic layout-tree + stitch-analysis covering the 8 yoga pages.
// Routes are the architect-emitted ones (post-B3 fix the recorder
// derives these; this test predates the next re-recording).
const YOGA_LAYOUT_TREE: LayoutTreeLike = {
  pages: [
    { pageRoute: "/", layoutGroup: "public" },
    { pageRoute: "/classes", layoutGroup: "public" },
    { pageRoute: "/classes/[id]", layoutGroup: "public" },
    { pageRoute: "/sign-in", layoutGroup: "standalone" },
    { pageRoute: "/sign-up", layoutGroup: "standalone" },
    { pageRoute: "/my/agenda", layoutGroup: "dashboard" },
    { pageRoute: "/admin/classes", layoutGroup: "admin" },
    { pageRoute: "/admin/memberships", layoutGroup: "admin" },
  ],
};

const YOGA_STITCH_ANALYSIS: StitchAnalysisLike = {
  stitchAttempt: 0,
  stitchHealth: "clean",
  pages: [
    { pageRoute: "/", rawHtmlPath: ".atelier/stitch-html/home.html" },
    { pageRoute: "/classes", rawHtmlPath: ".atelier/stitch-html/classes.html" },
    { pageRoute: "/classes/[id]", rawHtmlPath: ".atelier/stitch-html/classes-id.html" },
    { pageRoute: "/sign-in", rawHtmlPath: ".atelier/stitch-html/sign-in.html" },
    { pageRoute: "/sign-up", rawHtmlPath: ".atelier/stitch-html/sign-up.html" },
    { pageRoute: "/my/agenda", rawHtmlPath: ".atelier/stitch-html/my-agenda.html" },
    { pageRoute: "/admin/classes", rawHtmlPath: ".atelier/stitch-html/admin-classes.html" },
    { pageRoute: "/admin/memberships", rawHtmlPath: ".atelier/stitch-html/admin-memberships.html" },
  ],
};

// Placeholder rich enough to satisfy minimum-sections check for every
// layoutGroup: public (header + main), dashboard (nav + main), admin
// (nav + main + action button), standalone (non-empty body).
const PLACEHOLDER_HTML = `
<!doctype html>
<html><body>
  <header><nav><a href="/">Home</a></nav></header>
  <main>
    <section><h1>placeholder</h1></section>
    <button>placeholder action</button>
  </main>
</body></html>
`;

function setupGoldenWorkdir(): string {
  const root = mkdtempSync(join(tmpdir(), "f3-golden-"));
  for (const page of YOGA_STITCH_ANALYSIS.pages) {
    if (!page.rawHtmlPath) continue;
    const abs = join(root, page.rawHtmlPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, PLACEHOLDER_HTML, "utf8");
  }
  return root;
}

// ─── The point of this test file ────────────────────────────────────

describe("stitch-completeness-scanner — F3 golden integration (B1 closure proof)", () => {
  it("with the F3 golden contract (all criticals = component), emits the warn-summary instead of silent-skipping", async () => {
    const workDir = setupGoldenWorkdir();
    try {
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: YOGA_LAYOUT_TREE,
        stitchAnalysis: YOGA_STITCH_ANALYSIS,
        testIdContract: F3_GOLDEN_CONTRACT,
      });

      // ── The proof that silent-skip is dead ──
      const deferred = report.violations.find(
        (v) => v.rule === "stitch-completeness-component-deferred",
      );
      expect(deferred).toBeDefined();
      expect(deferred?.severity).toBe("warn");

      // The warn-summary names ALL nine critical component selectors
      // (recommended ones — hero-cta, my-agenda-root, footer-root — are
      // never in the deferred list because they're not critical).
      const criticalDeferredSelectors = [
        "header-root", "nav-primary", "signin-form", "signup-form",
        "signout-button", "admin-create-class", "admin-create-membership",
        "public-list-root", "reservation-button",
      ];
      for (const sel of criticalDeferredSelectors) {
        expect(deferred?.message).toContain(sel);
      }
      // Recommended entries (component-scoped, but not critical) are NOT
      // in the deferred list — the warn-summary only flags critical entries.
      expect(deferred?.message).not.toContain("hero-cta");

      // No error-level violations — because every critical was component-scoped,
      // the scanner has nothing to verify against the HTML directly.
      // (That's exactly the failure mode B1 documented as "tests verdes,
      // realidad rota". The pre-rework scanner produced this same outcome
      // SILENTLY; post-rework it surfaces the deferral.)
      const errors = report.violations.filter((v) => v.severity === "error");
      expect(errors).toEqual([]);
    } finally {
      if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("replacing signin-form's requiredOn from component to pageRoute makes it verifiable — proves the new variant works on real shape", async () => {
    // Post-rework: layout-architect.md R5 instructs the LLM to use
    // pageRoute for selectors local to a single page. This test
    // simulates exactly that change against the F3 golden contract.
    const augmented: TestIdContractLike = {
      entries: F3_GOLDEN_CONTRACT.entries.map((e) =>
        e.selector === "signin-form"
          ? { ...e, requiredOn: { pageRoute: "/sign-in" } }
          : e,
      ),
    };

    // /sign-in HTML lacks a <form> → pageRoute critical must fail.
    const workDir = setupGoldenWorkdir();
    try {
      const signinPath = join(workDir, ".atelier", "stitch-html", "sign-in.html");
      writeFileSync(
        signinPath,
        "<!doctype html><html><body><header><nav>x</nav></header><main><h1>Sign in (form removed)</h1></main></body></html>",
        "utf8",
      );
      const report = await scanStitchCompleteness({
        workDir,
        layoutTree: YOGA_LAYOUT_TREE,
        stitchAnalysis: YOGA_STITCH_ANALYSIS,
        testIdContract: augmented,
      });

      const errors = report.violations.filter(
        (v) =>
          v.rule === "stitch-missing-critical-element" &&
          (v.message?.includes("signin-form") ?? false),
      );
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0]?.message).toContain("/sign-in");
      expect(report.shouldReprompt).toBe(true);
    } finally {
      if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
    }
  });
});
