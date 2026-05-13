import { describe, it, expect } from "vitest";

import {
  validateStitchAnalysis,
  type Section,
  type StitchAnalysis,
} from "./stitch-analysis.schema";

// ─── Fixture builders ───────────────────────────────────────────────

function section(over: Partial<Section> = {}): Section {
  return {
    id: "root",
    purpose: "page-root",
    layoutPrimitive: "stack",
    gapPx: 24,
    paddingPx: { top: 32, right: 16, bottom: 32, left: 16 },
    ...over,
  };
}

function analysis(over: Partial<StitchAnalysis> = {}): StitchAnalysis {
  return {
    generatedAt: "2026-05-13T22:00:00.000Z",
    stitchProjectId: "stitch-proj-123",
    designVibe: "Calm",
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
        stitchScreenId: "scr-home-001",
        rootSection: section({
          id: "home-root",
          children: [
            section({ id: "hero", purpose: "hero", layoutPrimitive: "stack" }),
            section({
              id: "features",
              purpose: "feature-grid",
              layoutPrimitive: "grid",
              columns: 3,
            }),
          ],
        }),
      },
    ],
    designMdPath: ".atelier/stitch-design.md",
    ...over,
  };
}

// ─── Section recursion sanity (the explicit ZodType<Section>) ───────

describe("sectionSchema — recursive shape", () => {
  it("accepts a deeply nested section tree", () => {
    const a = analysis({
      pages: [
        {
          pageRoute: "/",
          mockupPath: ".atelier/stitch-mockups/home.png",
          stitchScreenId: "scr-001",
          rootSection: section({
            id: "root",
            children: [
              section({
                id: "section-1",
                children: [section({ id: "section-1-1" })],
              }),
            ],
          }),
        },
      ],
    });
    expect(validateStitchAnalysis(a)).toBeNull();
  });

  it("type inference produces a Section, not an unknown", () => {
    // Compile-time check: this would not typecheck if Section inference were unknown.
    const s: Section = { id: "x", purpose: "hero", layoutPrimitive: "stack" };
    expect(s.id).toBe("x");
    // narrowing on layoutPrimitive must be typed correctly
    if (s.layoutPrimitive === "grid") {
      // `columns` is optional on this branch — compiler must know it
      expect(s.columns).toBeUndefined();
    }
  });
});

// ─── Schema refinements ─────────────────────────────────────────────

describe("stitchAnalysisSchema — happy + refinements", () => {
  it("accepts the canonical yoga-ish fixture", () => {
    expect(validateStitchAnalysis(analysis())).toBeNull();
  });

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
              stitchScreenId: "scr-001",
              rootSection: section(),
            },
          ],
        }),
      ),
    ).toMatch(/mockupPath/);
  });

  it("rejects designMdPath not equal to .atelier/stitch-design.md", () => {
    expect(
      validateStitchAnalysis(analysis({ designMdPath: ".atelier/design.md" as never })),
    ).toMatch(/designMdPath/);
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

  it("rejects duplicate pageRoute in pages[]", () => {
    expect(
      validateStitchAnalysis(
        analysis({
          pages: [
            {
              pageRoute: "/",
              mockupPath: ".atelier/stitch-mockups/home.png",
              stitchScreenId: "scr-001",
              rootSection: section(),
            },
            {
              pageRoute: "/",
              mockupPath: ".atelier/stitch-mockups/home-dup.png",
              stitchScreenId: "scr-002",
              rootSection: section(),
            },
          ],
        }),
      ),
    ).toMatch(/duplicate pageRoute/);
  });

  it("rejects section id that is not kebab-case", () => {
    expect(
      validateStitchAnalysis(
        analysis({
          pages: [
            {
              pageRoute: "/",
              mockupPath: ".atelier/stitch-mockups/home.png",
              stitchScreenId: "scr-001",
              rootSection: section({ id: "HeroSection" }),
            },
          ],
        }),
      ),
    ).toMatch(/kebab-case/);
  });
});
