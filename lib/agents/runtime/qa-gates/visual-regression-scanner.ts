/**
 * visual-regression-scanner — Gate 6.
 *
 * Compares the screenshots Visual QA captured (`.atelier/screenshots/*.png`)
 * against the mockups Stitch produced (`.atelier/stitch-mockups/*.png`)
 * using pixelmatch + pngjs. Emits violations when divergence exceeds
 * configurable tolerances.
 *
 * Routing rule:
 *   - diff > 25% of pixels  → `visual-regression-major`, agent `layout-architect`, severity `error`
 *   - 10% < diff <= 25%     → `visual-regression-minor`, agent `ui-components`,    severity `warn`
 *   - diff <= 10%           → no violation
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
import type { StitchAnalysis } from "../../contracts-v3/stitch-analysis.schema";
import type { VisualQaReport } from "../../contracts-v3/visual-qa.schema";

// ─── Public types ───────────────────────────────────────────────────

export interface RunVisualRegressionOptions {
  workDir: string;
  stitchAnalysis: StitchAnalysis;
  visualQaReport: VisualQaReport;
  /** Major threshold (0..1). Default 0.25. */
  majorThreshold?: number;
  /** Minor threshold (0..1). Default 0.10. */
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
  const majorTh = opts.majorThreshold ?? 0.25;
  const minorTh = opts.minorThreshold ?? 0.10;
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

  for (const page of opts.stitchAnalysis.pages) {
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
        agent: "layout-architect",
        file: mockupRel,
        message:
          `${page.pageRoute}: visual regression major — ${(ratio * 100).toFixed(1)}% of pixels diverge from the Stitch mockup (threshold ${(majorTh * 100).toFixed(0)}%).`,
        recommendedFix:
          "Compare the Stitch mockup at the same path with the actual screenshot. Likely cause: page composed under the wrong layout group (bug class E) or the layout-tree doesn't match what was designed.",
      });
    } else if (ratio > minorTh) {
      violations.push({
        rule: "visual-regression-minor",
        severity: "warn",
        agent: "ui-components",
        file: mockupRel,
        message:
          `${page.pageRoute}: visual regression minor — ${(ratio * 100).toFixed(1)}% pixel divergence vs Stitch mockup.`,
        recommendedFix:
          "Inspect the screenshot: usually a microcopy difference, token mismatch (color, spacing) or missing icon. UI Components owns these surface details.",
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
