import { describe, it, expect } from "vitest";

import {
  validateStitchAnalysis,
  type StitchAnalysis,
} from "./stitch-analysis.schema";

// ─── Fixture builder ────────────────────────────────────────────────

function analysis(over: Partial<StitchAnalysis> = {}): StitchAnalysis {
  return {
    generatedAt: "2026-05-14T22:00:00.000Z",
    stitchProjectId: "stitch-proj-123",
    designVibe: "Calm",
    stitchAttempt: 0,
    stitchHealth: "clean",
    colorTokens: [
      { role: "primary", value: "#4a7c59", hint: "salvia" },
      { role: "background", value: "#fafaf7" },
      { role: "foreground", value: "#1f1f1f" },
      { role: "muted", value: "#e8e8e3" },
      { role: "border", value: "#d4d4cf" },
    ],
    typographyTokens: [
      { role: "heading-1", family: "Inter", sizePx: 48, weight: 700, lineHeightPx: 56 },
      { role: "body", family: "Inter", sizePx: 16, weight: 400, lineHeightPx: 24 },
      { role: "caption", family: "Inter", sizePx: 13, weight: 400 },
    ],
    pages: [
      {
        pageRoute: "/",
        mockupPath: ".atelier/stitch-mockups/home.png",
        rawHtmlPath: ".atelier/stitch-html/home.html",
        stitchScreenId: "scr-home-001",
        linkedFonts: ["https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"],
      },
    ],
    designMdPath: ".atelier/stitch-design.md",
    ...over,
  };
}

// ─── Happy path + refinements ───────────────────────────────────────

describe("stitchAnalysisSchema — happy + refinements", () => {
  it("accepts the canonical post-rework fixture", () => {
    expect(validateStitchAnalysis(analysis())).toBeNull();
  });

  it("accepts an empty linkedFonts[] (pure system stacks)", () => {
    expect(
      validateStitchAnalysis(
        analysis({
          pages: [
            {
              pageRoute: "/",
              mockupPath: ".atelier/stitch-mockups/home.png",
              rawHtmlPath: ".atelier/stitch-html/home.html",
              stitchScreenId: "scr-001",
              linkedFonts: [],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("accepts stitchHealth='degraded' with stitchAttempt=2 (plan B state)", () => {
    expect(
      validateStitchAnalysis(analysis({ stitchAttempt: 2, stitchHealth: "degraded" })),
    ).toBeNull();
  });
});

// ─── Schema rejects (refinements + regex) ───────────────────────────

describe("stitchAnalysisSchema — refinements reject malformed input", () => {
  it("rejects when color tokens lack primary/background/foreground", () => {
    expect(
      validateStitchAnalysis(
        analysis({
          colorTokens: [
            { role: "muted", value: "#e8e8e3" },
            { role: "border", value: "#d4d4cf" },
            { role: "accent", value: "#ffa726" },
            { role: "destructive", value: "#dc2626" },
            { role: "success", value: "#16a34a" },
          ],
        }),
      ),
    ).toMatch(/primary, background, and foreground/);
  });

  it("rejects when typography lacks both body and a heading", () => {
    expect(
      validateStitchAnalysis(
        analysis({
          typographyTokens: [
            { role: "caption", family: "Inter", sizePx: 13, weight: 400 },
            { role: "label", family: "Inter", sizePx: 14, weight: 500 },
            { role: "code", family: "Fira Code", sizePx: 14, weight: 400 },
          ],
        }),
      ),
    ).toMatch(/body \+ at least one heading/);
  });

  it("rejects mockupPath outside .atelier/stitch-mockups/", () => {
    expect(
      validateStitchAnalysis(
        analysis({
          pages: [
            {
              pageRoute: "/",
              mockupPath: "screenshots/home.png" as never,
              rawHtmlPath: ".atelier/stitch-html/home.html",
              stitchScreenId: "scr-001",
              linkedFonts: [],
            },
          ],
        }),
      ),
    ).toMatch(/mockupPath/);
  });

  it("rejects rawHtmlPath outside .atelier/stitch-html/", () => {
    expect(
      validateStitchAnalysis(
        analysis({
          pages: [
            {
              pageRoute: "/",
              mockupPath: ".atelier/stitch-mockups/home.png",
              rawHtmlPath: "html/home.html" as never,
              stitchScreenId: "scr-001",
              linkedFonts: [],
            },
          ],
        }),
      ),
    ).toMatch(/rawHtmlPath/);
  });

  it("rejects designMdPath not equal to .atelier/stitch-design.md", () => {
    expect(
      validateStitchAnalysis(analysis({ designMdPath: ".atelier/design.md" as never })),
    ).toMatch(/designMdPath/);
  });

  it("rejects stitchAttempt > 2", () => {
    expect(validateStitchAnalysis(analysis({ stitchAttempt: 3 as never }))).toMatch(
      /stitchAttempt/,
    );
  });

  it("rejects stitchHealth not in enum", () => {
    expect(
      validateStitchAnalysis(analysis({ stitchHealth: "broken" as never })),
    ).toMatch(/stitchHealth/);
  });

  it("rejects color value not in #rrggbb format", () => {
    expect(
      validateStitchAnalysis(
        analysis({
          colorTokens: [
            { role: "primary", value: "red" as never },
            { role: "background", value: "#fafaf7" },
            { role: "foreground", value: "#1f1f1f" },
            { role: "muted", value: "#e8e8e3" },
            { role: "border", value: "#d4d4cf" },
          ],
        }),
      ),
    ).toMatch(/value/);
  });

  it("rejects linkedFonts entry that is not a valid URL", () => {
    expect(
      validateStitchAnalysis(
        analysis({
          pages: [
            {
              pageRoute: "/",
              mockupPath: ".atelier/stitch-mockups/home.png",
              rawHtmlPath: ".atelier/stitch-html/home.html",
              stitchScreenId: "scr-001",
              linkedFonts: ["not-a-url" as string],
            },
          ],
        }),
      ),
    ).toMatch(/linkedFonts|url/i);
  });

  it("rejects duplicate pageRoute in pages[]", () => {
    expect(
      validateStitchAnalysis(
        analysis({
          pages: [
            {
              pageRoute: "/",
              mockupPath: ".atelier/stitch-mockups/home.png",
              rawHtmlPath: ".atelier/stitch-html/home.html",
              stitchScreenId: "scr-001",
              linkedFonts: [],
            },
            {
              pageRoute: "/",
              mockupPath: ".atelier/stitch-mockups/home-dup.png",
              rawHtmlPath: ".atelier/stitch-html/home-dup.html",
              stitchScreenId: "scr-002",
              linkedFonts: [],
            },
          ],
        }),
      ),
    ).toMatch(/duplicate pageRoute/);
  });
});

// ─── Rework removed shapes are gone ─────────────────────────────────

describe("stitchAnalysisSchema — rework removed legacy shapes", () => {
  it("rejects when rootSection is present (legacy field)", () => {
    const legacy = {
      ...analysis(),
      pages: [
        {
          pageRoute: "/",
          mockupPath: ".atelier/stitch-mockups/home.png",
          rawHtmlPath: ".atelier/stitch-html/home.html",
          stitchScreenId: "scr-001",
          linkedFonts: [],
          rootSection: { id: "root", purpose: "x", layoutPrimitive: "stack" },
        },
      ],
    };
    // strict() blocks unknown keys.
    expect(validateStitchAnalysis(legacy)).toMatch(/rootSection|unrecognized/i);
  });
});
