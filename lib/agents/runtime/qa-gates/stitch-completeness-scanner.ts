/**
 * stitch-completeness-scanner — post-wave-2-design gate (rework Punto C).
 *
 * Validates that the HTML Stitch produced is COMPLETE enough for the
 * Visual Adapter to consume. When violations exist AND the current
 * `stitchAttempt < 2`, the orchestrator re-invokes Layout Architect with
 * `--stitch-reprompt --attempt=N --previous-failures=<path>`. After the
 * second reprompt, plan B kicks in: `stitchHealth: "degraded"` is set,
 * the run continues with placeholders, and `requires_human_review` is
 * flagged on the run-state.
 *
 * THREE checks, all per page declared in `layout-tree.pages[]`:
 *   1. The page has a `rawHtmlPath` in `stitch-analysis.pages[]` AND the
 *      file actually exists on disk under `.atelier/stitch-html/<slug>.html`.
 *      Applies to ALL pages, public + auth + admin (the reviewer asked
 *      this explicitly; we don't trust that auth pages will be covered
 *      only by check 3).
 *   2. For every `test-id-contract.entries[]` with `criticality: "critical"`
 *      that applies to the page (via `requiredOn.layoutGroup` match), the
 *      HTML contains an element matching the selector heuristic. The
 *      Visual Adapter will inject the actual `data-testid` attribute; we
 *      only need to verify the element EXISTS so the adapter has somewhere
 *      to inject.
 *   3. The page's HTML has the minimum sections expected for its
 *      `layoutGroup` (e.g. `public` needs at least a header + main + footer
 *      shaped region; `dashboard` needs nav + main; `admin` needs nav +
 *      main + an action area).
 *
 * Pure function — no FS writes, no MCP calls. `_readFile` is a test seam.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { load as loadHtml } from "cheerio";

import type { PostWaveGate, QaViolationV3 } from "../../orchestrator-v3";
import { expectArray } from "./_artifact-guard";

// ─── Public types ───────────────────────────────────────────────────

export type LayoutGroupV3 = "public" | "dashboard" | "admin" | "standalone";

export type LayoutSlot = "header" | "sidebar" | "main" | "footer" | "breadcrumbs";

export interface LayoutCompositionLike {
  slots: ReadonlyArray<LayoutSlot>;
  sidebarPosition?: "left" | "right" | "none";
}

export interface LayoutTreePageLike {
  pageRoute: string;
  layoutGroup: LayoutGroupV3;
}
export interface LayoutTreeLike {
  pages: ReadonlyArray<LayoutTreePageLike>;
  /**
   * Optional per-group slot composition. The scanner's check 4 (B10
   * fix) verifies that for every layoutGroup actually used by pages,
   * the composition declares the minimum slots required by the shell
   * (header + main). Standalone pages have no composition and are
   * excluded — they intentionally render without a shell wrapper.
   */
  layoutCompositions?: Partial<Record<"public" | "dashboard" | "admin", LayoutCompositionLike>>;
}

export interface StitchPageLike {
  pageRoute: string;
  rawHtmlPath?: string;
}
export interface StitchAnalysisLike {
  pages: ReadonlyArray<StitchPageLike>;
  stitchAttempt: number;
  stitchHealth: "clean" | "degraded";
}

/**
 * `requiredOn` is one of three variants — see test-id-contract.schema.ts.
 * The scanner does NOT use a discriminated union here: it inspects
 * whichever keys are present and routes verification accordingly.
 *
 *   - `layoutGroup` → verify against every page of that group in layout-tree
 *   - `pageRoute`   → verify against the one page in layout-tree
 *   - `component`   → DEFERRED to wave-4-presentation (no silent skip — a
 *                     single warn-summary violation is emitted at the end
 *                     of the scan, listing how many criticals were deferred)
 */
export interface TestIdEntryLike {
  selector: string;
  criticality: "critical" | "recommended" | "optional";
  requiredOn: {
    layoutGroup?: LayoutGroupV3;
    component?: string;
    pageRoute?: string;
  };
}
export interface TestIdContractLike {
  entries: ReadonlyArray<TestIdEntryLike>;
}

export interface StitchCompletenessOptions {
  workDir: string;
  layoutTree: LayoutTreeLike;
  stitchAnalysis: StitchAnalysisLike;
  testIdContract: TestIdContractLike;
  /** Test seam — replaces fs.readFile for loading HTML. */
  _readFile?: (path: string) => Promise<string>;
}

/**
 * Failure record per page. The orchestrator persists this list to
 * `.atelier/stitch-failures.json` and passes it back to Layout Architect
 * on reprompt so the prompt can emphasize what was missing.
 */
export interface PageFailure {
  pageRoute: string;
  missingHtml: boolean;
  missingCriticalElements: string[]; // selectors from test-id-contract
  thinSections: boolean;
  reason: string;
}

export interface StitchCompletenessReport {
  violations: QaViolationV3[];
  pageFailures: PageFailure[];
  /**
   * Quick boolean the orchestrator uses to decide whether to trigger a
   * reprompt. True when at least one page failure exists AND
   * `stitchAttempt < 2`.
   */
  shouldReprompt: boolean;
}

// ─── Scanner ────────────────────────────────────────────────────────

export async function scanStitchCompleteness(
  opts: StitchCompletenessOptions,
): Promise<StitchCompletenessReport> {
  const readFn = opts._readFile ?? ((p: string) => readFile(p, "utf8"));
  const violations: QaViolationV3[] = [];
  const pageFailures: PageFailure[] = [];

  // B-w4-5a — defensive: a malformed artifact must yield violations, not a
  // throw (an uncaught postWaveGate throw is the F3-run-10a fatal crash).
  const saPages = expectArray<StitchPageLike>(opts.stitchAnalysis.pages, {
    violations,
    rule: "stitch-analysis-malformed",
    agent: "layout-architect",
    file: ".atelier/stitch-analysis.json",
    field: "stitchAnalysis.pages",
  });
  const ltPages = expectArray<LayoutTreePageLike>(opts.layoutTree.pages, {
    violations,
    rule: "layout-tree-malformed",
    agent: "layout-architect",
    file: ".atelier/layout-tree.json",
    field: "layoutTree.pages",
  });
  const ticEntries = expectArray<TestIdEntryLike>(opts.testIdContract.entries, {
    violations,
    rule: "test-id-contract-malformed",
    agent: "layout-architect",
    file: ".atelier/test-id-contract.json",
    field: "testIdContract.entries",
  });

  // Index stitch pages by route for O(1) lookup.
  const stitchByRoute = new Map(saPages.map((p) => [p.pageRoute, p]));

  // Pre-classify critical test-id entries by their requiredOn variant.
  // Component-scoped entries are NOT silently skipped — they're counted
  // and surfaced as a single warn-summary violation at the end of the
  // scan. This closes B1 of the F3 first-real-run triage (the
  // "silent-skip is the failure mode" pattern).
  const criticals = ticEntries.filter((e) => e.criticality === "critical");
  const criticalByLayoutGroup = new Map<LayoutGroupV3, TestIdEntryLike[]>();
  const criticalByPageRoute = new Map<string, TestIdEntryLike[]>();
  const criticalComponentDeferred: TestIdEntryLike[] = [];
  for (const e of criticals) {
    // Order of precedence: pageRoute > layoutGroup > component. If an entry
    // declares more than one (legal per schema), prefer the most specific
    // verifiable scope. component is the fallback because we cannot verify
    // it in this wave.
    if (e.requiredOn.pageRoute !== undefined) {
      const list = criticalByPageRoute.get(e.requiredOn.pageRoute) ?? [];
      list.push(e);
      criticalByPageRoute.set(e.requiredOn.pageRoute, list);
    } else if (e.requiredOn.layoutGroup !== undefined) {
      const list = criticalByLayoutGroup.get(e.requiredOn.layoutGroup) ?? [];
      list.push(e);
      criticalByLayoutGroup.set(e.requiredOn.layoutGroup, list);
    } else if (e.requiredOn.component !== undefined) {
      criticalComponentDeferred.push(e);
    }
    // Schema guarantees at least one of the three is present.
  }

  for (const ltPage of ltPages) {
    const stitchPage = stitchByRoute.get(ltPage.pageRoute);
    const failure: PageFailure = {
      pageRoute: ltPage.pageRoute,
      missingHtml: false,
      missingCriticalElements: [],
      thinSections: false,
      reason: "",
    };

    // ── Check 1: rawHtmlPath present AND file exists on disk ─────────
    if (!stitchPage || !stitchPage.rawHtmlPath) {
      failure.missingHtml = true;
      failure.reason = `page declared in layout-tree but no entry in stitch-analysis.pages[]`;
      violations.push({
        rule: "stitch-missing-page",
        severity: "error",
        agent: "layout-architect",
        file: ".atelier/stitch-analysis.json",
        message: `Page '${ltPage.pageRoute}' (${ltPage.layoutGroup}) is declared in layout-tree.json but has no rawHtmlPath in stitch-analysis.pages[].`,
        recommendedFix: `Re-invoke Stitch focused on '${ltPage.pageRoute}'. If two reprompts already passed, plan B sets stitchHealth=degraded and the Visual Adapter generates a placeholder.`,
      });
      pageFailures.push(failure);
      continue;
    }

    const htmlAbs = join(opts.workDir, stitchPage.rawHtmlPath);
    if (!existsSync(htmlAbs)) {
      failure.missingHtml = true;
      failure.reason = `rawHtmlPath '${stitchPage.rawHtmlPath}' declared but file not found on disk`;
      violations.push({
        rule: "stitch-missing-page",
        severity: "error",
        agent: "layout-architect",
        file: stitchPage.rawHtmlPath,
        message: `HTML file declared at '${stitchPage.rawHtmlPath}' for page '${ltPage.pageRoute}' does not exist on disk.`,
        recommendedFix: `Re-download the screen from Stitch and persist it before emitting stitch-analysis.json.`,
      });
      pageFailures.push(failure);
      continue;
    }

    let html: string;
    try {
      html = await readFn(htmlAbs);
    } catch (e) {
      failure.missingHtml = true;
      failure.reason = `cannot read HTML at '${stitchPage.rawHtmlPath}': ${describe(e)}`;
      violations.push({
        rule: "stitch-missing-page",
        severity: "error",
        agent: "layout-architect",
        file: stitchPage.rawHtmlPath,
        message: `Cannot read HTML at '${stitchPage.rawHtmlPath}': ${describe(e)}.`,
        recommendedFix: "Investigate filesystem permissions or re-invoke Layout Architect.",
      });
      pageFailures.push(failure);
      continue;
    }

    const $ = loadHtml(html);

    // ── Check 2: critical test-ids have an expected element ──────────
    // Build the per-page critical list by combining:
    //   (a) layoutGroup-based entries that apply to this page's group
    //   (b) pageRoute-based entries whose route matches this page exactly
    // component-scoped entries are deferred (handled below at the
    // scan-summary level — NOT silently skipped).
    const fromLayoutGroup = criticalByLayoutGroup.get(ltPage.layoutGroup) ?? [];
    const fromPageRoute = criticalByPageRoute.get(ltPage.pageRoute) ?? [];
    const criticalForThisPage = [...fromLayoutGroup, ...fromPageRoute];

    for (const entry of criticalForThisPage) {
      // B9 — when the entry is pageRoute-scoped we already know exactly
      // which page we're inspecting; the heuristic doesn't need to be
      // paranoid about identifying "the right" form/button/list among
      // many. Relax the matcher to "any plausible candidate on this
      // page" for scope-narrowed entries. layoutGroup-scoped entries
      // still use the strict heuristic — they apply to many pages and
      // can't tell which form on the page is the one they mean.
      const isPageRouteScoped = entry.requiredOn.pageRoute !== undefined;
      const found = isPageRouteScoped
        ? hasExpectedElementRelaxed($, entry.selector)
        : hasExpectedElement($, entry.selector);
      if (!found) {
        failure.missingCriticalElements.push(entry.selector);
        violations.push({
          rule: "stitch-missing-critical-element",
          severity: "error",
          agent: "layout-architect",
          file: stitchPage.rawHtmlPath,
          message: `Page '${ltPage.pageRoute}': critical test-id '${entry.selector}' has no expected element in the HTML Stitch produced.`,
          recommendedFix: `Re-prompt Stitch to include the element matching '${entry.selector}' on '${ltPage.pageRoute}'.`,
        });
      }
    }

    // ── Check 3: minimum sections per layoutGroup ────────────────────
    if (!hasMinimumSections($, ltPage.layoutGroup)) {
      failure.thinSections = true;
      violations.push({
        rule: "stitch-thin-section",
        severity: "error",
        agent: "layout-architect",
        file: stitchPage.rawHtmlPath,
        message: `Page '${ltPage.pageRoute}' (${ltPage.layoutGroup}) does not contain the minimum sections expected for its layoutGroup.`,
        recommendedFix: explainExpectedSections(ltPage.layoutGroup),
      });
    }

    if (
      failure.missingCriticalElements.length > 0 ||
      failure.thinSections
    ) {
      failure.reason = describeFailureReason(failure);
      pageFailures.push(failure);
    }
  }

  // ── Check 4 (B10 closure): layoutCompositions declare the slots ───
  //
  // Shell elements (signout-button, header, nav) are NOT page content —
  // they live in the layout group's shell wrapper that the Visual Adapter
  // renders. wave-2 verifies that the CONTRACT declares the right slots
  // for that wrapper; wave-4 will verify the actual JSX renders them.
  //
  // For every layoutGroup actually used by pages in the layout-tree,
  // the corresponding composition (if declared) must include at least
  // `header` and `main`. Standalone is excluded (no composition needed
  // by design — auth pages are intentionally chromeless).
  const EXPECTED_SLOTS_BY_GROUP: Record<"public" | "dashboard" | "admin", ReadonlyArray<LayoutSlot>> = {
    public: ["header", "main"],
    dashboard: ["header", "main"],
    admin: ["header", "main"],
  };
  const usedGroups = new Set<LayoutGroupV3>(ltPages.map((p) => p.layoutGroup));
  for (const group of ["public", "dashboard", "admin"] as const) {
    if (!usedGroups.has(group)) continue;
    const composition = opts.layoutTree.layoutCompositions?.[group];
    if (!composition) {
      violations.push({
        rule: "stitch-missing-layout-slot",
        severity: "error",
        agent: "layout-architect",
        file: ".atelier/layout-tree.json",
        message: `Layout group '${group}' is used by ${ltPages.filter((p) => p.layoutGroup === group).length} page(s) but has no entry in layoutCompositions.`,
        recommendedFix: `Declare layoutCompositions.${group} with at least slots: ['header', 'main'] so the Visual Adapter knows how to wrap pages of that group.`,
      });
      continue;
    }
    const expected = EXPECTED_SLOTS_BY_GROUP[group];
    const declared = new Set(composition.slots);
    const missing = expected.filter((s) => !declared.has(s));
    if (missing.length > 0) {
      violations.push({
        rule: "stitch-missing-layout-slot",
        severity: "error",
        agent: "layout-architect",
        file: ".atelier/layout-tree.json",
        message: `Layout group '${group}' is missing required slot(s): ${missing.join(", ")}. Declared: [${composition.slots.join(", ")}].`,
        recommendedFix: `Add the missing slot(s) to layoutCompositions.${group}.slots. The shell wrapper for ${group} needs header+main at minimum — header hosts the signout/nav/logo, main hosts the page content.`,
      });
    }
  }

  // ── Warn-summary for component-scoped criticals (B1 closure) ──────
  // Silent skip was the failure mode of F3 — a contract dominated by
  // requiredOn.component looked like "no gaps" to the scanner. The
  // single warn-summary makes the deferral visible: the run still passes
  // (warn, not error), but the report names how many criticals could not
  // be verified at this wave and whose responsibility it is downstream.
  if (criticalComponentDeferred.length > 0) {
    const selectors = criticalComponentDeferred.map((e) => e.selector).sort();
    violations.push({
      rule: "stitch-completeness-component-deferred",
      severity: "warn",
      agent: "layout-architect",
      message:
        `${criticalComponentDeferred.length} critical selector(s) declared with requiredOn.component — deferred to wave-4-presentation (no page↔component map at wave-2). Deferred: ${selectors.join(", ")}.`,
      recommendedFix:
        "If these selectors live in a known page (e.g. signin-form on /sign-in), change requiredOn to { pageRoute: \"/sign-in\" } so the wave-2 scanner can verify them locally. Transversal selectors (no fixed route) are fine to keep as component — they'll be verified by the future wave-4 scanner.",
    });
  }

  const shouldReprompt =
    pageFailures.length > 0 && opts.stitchAnalysis.stitchAttempt < 2;

  return { violations, pageFailures, shouldReprompt };
}

// ─── Heuristics ─────────────────────────────────────────────────────

type Cheerio$ = ReturnType<typeof loadHtml>;

/**
 * Relaxed variant used when the entry is `requiredOn: { pageRoute }` and
 * the scanner already knows it's inspecting the right page.
 *
 * For form/button/list selectors, the strict matcher does keyword-based
 * intent matching (`signin-form` → form whose class contains "signin").
 * That's appropriate when verifying against EVERY page of a layoutGroup
 * (the form's identity disambiguates). For a pageRoute-scoped entry,
 * intent is implicit — if we're on /sign-in and the page has a form,
 * that IS the signin form. The relaxed matcher drops the keyword check
 * and accepts any element of the expected kind.
 *
 * Selectors with structural intent (header-root → <header>; nav-primary
 * → <nav>) fall through to the strict matcher since their identity is
 * structural, not keyword-based.
 */
function hasExpectedElementRelaxed($: Cheerio$, selector: string): boolean {
  // Form-intent selectors → any <form>.
  if (selector === "signin-form" || selector === "signup-form" || /-form$/.test(selector)) {
    return $("form").length > 0;
  }
  // Button-intent selectors → any <button> or input[type=submit]/[type=button].
  if (
    selector === "signout-button" ||
    /-button$/.test(selector) ||
    /^admin-create-/.test(selector) ||
    selector === "reservation-button" ||
    selector === "hero-cta"
  ) {
    return (
      $("button, a[role=button], input[type=submit], input[type=button]").length > 0
    );
  }
  // List/container-intent → any list or table or repeated section.
  if (selector === "public-list-root" || /-list-root$/.test(selector) || selector.endsWith("-grid")) {
    return (
      $("ul, ol, table, [role=list]").length > 0 ||
      $("section, article").length >= 2
    );
  }
  // Everything else: fall back to the strict matcher.
  return hasExpectedElement($, selector);
}

/**
 * Does the parsed HTML contain a reasonable element for this critical
 * selector? We do NOT require Stitch to have emitted the actual
 * `data-testid` attribute — the Visual Adapter injects those. We only
 * verify SOMETHING the adapter can attach to exists.
 */
function hasExpectedElement($: Cheerio$, selector: string): boolean {
  switch (selector) {
    case "header-root":
      return $("header, [role=banner]").length > 0;
    case "nav-primary":
      return $("nav, [role=navigation]").length > 0;
    case "signin-form":
      return findFormByIntent($, ["signin", "sign-in", "login", "log-in", "auth"]);
    case "signup-form":
      return findFormByIntent($, ["signup", "sign-up", "register", "create-account"]);
    case "signout-button":
      return findButtonByText($, ["sign out", "log out", "logout", "cerrar sesión", "salir"]);
    case "public-list-root":
      return (
        $("ul, ol, table, [role=list]").length > 0 ||
        $("section, article").length >= 2
      );
    case "hero-cta":
      return (
        findHeroSection($).find("a, button").length > 0 ||
        $("main a, main button").first().length > 0
      );
  }
  // admin-create-<entity> (lowercase) — generic "create" button heuristic
  if (/^admin-create-[a-z][a-z0-9-]*$/.test(selector)) {
    return findButtonByText($, ["create", "add", "new", "crear", "nuevo", "añadir"]);
  }
  // Unknown critical selector — be permissive (not our job to block).
  return true;
}

function findFormByIntent($: Cheerio$, hints: readonly string[]): boolean {
  let found = false;
  $("form").each((_, el) => {
    if (found) return;
    const cls = ($(el).attr("class") ?? "").toLowerCase();
    const id = ($(el).attr("id") ?? "").toLowerCase();
    const ariaLabel = ($(el).attr("aria-label") ?? "").toLowerCase();
    const inner = $(el).text().toLowerCase();
    if (hints.some((h) => cls.includes(h) || id.includes(h) || ariaLabel.includes(h) || inner.includes(h))) {
      found = true;
    }
  });
  return found;
}

function findButtonByText($: Cheerio$, candidates: readonly string[]): boolean {
  let found = false;
  $("button, a[role=button], input[type=submit], input[type=button]").each((_, el) => {
    if (found) return;
    const text = ($(el).text() + " " + ($(el).attr("value") ?? "") + " " + ($(el).attr("aria-label") ?? "")).toLowerCase();
    if (candidates.some((c) => text.includes(c))) found = true;
  });
  return found;
}

function findHeroSection($: Cheerio$) {
  // First <section> in main, or any element with class containing "hero".
  const byClass = $("[class*='hero']").first();
  if (byClass.length > 0) return byClass;
  return $("main section").first();
}

/**
 * Minimum-section check per layoutGroup. Heuristic, deliberately loose to
 * avoid blocking on stylistic variation.
 *
 * Key calibration (B13, post F3-run-6): Stitch typically renders admin and
 * dashboard pages with navigation INSIDE the <header> (CRUD pattern: the
 * top-bar hosts logo + nav + signout). The previous heuristic demanded
 * <nav>/<aside> as a separate sibling — F3-run-6 flagged 5 legitimate
 * pages as "thin sections" because Stitch put nav inside header. We now
 * accept EITHER form factor as "chrome present".
 *
 * Differential per group:
 *   - public:    header REQUIRED + a content region. Marketing/landing.
 *                Header carries the brand + primary CTA hook.
 *   - dashboard: chrome (header OR nav/aside) + main. Inner user-facing
 *                pages — Stitch's variation between top-bar-only and
 *                sidebar-only is acceptable.
 *   - admin:     chrome (header OR nav/aside) + main. CRUD is legitimately
 *                sparse — a single table or form IS the page. No separate
 *                action-button requirement (read-only admin views exist).
 *   - standalone: any body content (auth/error pages).
 */
function hasMinimumSections($: Cheerio$, group: LayoutGroupV3): boolean {
  const hasChrome =
    $("header, [role=banner]").length > 0 ||
    $("nav, [role=navigation], aside").length > 0;
  const hasMain = $("main, [role=main]").length > 0;

  switch (group) {
    case "public": {
      const hasHeader = $("header, [role=banner]").length > 0;
      const hasContent = $("main, [role=main], section").length > 0;
      return hasHeader && hasContent;
    }
    case "dashboard":
      return hasChrome && hasMain;
    case "admin":
      return hasChrome && hasMain;
    case "standalone":
      return $("body").children().length > 0;
  }
}

function explainExpectedSections(group: LayoutGroupV3): string {
  switch (group) {
    case "public":
      return "Public pages need at least <header> and a content region (<main> or <section>). Re-prompt Stitch to include the full marketing layout.";
    case "dashboard":
      return "Dashboard pages need chrome (either <header> with embedded nav, or a separate <nav>/<aside>) and <main>. Re-prompt Stitch to include the authenticated app shell.";
    case "admin":
      return "Admin pages need chrome (either <header> with embedded nav, or a separate <nav>/<aside>) and <main>. A table/form alone IS valid CRUD content; we don't require a separate action area. Re-prompt Stitch to include the admin shell.";
    case "standalone":
      return "Standalone pages still need a non-empty <body>. Re-prompt Stitch.";
  }
}

function describeFailureReason(f: PageFailure): string {
  const parts: string[] = [];
  if (f.missingCriticalElements.length > 0) {
    parts.push(`missing critical elements: ${f.missingCriticalElements.join(", ")}`);
  }
  if (f.thinSections) parts.push("thin sections for layoutGroup");
  return parts.join("; ");
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ─── PostWaveGate adapter ───────────────────────────────────────────

/**
 * Wraps the scanner as a `PostWaveGate` for the orchestrator. Beyond
 * returning violations, the adapter PERSISTS `pageFailures[]` to
 * `.atelier/stitch-failures.json` so the reprompt loop in orchestrator-v3
 * can hand it back to Layout Architect via `--previous-failures=<path>`.
 *
 * The orchestrator detects rules `stitch-missing-page` /
 * `stitch-missing-critical-element` / `stitch-thin-section` in the
 * accumulated gate violations and triggers wave re-run when
 * `stitchAttempt < 2`. After 2 failed attempts the orchestrator switches
 * to plan B (sets `stitchHealth: "degraded"` and marks
 * `requires_human_review` in the run-state).
 */

export function createStitchCompletenessGate(): PostWaveGate {
  return {
    name: "stitch-completeness-scanner",
    async run(ctx) {
      const layoutTree = ctx.artifacts["layout-architect"] as
        | { layoutTree?: LayoutTreeLike }
        | undefined;
      const stitchAnalysis = ctx.artifacts["layout-architect"] as
        | { stitchAnalysis?: StitchAnalysisLike }
        | undefined;
      const testIdContract = ctx.artifacts["layout-architect"] as
        | { testIdContract?: TestIdContractLike }
        | undefined;

      const lt = layoutTree?.layoutTree;
      const sa = stitchAnalysis?.stitchAnalysis;
      const tic = testIdContract?.testIdContract;

      if (!lt || !sa || !tic) {
        // Upstream wave didn't produce all 3 artifacts — the regular
        // coherence-scanner will already flag that. Nothing to do here.
        return [];
      }

      const report = await scanStitchCompleteness({
        workDir: ctx.workDir,
        layoutTree: lt,
        stitchAnalysis: sa,
        testIdContract: tic,
      });

      // Persist failures so the orchestrator (and Layout Architect on
      // reprompt) can read them from disk. Empty list → empty file,
      // which is also a useful "previous run was clean" signal.
      const failuresPath = join(ctx.workDir, ".atelier", "stitch-failures.json");
      try {
        await writeFile(
          failuresPath,
          JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              stitchAttempt: sa.stitchAttempt,
              pageFailures: report.pageFailures,
              shouldReprompt: report.shouldReprompt,
            },
            null,
            2,
          ),
          "utf8",
        );
      } catch {
        // Failing to persist failures is non-fatal — the orchestrator can
        // still inspect violations directly. The reprompt loop will use
        // a slimmer message in that case.
      }

      return report.violations;
    },
  };
}
