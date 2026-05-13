import { z } from "zod";

/**
 * `.atelier/stitch-analysis.json` — Layout Architect (v3 wave 2).
 *
 * Parsed (NOT literal) representation of the Stitch design output. The HTML
 * Stitch returns is processed through cheerio + heuristics into a clean
 * hierarchical structure that UI Components (v3 future) consumes to emit
 * JSX with the right primitives + tokens.
 *
 * Section is recursive — we declare the TypeScript shape explicitly with
 * `z.ZodType<Section>` so consumers (UI Components) get full type safety
 * instead of the `unknown` that `z.lazy()` alone produces.
 *
 * Authoritative reference: `ROADMAP_V3.md` § 3.2 + § 4.1.
 */

// ─── Section (recursive, explicitly typed) ──────────────────────────

export type LayoutPrimitive = "stack" | "grid" | "flex-row" | "flex-col" | "absolute";

export interface SectionPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Section {
  /** Stable id used by cross-references + test-id derivation. */
  id: string;
  /** Semantic intent: "hero" | "feature-grid" | "pricing-table" | ... */
  purpose: string;
  /** Layout primitive Stitch chose (mapped from CSS classes). */
  layoutPrimitive: LayoutPrimitive;
  /** Grid column count when layoutPrimitive === "grid". */
  columns?: number;
  /** Inter-child gap in pixels. */
  gapPx?: number;
  paddingPx?: SectionPadding;
  /** Children sections — recursive. */
  children?: Section[];
}

const paddingSchema = z
  .object({
    top: z.number().int().nonnegative(),
    right: z.number().int().nonnegative(),
    bottom: z.number().int().nonnegative(),
    left: z.number().int().nonnegative(),
  })
  .strict();

const layoutPrimitiveSchema = z.enum([
  "stack",
  "grid",
  "flex-row",
  "flex-col",
  "absolute",
]);

// Explicit ZodType<Section> so the consumer side gets the inference correctly.
export const sectionSchema: z.ZodType<Section> = z.lazy(() =>
  z
    .object({
      id: z.string().regex(/^[a-z][a-z0-9-]*$/, "section id must be kebab-case"),
      purpose: z.string().min(3),
      layoutPrimitive: layoutPrimitiveSchema,
      columns: z.number().int().min(1).max(12).optional(),
      gapPx: z.number().int().nonnegative().optional(),
      paddingPx: paddingSchema.optional(),
      children: z.array(sectionSchema).optional(),
    })
    .passthrough(),
);

// ─── Tokens ─────────────────────────────────────────────────────────

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

// ─── Page analysis ──────────────────────────────────────────────────

const pageAnalysisSchema = z
  .object({
    pageRoute: z.string().regex(/^\/.*/),
    /** Path inside the workDir (POSIX-style). */
    mockupPath: z
      .string()
      .regex(/^\.atelier\/stitch-mockups\/.+\.png$/, "mockupPath must live under .atelier/stitch-mockups/"),
    /** Stitch screen id (for re-fetching via get_screen). */
    stitchScreenId: z.string().min(1),
    rootSection: sectionSchema,
  })
  .strict();

// ─── Full artifact ──────────────────────────────────────────────────

export const stitchAnalysisSchema = z
  .object({
    generatedAt: z.string().datetime(),
    stitchProjectId: z.string().min(1),
    designVibe: z.enum(["Linear", "Stripe", "Notion", "Vercel", "Calm"]),
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
