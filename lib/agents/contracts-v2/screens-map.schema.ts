import { z } from "zod";

/**
 * Zod schema for `.atelier/screens-map.json` produced by the UX/UI Designer
 * agent. The screen list and componentSpecs are the contract the UI
 * Components, Forms & Validations, and Pages & Routing agents (Wave 4)
 * read in to generate concrete `.tsx` files.
 *
 * Constraint mins (≥6 screens, ≥15 component specs) are enforced via
 * `.min()` so a thin output fails fast.
 */

const sectionSchema = z
  .object({
    type: z.string().min(1),
    content: z.string().optional(),
    items: z.union([z.number().int().nonnegative(), z.string()]).optional(),
    layout: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

const screenSchema = z
  .object({
    name: z.string().min(1),
    route: z.string().regex(/^\/.*/, "route must start with /"),
    access: z.enum(["public", "private", "admin"]),
    purpose: z.string().min(8),
    sections: z.array(sectionSchema).min(1),
    components: z.array(z.string().min(1)).min(1),
    interactions: z.array(z.string().min(1)).min(1),
    states: z.array(z.string().min(1)).optional(),
  })
  .strict();

const componentSpecSchema = z
  .object({
    anatomy: z.string().min(1),
    states: z.array(z.string().min(1)).min(1),
    interactions: z.string().min(1),
    responsiveBehavior: z.string().min(1),
    notes: z.string().optional(),
  })
  .strict();

export const screensMapSchema = z
  .object({
    screens: z.array(screenSchema).min(6, "at least 6 screens required"),
    componentSpecs: z
      .record(z.string(), componentSpecSchema)
      .refine(
        (specs) => Object.keys(specs).length >= 15,
        "at least 15 component specs required",
      ),
  })
  .strict();

export type ScreensMap = z.infer<typeof screensMapSchema>;
export type Screen = z.infer<typeof screenSchema>;
export type ComponentSpec = z.infer<typeof componentSpecSchema>;

export function validateScreensMap(input: unknown): string | null {
  const r = screensMapSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
