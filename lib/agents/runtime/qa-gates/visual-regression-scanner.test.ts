import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { PNG } from "pngjs";

import { runVisualRegression } from "./visual-regression-scanner";
import type { StitchAnalysis } from "../../contracts-v3/stitch-analysis.schema";
import type { VisualQaReport } from "../../contracts-v3/visual-qa.schema";

const FIXTURE_ROOT = resolve(tmpdir(), "atelier-v3-visual-regression-tests");

async function freshWorkDir(): Promise<string> {
  const wd = join(FIXTURE_ROOT, "wd-" + Math.random().toString(36).slice(2));
  await mkdir(wd, { recursive: true });
  await mkdir(join(wd, ".atelier/stitch-mockups"), { recursive: true });
  await mkdir(join(wd, ".atelier/screenshots"), { recursive: true });
  return wd;
}

/** Generate a solid-color PNG buffer of given dimensions. */
function solidPng(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i + 0] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

async function writePng(absPath: string, buf: Buffer): Promise<void> {
  await writeFile(absPath, buf);
}

// ─── Fixture builders ───────────────────────────────────────────────

function stitchAnalysis(over: Partial<StitchAnalysis> = {}): StitchAnalysis {
  return {
    generatedAt: "2026-05-13T22:00:00.000Z",
    stitchProjectId: "proj-001",
    designVibe: "Calm",
    colorTokens: [
      { role: "primary", value: "#4a7c59" },
      { role: "background", value: "#fafaf7" },
      { role: "foreground", value: "#1f1f1f" },
      { role: "muted", value: "#e8e8e3" },
      { role: "border", value: "#d4d4cf" },
    ],
    typographyTokens: [
      { role: "heading-1", family: "Inter", sizePx: 48, weight: 700 },
      { role: "body", family: "Inter", sizePx: 16, weight: 400 },
      { role: "caption", family: "Inter", sizePx: 13, weight: 400 },
    ],
    pages: [
      {
        pageRoute: "/",
        mockupPath: ".atelier/stitch-mockups/home.png",
        stitchScreenId: "scr-001",
        rootSection: { id: "home-root", purpose: "page-root", layoutPrimitive: "stack" },
      },
    ],
    designMdPath: ".atelier/stitch-design.md",
    ...over,
  };
}

function visualQaReport(screenshotPath: string, url: string): VisualQaReport {
  return {
    generatedAt: "2026-05-13T22:00:00.000Z",
    appUrl: "http://localhost:3000",
    setup: {
      setupCommand: "pnpm setup",
      setupDurationMs: 1000,
      bootTimeMs: 100,
      healthcheckUrl: "http://localhost:3000/",
      healthcheckStatus: 200,
    },
    flows: [
      {
        flow: "client-anonymous",
        startedAt: "2026-05-13T22:00:00.000Z",
        durationMs: 100,
        stepsTotal: 1,
        stepsOk: 1,
        stepsFailed: 0,
        stepsSkipped: 0,
        decision: "go",
      },
    ],
    steps: [
      {
        flow: "client-anonymous",
        name: "open home",
        startedAt: "2026-05-13T22:00:00.000Z",
        durationMs: 100,
        status: "ok",
      },
    ],
    screenshots: [
      {
        stepName: "open home",
        path: screenshotPath,
        capturedAt: "2026-05-13T22:00:00.000Z",
        url,
      },
    ],
    consoleEvents: [],
    networkEvents: [],
    violations: [],
    decision: "go",
    summary: "All green dry-run sample.",
    playwrightScriptPath: ".atelier/visual-qa-script.spec.ts",
  };
}

// ─── Lifecycle ──────────────────────────────────────────────────────

beforeEach(async () => {
  if (existsSync(FIXTURE_ROOT)) await rm(FIXTURE_ROOT, { recursive: true, force: true });
  await mkdir(FIXTURE_ROOT, { recursive: true });
});

afterEach(async () => {
  if (existsSync(FIXTURE_ROOT)) await rm(FIXTURE_ROOT, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────────────

describe("runVisualRegression — identical PNGs (no regression)", () => {
  it("returns zero violations when mockup and screenshot are pixel-identical", async () => {
    const wd = await freshWorkDir();
    const buf = solidPng(20, 20, [74, 124, 89, 255]); // primary salvia
    await writePng(join(wd, ".atelier/stitch-mockups/home.png"), buf);
    await writePng(join(wd, ".atelier/screenshots/home.png"), buf);

    const report = await runVisualRegression({
      workDir: wd,
      stitchAnalysis: stitchAnalysis(),
      visualQaReport: visualQaReport(".atelier/screenshots/home.png", "http://localhost:3000/"),
    });
    expect(report.pagesCompared).toBe(1);
    expect(report.violations).toEqual([]);
  });
});

describe("runVisualRegression — major regression (>25% diff)", () => {
  it("emits visual-regression-major routed to layout-architect", async () => {
    const wd = await freshWorkDir();
    const mockup = solidPng(20, 20, [74, 124, 89, 255]);
    const screenshot = solidPng(20, 20, [200, 50, 50, 255]); // very different
    await writePng(join(wd, ".atelier/stitch-mockups/home.png"), mockup);
    await writePng(join(wd, ".atelier/screenshots/home.png"), screenshot);

    const report = await runVisualRegression({
      workDir: wd,
      stitchAnalysis: stitchAnalysis(),
      visualQaReport: visualQaReport(".atelier/screenshots/home.png", "http://localhost:3000/"),
    });
    expect(report.pagesCompared).toBe(1);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.rule).toBe("visual-regression-major");
    expect(report.violations[0]?.agent).toBe("layout-architect");
    expect(report.violations[0]?.severity).toBe("error");
  });
});

describe("runVisualRegression — minor regression (10-25% diff)", () => {
  it("uses _diff test seam to deterministically set the diff ratio", async () => {
    const wd = await freshWorkDir();
    const placeholder = solidPng(2, 2, [0, 0, 0, 255]);
    await writePng(join(wd, ".atelier/stitch-mockups/home.png"), placeholder);
    await writePng(join(wd, ".atelier/screenshots/home.png"), placeholder);

    const report = await runVisualRegression({
      workDir: wd,
      stitchAnalysis: stitchAnalysis(),
      visualQaReport: visualQaReport(".atelier/screenshots/home.png", "http://localhost:3000/"),
      _diff: () => ({ pixelsDiff: 1500, total: 10_000 }), // 15%
    });
    expect(report.pagesCompared).toBe(1);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.rule).toBe("visual-regression-minor");
    expect(report.violations[0]?.agent).toBe("ui-components");
    expect(report.violations[0]?.severity).toBe("warn");
  });
});

describe("runVisualRegression — skip cases", () => {
  it("skips when mockup PNG is missing on disk", async () => {
    const wd = await freshWorkDir();
    // Don't write the mockup
    await writePng(join(wd, ".atelier/screenshots/home.png"), solidPng(2, 2, [0, 0, 0, 255]));

    const report = await runVisualRegression({
      workDir: wd,
      stitchAnalysis: stitchAnalysis(),
      visualQaReport: visualQaReport(".atelier/screenshots/home.png", "http://localhost:3000/"),
    });
    expect(report.pagesSkipped).toBe(1);
    expect(report.pagesCompared).toBe(0);
    expect(report.violations).toEqual([]);
  });

  it("skips when no visual-qa screenshot matches the page route", async () => {
    const wd = await freshWorkDir();
    await writePng(join(wd, ".atelier/stitch-mockups/home.png"), solidPng(2, 2, [0, 0, 0, 255]));
    // Visual-qa screenshot is for a different URL
    const report = await runVisualRegression({
      workDir: wd,
      stitchAnalysis: stitchAnalysis(),
      visualQaReport: visualQaReport(".atelier/screenshots/about.png", "http://localhost:3000/about"),
    });
    expect(report.pagesSkipped).toBe(1);
    expect(report.pagesCompared).toBe(0);
  });
});

describe("runVisualRegression — multiple pages", () => {
  it("aggregates violations across pages", async () => {
    const wd = await freshWorkDir();
    const buf = solidPng(2, 2, [0, 0, 0, 255]);
    await writePng(join(wd, ".atelier/stitch-mockups/home.png"), buf);
    await writePng(join(wd, ".atelier/stitch-mockups/shop.png"), buf);
    await writePng(join(wd, ".atelier/screenshots/home.png"), buf);
    await writePng(join(wd, ".atelier/screenshots/shop.png"), buf);

    const report = await runVisualRegression({
      workDir: wd,
      stitchAnalysis: stitchAnalysis({
        pages: [
          {
            pageRoute: "/",
            mockupPath: ".atelier/stitch-mockups/home.png",
            stitchScreenId: "scr-001",
            rootSection: { id: "h", purpose: "p", layoutPrimitive: "stack" },
          },
          {
            pageRoute: "/shop",
            mockupPath: ".atelier/stitch-mockups/shop.png",
            stitchScreenId: "scr-002",
            rootSection: { id: "s", purpose: "p", layoutPrimitive: "stack" },
          },
        ],
      }),
      visualQaReport: {
        ...visualQaReport(".atelier/screenshots/home.png", "http://localhost:3000/"),
        screenshots: [
          {
            stepName: "home",
            path: ".atelier/screenshots/home.png",
            capturedAt: "2026-05-13T22:00:00.000Z",
            url: "http://localhost:3000/",
          },
          {
            stepName: "shop",
            path: ".atelier/screenshots/shop.png",
            capturedAt: "2026-05-13T22:00:00.000Z",
            url: "http://localhost:3000/shop",
          },
        ],
      },
      _diff: () => ({ pixelsDiff: 3000, total: 10_000 }), // 30% → major both
    });
    expect(report.pagesCompared).toBe(2);
    expect(report.violations).toHaveLength(2);
    expect(report.violations.every((v) => v.rule === "visual-regression-major")).toBe(true);
  });
});
