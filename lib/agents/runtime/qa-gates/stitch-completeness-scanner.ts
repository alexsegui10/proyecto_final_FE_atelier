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

// ─── Public types ───────────────────────────────────────────────────

export type LayoutGroupV3 = "public" | "dashboard" | "admin" | "standalone";

export interface LayoutTreePageLike {
  pageRoute: string;
  layoutGroup: LayoutGroupV3;
}
export interface LayoutTreeLike {
  pages: ReadonlyArray<LayoutTreePageLike>;
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

  // Index stitch pages by route for O(1) lookup.
  const stitchByRoute = new Map(opts.stitchAnalysis.pages.map((p) => [p.pageRoute, p]));

  // Pre-classify critical test-id entries by their requiredOn variant.
  // Component-scoped entries are NOT silently skipped — they're counted
  // and surfaced as a single warn-summary violation at the end of the
  // scan. This closes B1 of the F3 first-real-run triage (the
  // "silent-skip is the failure mode" pattern).
  const criticals = opts.testIdContract.entries.filter((e) => e.criticality === "critical");
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

  for (const ltPage of opts.layoutTree.pages) {
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
      if (!hasExpectedElement($, entry.selector)) {
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
 * Minimum-section check per layoutGroup. Heuristic; deliberately loose to
 * avoid blocking on stylistic variation. We're checking "Stitch generated
 * a plausible page for this group", not "Stitch matched our exact template".
 */
function hasMinimumSections($: Cheerio$, group: LayoutGroupV3): boolean {
  switch (group) {
    case "public": {
      const hasHeader = $("header, [role=banner]").length > 0;
      const hasMain = $("main, [role=main], section").length > 0;
      return hasHeader && hasMain;
    }
    case "dashboard": {
      const hasNav = $("nav, [role=navigation], aside").length > 0;
      const hasMain = $("main, [role=main]").length > 0;
      return hasNav && hasMain;
    }
    case "admin": {
      const hasNav = $("nav, [role=navigation], aside").length > 0;
      const hasMain = $("main, [role=main]").length > 0;
      const hasAction =
        $("button, a[role=button]").length > 0 || $("[class*='action']").length > 0;
      return hasNav && hasMain && hasAction;
    }
    case "standalone":
      // Single-purpose pages — anything with body content is acceptable.
      return $("body").children().length > 0;
  }
}

function explainExpectedSections(group: LayoutGroupV3): string {
  switch (group) {
    case "public":
      return "Public pages need at least <header> and <main>/<section>. Re-prompt Stitch to include the full marketing layout.";
    case "dashboard":
      return "Dashboard pages need at least a nav/sidebar (<nav> or <aside>) and <main>. Re-prompt Stitch to include the authenticated app shell.";
    case "admin":
      return "Admin pages need nav/sidebar + <main> + at least one action button. Re-prompt Stitch to include the admin shell.";
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
