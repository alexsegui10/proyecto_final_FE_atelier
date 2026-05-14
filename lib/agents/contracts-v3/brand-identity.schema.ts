import { z } from "zod";

/**
 * `.atelier/brand-identity.json` — Brand Identity Agent (v3 wave 2, REDUCED).
 *
 * Post-rework responsibility (Stitch-preserves-design architecture):
 *  - Brand assets: name, tagline, voice, tone, logo.
 *  - Microcopy: the dotted-keyed dictionary every user-visible string in the
 *    generated app must come from. STILL the single source of truth.
 *  - Tentative hints (palette + fonts) that Layout Architect concatenates to
 *    the Stitch prompt as suggestions. **Stitch decides the final look.**
 *
 * Removed in the rework:
 *  - 17-slot canonical palette → Stitch produces the final CSS in HTML.
 *  - Typography {fontFamilies, scale, weights, webFonts} canonical → Stitch
 *    decides families + sizes + weights in the HTML it generates.
 *  - WCAG enforcement here → re-located to a post-wave-4-frontend gate that
 *    audits the adapted CSS (and to the Accessibility Agent paso 8 as
 *    independent second layer).
 *  - silent-font-fallback closure here → re-located to the Layout Architect
 *    R4-bis + stitch-analysis.pages[].linkedFonts + Visual Adapter font
 *    preservation + runtime-smoke-gate HTTP 200 check (4-layer defense
 *    instead of the previous 3-layer).
 *
 * What this schema deliberately KEEPS:
 *  - Microcopy with strict coverage refinements (≥30 keys, ≥8 categories).
 *    Microcopy fragmentation was the v2 bug we are still closing here.
 *  - Brand voice/tone enums + logo discriminated union (wordmark|svg).
 *  - i18nLocales forward-compat (still not exercised in v3 paso 6).
 *
 * Authoritative reference: `ROADMAP_V3.md` § 3.3 (re-interpreted post-rework).
 */

// ─── Voice + tone enums ──────────────────────────────────────────────

export const BRAND_VOICES = ["calm", "warm", "professional", "playful", "minimal"] as const;
export const BRAND_TONES = ["friendly", "neutral", "authoritative", "intimate"] as const;
export const VIBE_MOODS = [
  "calm",
  "energetic",
  "trustworthy",
  "playful",
  "premium",
  "minimal",
] as const;

// ─── Hex color primitive ─────────────────────────────────────────────

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb hex string");

// ─── Logo (discriminated union: wordmark OR svg) ─────────────────────

const wordmarkLogoSchema = z
  .object({
    kind: z.literal("wordmark"),
    /** Font family suggestion for the wordmark (a hint for Stitch). */
    font: z.string().min(1),
    /** CSS letter-spacing value, e.g. "-0.02em", "0", "2px". */
    tracking: z
      .string()
      .regex(/^-?\d+(\.\d+)?(em|px|%)?$/, "tracking must be a CSS length")
      .default("0"),
  })
  .strict();

const svgLogoSchema = z
  .object({
    kind: z.literal("svg"),
    /**
     * Inline SVG markup. The schema validates ONLY that the string exists
     * (min 20 chars). It does NOT validate well-formedness, geometry quality,
     * or rendering output.
     */
    inlineSvg: z.string().min(20, "inlineSvg too short to be a real <svg>"),
  })
  .strict();

const logoSchema = z.discriminatedUnion("kind", [wordmarkLogoSchema, svgLogoSchema]);

// ─── Brand block ─────────────────────────────────────────────────────

const brandSchema = z
  .object({
    name: z.string().min(1).max(60),
    tagline: z.string().min(5).max(120),
    voice: z.enum(BRAND_VOICES),
    tone: z.enum(BRAND_TONES),
    logo: logoSchema,
  })
  .strict();

// ─── Tentative hints (consumed by Layout Architect → Stitch prompt) ─

/**
 * Palette HINTS — NOT the final palette. Layout Architect concatenates these
 * into the Stitch prompt as suggestions. Stitch is free to override them.
 * The final canonical palette lives in the HTML/CSS Stitch generates and
 * is preserved literally by the Visual Adapter; this is just creative
 * direction, not a constraint.
 */
const tentativePaletteHintsSchema = z
  .object({
    /** Single seed color suggestion — Stitch may derive a richer palette. */
    primarySeed: hexColor,
    /** Mood descriptor that pairs with the voice/tone of the brand. */
    vibeMood: z.enum(VIBE_MOODS),
    /** Human-readable reason (≥10 chars). Helps Stitch interpret. */
    rationale: z.string().min(10),
  })
  .strict();

/**
 * Typography HINTS — NOT the final font stack. Layout Architect concatenates
 * these into the Stitch prompt; Stitch decides families + sizes + weights
 * in the HTML. The Visual Adapter preserves whatever Stitch chose.
 */
const tentativeFontHintsSchema = z
  .object({
    /** Suggested sans-serif family for body text (e.g. "Inter", "DM Sans"). */
    sansSuggestion: z.string().min(1),
    /** Optional display/headline suggestion (e.g. "Cormorant Garamond"). */
    displaySuggestion: z.string().min(1).optional(),
    /** Human-readable reason for these suggestions. */
    rationale: z.string().min(10),
  })
  .strict();

// ─── Microcopy ───────────────────────────────────────────────────────

/**
 * Canonical top-level microcopy categories. The schema does NOT enforce
 * that all 10 are present — it enforces COVERAGE of at least 8 distinct
 * categories (refinement below). The list below is documentation + a hint
 * for the brand-voice-writing skill template library.
 */
export const MICROCOPY_CATEGORIES = [
  "button",
  "empty-state",
  "error",
  "success",
  "loading",
  "placeholder",
  "tooltip",
  "confirmation",
  "validation",
  "navigation",
] as const;

const microcopySchema = z
  .record(
    z
      .string()
      .regex(
        /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/,
        "microcopy key must be kebab-case dotted, e.g. 'button.primary.submit'",
      ),
    z.string().min(1).max(280),
  )
  .refine(
    (m) => Object.keys(m).length >= 30,
    "microcopy must declare at least 30 keys (real coverage, not 3 demo strings)",
  )
  .refine(
    (m) => {
      const cats = new Set(Object.keys(m).map((k) => k.split(".")[0]));
      return cats.size >= 8;
    },
    "microcopy must cover at least 8 distinct top-level categories (button.*, empty-state.*, error.*, ...)",
  );

// ─── Full artifact ──────────────────────────────────────────────────

export const brandIdentitySchema = z
  .object({
    brand: brandSchema,
    tentativePaletteHints: tentativePaletteHintsSchema,
    tentativeFontHints: tentativeFontHintsSchema,
    microcopy: microcopySchema,
    /**
     * Forward-compatibility only — multi-language support is NOT exercised
     * in v3 paso 6. The agent emits this field only when Discovery explicitly
     * implies multi-language. When set, each entry corresponds to a
     * `.atelier/i18n/<locale>.json` companion file.
     */
    i18nLocales: z
      .array(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "locale must be like 'es' or 'es-AR'"))
      .optional(),
  })
  .strict();

// ─── Exported types ─────────────────────────────────────────────────

export type BrandVoice = (typeof BRAND_VOICES)[number];
export type BrandTone = (typeof BRAND_TONES)[number];
export type VibeMood = (typeof VIBE_MOODS)[number];
export type TentativePaletteHints = z.infer<typeof tentativePaletteHintsSchema>;
export type TentativeFontHints = z.infer<typeof tentativeFontHintsSchema>;
export type Microcopy = z.infer<typeof microcopySchema>;
export type Brand = z.infer<typeof brandSchema>;
export type BrandIdentity = z.infer<typeof brandIdentitySchema>;

// ─── Validator ──────────────────────────────────────────────────────

export function validateBrandIdentity(input: unknown): string | null {
  const r = brandIdentitySchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
