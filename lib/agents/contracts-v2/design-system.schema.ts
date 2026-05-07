import { z } from "zod";

/**
 * Zod schema for `.atelier/design-system.json` produced by the UX/UI Designer
 * agent. Downstream agents (UI Components, Pages & Routing, Forms &
 * Validations) read this artifact and assume every field is present, so
 * keep the schema strict and the agent prompt explicit.
 *
 * Hex / rgb / hsl / rgba / oklch / `transparent` / `currentColor` / Tailwind
 * tokens are all valid color values — we keep the regex permissive but
 * non-empty so the agent can't slip in undefined.
 */
const colorString = z.string().min(1, "color value cannot be empty");

export const VIBE_NAMES = ["Linear", "Stripe", "Notion", "Vercel", "Calm"] as const;

export const designSystemSchema = z
  .object({
    inspiration: z
      .string()
      .min(1, "inspiration tag is required (e.g. 'Linear' or 'Calm yoga + Stripe trust')"),
    vibe: z.enum(VIBE_NAMES),
    palette: z
      .object({
        background: z.object({
          default: colorString,
          elevated: colorString,
          subtle: colorString,
        }),
        border: z.object({
          subtle: colorString,
          default: colorString,
        }),
        text: z.object({
          primary: colorString,
          secondary: colorString,
          muted: colorString,
        }),
        brand: z.object({
          primary: colorString,
          secondary: colorString,
        }),
        feedback: z.object({
          success: colorString,
          warning: colorString,
          error: colorString,
          info: colorString,
        }),
      })
      .strict(),
    typography: z
      .object({
        body: z.string().min(1),
        display: z.string().min(1),
        mono: z.string().min(1),
        scale: z
          .object({
            xs: z.string().min(1),
            sm: z.string().min(1),
            base: z.string().min(1),
            lg: z.string().min(1),
            xl: z.string().min(1),
            "2xl": z.string().min(1),
            "3xl": z.string().min(1),
          })
          .strict(),
        weight: z
          .object({
            regular: z.number().int().positive(),
            medium: z.number().int().positive(),
            semibold: z.number().int().positive(),
            bold: z.number().int().positive(),
          })
          .strict(),
      })
      .strict(),
    spacing: z
      .object({
        xs: z.string().min(1),
        sm: z.string().min(1),
        md: z.string().min(1),
        lg: z.string().min(1),
        xl: z.string().min(1),
        "2xl": z.string().min(1),
      })
      .strict(),
    radius: z
      .object({
        sm: z.string().min(1),
        md: z.string().min(1),
        lg: z.string().min(1),
        xl: z.string().min(1),
        full: z.string().min(1),
      })
      .strict(),
    shadows: z
      .object({
        sm: z.string().min(1),
        md: z.string().min(1),
        lg: z.string().min(1),
      })
      .strict(),
    motion: z
      .object({
        duration: z.object({
          fast: z.string().min(1),
          base: z.string().min(1),
          slow: z.string().min(1),
        }),
        easing: z.object({
          default: z.string().min(1),
          spring: z.string().min(1),
        }),
      })
      .strict(),
  })
  .strict();

export type DesignSystem = z.infer<typeof designSystemSchema>;
export type Vibe = (typeof VIBE_NAMES)[number];

/** Adapter for the runner's `validateArtifact` callback. */
export function validateDesignSystem(input: unknown): string | null {
  const r = designSystemSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
