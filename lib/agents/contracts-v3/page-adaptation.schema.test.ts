import { describe, it, expect } from "vitest";

import {
  validatePageAdaptations,
  type PageAdaptations,
} from "./page-adaptation.schema";

// ─── Fixture builder ────────────────────────────────────────────────

function adaptation(over: Partial<PageAdaptations> = {}): PageAdaptations {
  return {
    generatedAt: "2026-05-14T22:00:00.000Z",
    stitchProjectId: "stitch-proj-123",
    stitchHealth: "clean",
    pages: [
      {
        pageRoute: "/",
        sourceHtmlPath: ".atelier/stitch-html/home.html",
        generatedPagePath: "app/page.tsx",
        adaptationStatus: "clean",
        changes: [
          {
            type: "injected-test-id",
            targetSelector: "header.hero",
            rationale: "Added data-testid=header-root from contract.",
          },
          {
            type: "preserved-font-link",
            targetSelector: 'link[href*="fonts.googleapis.com"]',
            rationale: "Inter font link copied to app/layout.tsx <head>.",
          },
        ],
        preservedFonts: [
          "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap",
        ],
        injectedTestIds: ["header-root"],
      },
    ],
    ...over,
  };
}

// ─── Happy path ─────────────────────────────────────────────────────

describe("pageAdaptationsSchema — happy path", () => {
  it("accepts a clean adaptation with preserved fonts and injected test-ids", () => {
    expect(validatePageAdaptations(adaptation())).toBeNull();
  });

  it("accepts adaptationStatus='partial' with no reasonForReprompt", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          pages: [
            {
              pageRoute: "/dashboard",
              sourceHtmlPath: ".atelier/stitch-html/dashboard.html",
              generatedPagePath: "app/dashboard/page.tsx",
              adaptationStatus: "partial",
              changes: [
                {
                  type: "static-to-interactive",
                  targetSelector: "section.legacy",
                  rationale: "Section visible but not wired; missing api-contract endpoint.",
                },
              ],
              preservedFonts: [],
              injectedTestIds: [],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("accepts adaptationStatus='requires-reprompt' when reasonForReprompt is present and ≥10 chars", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          stitchHealth: "degraded",
          pages: [
            {
              pageRoute: "/admin/classes",
              sourceHtmlPath: ".atelier/stitch-html/admin-classes.html",
              generatedPagePath: "app/admin/classes/page.tsx",
              adaptationStatus: "requires-reprompt",
              reasonForReprompt: "Stitch failed twice; placeholder rendered for human review.",
              changes: [],
              preservedFonts: [],
              injectedTestIds: [],
            },
          ],
        }),
      ),
    ).toBeNull();
  });
});

// ─── Refinements reject malformed input ─────────────────────────────

describe("pageAdaptationsSchema — refinements", () => {
  it("rejects requires-reprompt without reasonForReprompt", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          pages: [
            {
              pageRoute: "/admin/classes",
              sourceHtmlPath: ".atelier/stitch-html/admin-classes.html",
              generatedPagePath: "app/admin/classes/page.tsx",
              adaptationStatus: "requires-reprompt",
              changes: [],
              preservedFonts: [],
              injectedTestIds: [],
            },
          ],
        }),
      ),
    ).toMatch(/reasonForReprompt|10 chars/);
  });

  it("rejects requires-reprompt with reasonForReprompt shorter than 10 chars", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          pages: [
            {
              pageRoute: "/admin/classes",
              sourceHtmlPath: ".atelier/stitch-html/admin-classes.html",
              generatedPagePath: "app/admin/classes/page.tsx",
              adaptationStatus: "requires-reprompt",
              reasonForReprompt: "short",
              changes: [],
              preservedFonts: [],
              injectedTestIds: [],
            },
          ],
        }),
      ),
    ).toMatch(/reasonForReprompt|10 chars/);
  });

  it("rejects replaced-with-shadcn change with rationale shorter than 20 chars", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          pages: [
            {
              pageRoute: "/",
              sourceHtmlPath: ".atelier/stitch-html/home.html",
              generatedPagePath: "app/page.tsx",
              adaptationStatus: "clean",
              changes: [
                {
                  type: "replaced-with-shadcn",
                  targetSelector: "div.combobox",
                  rationale: "needed shadcn",
                },
              ],
              preservedFonts: [],
              injectedTestIds: [],
            },
          ],
        }),
      ),
    ).toMatch(/replaced-with-shadcn|20 chars/);
  });

  it("accepts replaced-with-shadcn change with rationale ≥20 chars", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          pages: [
            {
              pageRoute: "/",
              sourceHtmlPath: ".atelier/stitch-html/home.html",
              generatedPagePath: "app/page.tsx",
              adaptationStatus: "clean",
              changes: [
                {
                  type: "replaced-with-shadcn",
                  targetSelector: "div.combobox",
                  rationale: "Original element was a div-based combobox without keyboard navigation; shadcn <Select> provides accessible state machine.",
                },
              ],
              preservedFonts: [],
              injectedTestIds: [],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("accepts mounted-canonical-form change (B-w4-9 R6 carve-out)", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          pages: [
            {
              pageRoute: "/sign-in",
              sourceHtmlPath: ".atelier/stitch-html/sign-in.html",
              generatedPagePath: "app/sign-in/page.tsx",
              adaptationStatus: "clean",
              changes: [
                {
                  type: "mounted-canonical-form",
                  targetSelector: "form[data-testid=\"signin-form\"]",
                  rationale: "Mounted canonical LoginForm from forms-validations; Stitch <form> subtree replaced, container/styles preserved.",
                },
              ],
              preservedFonts: [],
              injectedTestIds: [],
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("rejects duplicate pageRoute in pages[]", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          pages: [
            {
              pageRoute: "/",
              sourceHtmlPath: ".atelier/stitch-html/home.html",
              generatedPagePath: "app/page.tsx",
              adaptationStatus: "clean",
              changes: [],
              preservedFonts: [],
              injectedTestIds: [],
            },
            {
              pageRoute: "/",
              sourceHtmlPath: ".atelier/stitch-html/home-dup.html",
              generatedPagePath: "app/dup/page.tsx",
              adaptationStatus: "clean",
              changes: [],
              preservedFonts: [],
              injectedTestIds: [],
            },
          ],
        }),
      ),
    ).toMatch(/duplicate pageRoute/);
  });

  it("rejects sourceHtmlPath not under .atelier/stitch-html/", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          pages: [
            {
              pageRoute: "/",
              sourceHtmlPath: "html/home.html" as never,
              generatedPagePath: "app/page.tsx",
              adaptationStatus: "clean",
              changes: [],
              preservedFonts: [],
              injectedTestIds: [],
            },
          ],
        }),
      ),
    ).toMatch(/sourceHtmlPath/);
  });

  it("rejects generatedPagePath that doesn't match app/...page.tsx", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          pages: [
            {
              pageRoute: "/",
              sourceHtmlPath: ".atelier/stitch-html/home.html",
              generatedPagePath: "src/pages/home.tsx" as never,
              adaptationStatus: "clean",
              changes: [],
              preservedFonts: [],
              injectedTestIds: [],
            },
          ],
        }),
      ),
    ).toMatch(/generatedPagePath/);
  });

  it("rejects injectedTestIds entry that is not kebab-case", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          pages: [
            {
              pageRoute: "/",
              sourceHtmlPath: ".atelier/stitch-html/home.html",
              generatedPagePath: "app/page.tsx",
              adaptationStatus: "clean",
              changes: [],
              preservedFonts: [],
              injectedTestIds: ["HeaderRoot" as string],
            },
          ],
        }),
      ),
    ).toMatch(/injectedTestIds/);
  });

  it("rejects preservedFonts entry that is not a valid URL", () => {
    expect(
      validatePageAdaptations(
        adaptation({
          pages: [
            {
              pageRoute: "/",
              sourceHtmlPath: ".atelier/stitch-html/home.html",
              generatedPagePath: "app/page.tsx",
              adaptationStatus: "clean",
              changes: [],
              preservedFonts: ["not-a-url"],
              injectedTestIds: [],
            },
          ],
        }),
      ),
    ).toMatch(/preservedFonts|url/i);
  });
});

// ─── B-w4-11 regression — the exact F3-run-11 schema drift ───────────

describe("pageAdaptationsSchema — B-w4-11 regression (F3-run-11 drift)", () => {
  it("rejects the exact run-11 shape with field-specific errors (outputPath / adaptationStatus / rationale)", () => {
    // Faithful synthesis of out/yoga-regen-v3-2026-05-18T09-18-29's
    // page-adaptations.json: outputPath instead of generatedPagePath,
    // adaptationStatus="adapted" (invalid enum), a change with no rationale,
    // and invented top-level keys. Cast through unknown — this is exactly
    // the malformed shape the LLM emitted, not a typed object.
    const runEleven = {
      generatedAt: "2026-05-18T10:31:27.000Z",
      stitchHealth: "clean",
      agent: "visual-adapter",
      summary: "adapted 15 pages",
      preservedDesignStrategy: "literal-stitch",
      rootLayout: "app/layout.tsx",
      layouts: ["app/(standalone)/layout.tsx"],
      notes: ["R5: zero replaced-with-shadcn"],
      pages: [
        {
          pageRoute: "/sign-in",
          layoutGroup: "(standalone)",
          renderMode: "client",
          adaptationStatus: "adapted",
          sourceHtmlPath: ".atelier/stitch-html/sign-in.html",
          outputPath: "app/(standalone)/sign-in/page.tsx",
          metadata: { title: "Entrar" },
          injectedTestIds: ["signin-form"],
          preservedFonts: [],
          changes: [
            {
              type: "injected-test-id",
              targetSelector: "header",
              after: "header-root (R4)",
            },
          ],
        },
      ],
    } as unknown;
    const err = validatePageAdaptations(runEleven);
    expect(err).not.toBeNull();
    expect(err).toMatch(/generatedPagePath/);
    expect(err).toMatch(/adaptationStatus/);
    expect(err).toMatch(/rationale/);
  });

  it("rejects invented top-level keys (.strict) — the run-11 drift class", () => {
    const withExtraKey = {
      ...adaptation(),
      summary: "this top-level key is not in the schema",
    } as unknown;
    const err = validatePageAdaptations(withExtraKey);
    expect(err).not.toBeNull();
    expect(err).toMatch(/[Uu]nrecognized key|summary/);
  });

  it("rejects a change missing rationale, for any change type", () => {
    const noRationale = adaptation({
      pages: [
        {
          pageRoute: "/",
          sourceHtmlPath: ".atelier/stitch-html/home.html",
          generatedPagePath: "app/page.tsx",
          adaptationStatus: "clean",
          changes: [
            // @ts-expect-error — intentionally missing required `rationale`
            { type: "injected-test-id", targetSelector: "header" },
          ],
          preservedFonts: [],
          injectedTestIds: [],
        },
      ],
    });
    const err = validatePageAdaptations(noRationale);
    expect(err).not.toBeNull();
    expect(err).toMatch(/rationale/);
  });
});
