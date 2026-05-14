import { z } from "zod";

/**
 * `.atelier/stitch-analysis.json` — Layout Architect (v3 wave 2).
 *
 * MANIFEST of the Stitch design output. Stitch produces HTML/CSS that IS
 * the canonical look of the generated app; this artifact records WHERE
 * that HTML lives on disk, plus the minimal metadata downstream agents
 * need to adapt it without re-authoring.
 *
 * The HTML is persisted LITERALLY under `.atelier/stitch-html/<slug>.html`
 * and the Visual Adapter (wave-4-frontend) consumes it directly, preserving
 * Stitch's CSS as-is.
 *
 * Why colorTokens[] and typographyTokens[] still exist:
 * ─────────────────────────────────────────────────────
 * They are KEPT here SOLELY to theme the handful of shadcn primitives that
 * the Visual Adapter may inject as last-resort replacements (e.g. when a
 * Stitch <input> genuinely cannot fulfil its function). They are NOT used
 * to reconstruct the app's theme / Tailwind config — that would be the
 * old "parse the HTML and re-author in shadcn" model that this rework
 * explicitly retires. The canonical style of the generated app is the
 * preserved CSS of Stitch, not these tokens.
 *
 * What this schema deliberately DROPPED in the rework:
 * ─────────────────────────────────────────────────────
 * - The recursive `Section` tree + `LayoutPrimitive` enum + `SectionPadding`.
 *   Nobody consumes a semantic decomposition anymore; the Adapter reads
 *   the HTML directly.
 * - The `rootSection` field per page. Replaced by `rawHtmlPath`.
 *
 * Authoritative reference: `ROADMAP_V3.md` § 3.2 + § 4.1 (re-interpreted
 * post-rework: "Stitch HTML is preserved, not parsed-and-discarded").
 */

// ─── Tokens (theming-only, see header) ──────────────────────────────

const colorTokenSchema = z
  .object({
    role: z.enum([
      "primary",
      "secondary",
      "accent",
      "background",
      "foreground",
      "muted",
      "border",
      "destructive",
      "success",
      "warning",
    ]),
    /** Hex string `#rrggbb`. */
    value: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** Optional Tailwind-ish hint like "emerald-600" or "slate-50". */
    hint: z.string().optional(),
  })
  .strict();

const typographyTokenSchema = z
  .object({
    role: z.enum([
      "display",
      "heading-1",
      "heading-2",
      "heading-3",
      "body",
      "caption",
      "label",
      "code",
    ]),
    family: z.string().min(1),
    sizePx: z.number().int().positive(),
    weight: z.number().int().min(100).max(900),
    lineHeightPx: z.number().int().positive().optional(),
    letterSpacingEm: z.number().optional(),
  })
  .strict();

// ─── Page entry ─────────────────────────────────────────────────────

const pageAnalysisSchema = z
  .object({
    pageRoute: z.string().regex(/^\/.*/),
    /** Mockup PNG path under .atelier/stitch-mockups/<slug>.png. */
    mockupPath: z
      .string()
      .regex(
        /^\.atelier\/stitch-mockups\/.+\.png$/,
        "mockupPath must live under .atelier/stitch-mockups/",
      ),
    /**
     * Literal HTML Stitch returned for this page, persisted to disk so the
     * Visual Adapter can read it directly. Path is POSIX-style relative to
     * workDir, under .atelier/stitch-html/<slug>.html.
     */
    rawHtmlPath: z
      .string()
      .regex(
        /^\.atelier\/stitch-html\/.+\.html$/,
        "rawHtmlPath must live under .atelier/stitch-html/",
      ),
    /** Stitch screen id (for re-fetching via get_screen). */
    stitchScreenId: z.string().min(1),
    /**
     * URLs of <link rel="stylesheet"> entries (typically Google Fonts) that
     * Stitch embedded in this screen. The Visual Adapter MUST preserve these
     * in the corresponding Next.js layout.tsx <head> so web fonts load.
     * Empty array is valid only when Stitch used 100% system fonts.
     */
    linkedFonts: z.array(z.string().url()),
  })
  .strict();

// ─── Full artifact ──────────────────────────────────────────────────

export const stitchAnalysisSchema = z
  .object({
    generatedAt: z.string().datetime(),
    stitchProjectId: z.string().min(1),
    designVibe: z.enum(["Linear", "Stripe", "Notion", "Vercel", "Calm"]),
    /**
     * Re-prompt attempt counter (0 = first attempt, 1 = first reprompt,
     * 2 = second reprompt / final). Persisted to support the completeness
     * loop. Max is 2 — see `stitch-completeness-scanner.ts` plan B.
     */
    stitchAttempt: z.number().int().min(0).max(2),
    /**
     * Health flag set when the completeness scanner kept finding gaps after
     * max reprompts. When `degraded`, the orchestrator marks the run with
     * `requires_human_review: true` and the Visual Adapter generates
     * <StitchFailurePlaceholder> components for missing pages.
     */
    stitchHealth: z.enum(["clean", "degraded"]),
    colorTokens: z
      .array(colorTokenSchema)
      .min(5, "at least 5 color tokens (background, foreground, primary, muted, border)"),
    typographyTokens: z
      .array(typographyTokenSchema)
      .min(3, "at least 3 typography tokens (heading, body, caption)"),
    pages: z.array(pageAnalysisSchema).min(1),
    designMdPath: z
      .string()
      .regex(/^\.atelier\/stitch-design\.md$/, "designMdPath must equal .atelier/stitch-design.md"),
  })
  .strict()
  // Token coverage: roles primary, background and foreground are mandatory.
  .refine(
    (s) =>
      ["primary", "background", "foreground"].every((role) =>
        s.colorTokens.some((c) => c.role === role),
      ),
    "color tokens must include primary, background, and foreground roles",
  )
  // Typography coverage: at least one heading + body.
  .refine(
    (s) =>
      s.typographyTokens.some((t) => t.role === "body") &&
      s.typographyTokens.some((t) => t.role.startsWith("heading")),
    "typography tokens must include body + at least one heading-*",
  )
  // No duplicate pageRoute in pages[]
  .refine(
    (s) => new Set(s.pages.map((p) => p.pageRoute)).size === s.pages.length,
    "duplicate pageRoute in pages[]",
  );

export type ColorToken = z.infer<typeof colorTokenSchema>;
export type TypographyToken = z.infer<typeof typographyTokenSchema>;
export type PageAnalysis = z.infer<typeof pageAnalysisSchema>;
export type StitchAnalysis = z.infer<typeof stitchAnalysisSchema>;

export function validateStitchAnalysis(input: unknown): string | null {
  const r = stitchAnalysisSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
