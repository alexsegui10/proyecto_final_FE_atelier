/**
 * visual-regression-scanner — Gate 6 (post-rework Punto E).
 *
 * Compares the screenshots Visual QA captured (`.atelier/screenshots/*.png`)
 * against the mockups Stitch produced (`.atelier/stitch-mockups/*.png`)
 * using pixelmatch + pngjs. Emits violations when divergence exceeds
 * configurable tolerances.
 *
 * Post-rework thresholds + routing:
 *   - diff > 5%  of pixels      → `visual-regression-major`, agent `visual-adapter`, severity `error`
 *   - 1% < diff <= 5%           → `visual-regression-minor`, agent `visual-adapter`, severity `warn`
 *   - diff <= 1%                → no violation (this is the expected baseline)
 *
 * Why thresholds dropped dramatically (from 25%/10% to 5%/1%):
 * The Visual Adapter now preserves Stitch's HTML/CSS literally — the
 * generated app should be a near-pixel-perfect copy of the mockup PLUS
 * dynamic data. Pixels that diverge are attributable to:
 *   1. Dynamic data (empty list vs populated, form with validation errors).
 *   2. `replaced-with-shadcn` swaps the Adapter did as last resort.
 *   3. Hydration mismatch / FOUC of web fonts loading late.
 * None of these should exceed 5% in a healthy adaptation. >5% means the
 * Adapter mishandled preservation — routing goes to it, not to Layout
 * Architect (Layout Architect already delivered fidelity HTML; the
 * `stitch-completeness-scanner` post-wave-2 owns that contract).
 *
 * Designed to run as a postWaveGate of `wave-7-runtime-qa` (needs Visual
 * QA output to exist on disk).
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

import type { QaViolationV3 } from "../../orchestrator-v3";
import { expectArray } from "./_artifact-guard";
import type { StitchAnalysis } from "../../contracts-v3/stitch-analysis.schema";
import type { VisualQaReport } from "../../contracts-v3/visual-qa.schema";

// ─── Public types ───────────────────────────────────────────────────

export interface RunVisualRegressionOptions {
  workDir: string;
  stitchAnalysis: StitchAnalysis;
  visualQaReport: VisualQaReport;
  /** Major threshold (0..1). Default 0.05 (post-rework — was 0.25 pre-rework). */
  majorThreshold?: number;
  /** Minor threshold (0..1). Default 0.01 (post-rework — was 0.10 pre-rework). */
  minorThreshold?: number;
  /** Pixelmatch sensitivity (0..1, lower is stricter). Default 0.1. */
  pixelMatchThreshold?: number;
  /** Test seam — replaces fs.readFile when loading PNGs. */
  _readFile?: (path: string) => Promise<Buffer>;
  /** Test seam — replaces pixelmatch + PNG parsing with a precomputed diff. */
  _diff?: (mockup: Buffer, screenshot: Buffer) => { pixelsDiff: number; total: number };
}

export interface VisualRegressionReport {
  pagesCompared: number;
  pagesSkipped: number;
  violations: QaViolationV3[];
}

// ─── Scanner ────────────────────────────────────────────────────────

export async function runVisualRegression(
  opts: RunVisualRegressionOptions,
): Promise<VisualRegressionReport> {
  const majorTh = opts.majorThreshold ?? 0.05;
  const minorTh = opts.minorThreshold ?? 0.01;
  const pmThreshold = opts.pixelMatchThreshold ?? 0.1;
  const readFn = opts._readFile ?? ((p: string) => readFile(p));
  const diffFn = opts._diff ?? makeDefaultDiff(pmThreshold);

  const violations: QaViolationV3[] = [];
  let pagesCompared = 0;
  let pagesSkipped = 0;

  // Build a lookup of Visual QA screenshots by step name. We pair them with
  // Stitch mockups by matching the page route → step name heuristically:
  // the visual-qa screenshot for a flow has the form
  // `.atelier/screenshots/<flow>-NNN-<slug>.png`. We compare the FIRST
  // screenshot for each route as a proxy for the page render.
  const vqScreenshots = opts.visualQaReport.screenshots;

  const saPages = expectArray<{ mockupPath: string; pageRoute: string }>(
    opts.stitchAnalysis.pages,
    {
      violations,
      rule: "stitch-analysis-malformed",
      agent: "layout-architect",
      file: ".atelier/stitch-analysis.json",
      field: "stitchAnalysis.pages",
    },
  );
  for (const page of saPages) {
    const mockupRel = page.mockupPath;
    const mockupAbs = join(opts.workDir, mockupRel);
    if (!existsSync(mockupAbs)) {
      pagesSkipped++;
      continue;
    }
    // Find a matching visual-qa screenshot. Strategy: the screenshot whose
    // URL field matches the page route at capture time.
    const match = vqScreenshots.find((s) => urlMatchesRoute(s.url, page.pageRoute));
    if (!match) {
      pagesSkipped++;
      continue;
    }
    const screenshotAbs = join(opts.workDir, match.path);
    if (!existsSync(screenshotAbs)) {
      pagesSkipped++;
      continue;
    }

    let mockupBytes: Buffer;
    let screenshotBytes: Buffer;
    try {
      mockupBytes = await readFn(mockupAbs);
      screenshotBytes = await readFn(screenshotAbs);
    } catch (e) {
      pagesSkipped++;
      violations.push({
        rule: "visual-regression-io-error",
        severity: "warn",
        agent: "visual-qa",
        file: mockupRel,
        message: `Could not read PNG for visual diff (${page.pageRoute}): ${describe(e)}`,
        recommendedFix: "Investigate file system permissions or rerun the generation.",
      });
      continue;
    }

    let diff;
    try {
      diff = diffFn(mockupBytes, screenshotBytes);
    } catch (e) {
      pagesSkipped++;
      violations.push({
        rule: "visual-regression-decode-error",
        severity: "warn",
        agent: "visual-qa",
        file: mockupRel,
        message: `PNG decode failed for ${page.pageRoute}: ${describe(e)}`,
        recommendedFix: "Verify the mockup + screenshot are valid PNG files of the same dimensions.",
      });
      continue;
    }

    pagesCompared++;
    const ratio = diff.total === 0 ? 0 : diff.pixelsDiff / diff.total;
    if (ratio > majorTh) {
      violations.push({
        rule: "visual-regression-major",
        severity: "error",
        agent: "visual-adapter",
        file: mockupRel,
        message:
          `${page.pageRoute}: visual regression major — ${(ratio * 100).toFixed(1)}% of pixels diverge from the Stitch mockup (threshold ${(majorTh * 100).toFixed(1)}%).`,
        recommendedFix:
          "Visual Adapter delivered a screenshot >5% divergent from the Stitch mockup. Likely causes: (1) Adapter mishandled HTML preservation (rewrote sections that should have been kept literal); (2) excessive replaced-with-shadcn swaps; (3) preserved fonts didn't load (check runtime-smoke-gate). Inspect page-adaptations.json for this route.",
      });
    } else if (ratio > minorTh) {
      violations.push({
        rule: "visual-regression-minor",
        severity: "warn",
        agent: "visual-adapter",
        file: mockupRel,
        message:
          `${page.pageRoute}: visual regression minor — ${(ratio * 100).toFixed(1)}% pixel divergence vs Stitch mockup.`,
        recommendedFix:
          "Usually one of: dynamic data populating differently than mockup, an isolated replaced-with-shadcn swap that diverges slightly, or web font late-loading FOUC. Acceptable baseline if rationale exists in page-adaptations.json.",
      });
    }
  }

  return { pagesCompared, pagesSkipped, violations };
}

// ─── Helpers ────────────────────────────────────────────────────────

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function urlMatchesRoute(url: string, route: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === route;
  } catch {
    return url === route || url.endsWith(route);
  }
}

function makeDefaultDiff(pixelMatchThreshold: number) {
  return (mockup: Buffer, screenshot: Buffer): { pixelsDiff: number; total: number } => {
    const a = PNG.sync.read(mockup);
    const b = PNG.sync.read(screenshot);
    // pixelmatch requires same dimensions. If they differ, signal 100% diff.
    if (a.width !== b.width || a.height !== b.height) {
      return { pixelsDiff: a.width * a.height, total: a.width * a.height };
    }
    const diffImg = new PNG({ width: a.width, height: a.height });
    const pixelsDiff = pixelmatch(a.data, b.data, diffImg.data, a.width, a.height, {
      threshold: pixelMatchThreshold,
    });
    return { pixelsDiff, total: a.width * a.height };
  };
}
