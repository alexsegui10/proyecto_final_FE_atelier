import { z } from "zod";

/**
 * Zod schema for `.atelier/components-catalog.json` produced by the UI
 * Components agent (Wave 4). Lists every TSX component the agent wrote,
 * grouped by area (ui primitives, Auth, Layout, Home, Shop, Profile, Admin,
 * Shared). Pages & Routing (also Wave 4) reads this to know which
 * components are available for composing pages.
 */

// The 17 shadcn primitives the UI Components agent must produce on top of
// the 5 already pre-installed in lib/skeleton-v2/client/components/ui/
// (button, card, input, label, badge). The night prompt called them "16
// faltantes" but the actual list has 17 names — checkbox is included.
export const REQUIRED_PRIMITIVES = [
  "dialog",
  "dropdown-menu",
  "form",
  "select",
  "table",
  "tabs",
  "toast",
  "separator",
  "sheet",
  "skeleton",
  "alert",
  "avatar",
  "popover",
  "tooltip",
  "command",
  "calendar",
  "checkbox",
] as const;

const componentEntrySchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, "must be PascalCase"),
    path: z
      .string()
      .regex(/^client\/components\/.+\.tsx$/, "must live under client/components/"),
    area: z.enum(["ui", "Auth", "Layout", "Home", "Shop", "Profile", "Admin", "Shared", "forms"]),
    states: z.array(z.string().min(1)).optional(),
    appliesDesignTokens: z.boolean().optional(),
  })
  .passthrough();

// Primitives may be flat strings ("dialog") or objects with name + path
// + source metadata. Extract the canonical name for the required-primitives
// invariant check.
const primitiveEntrySchema = z.union([
  z.string().min(1),
  z.object({ name: z.string().min(1) }).passthrough(),
]);

function primitiveName(p: z.infer<typeof primitiveEntrySchema>): string {
  return typeof p === "string" ? p : p.name;
}

export const componentsCatalogSchema = z
  .object({
    primitives: z
      .array(primitiveEntrySchema)
      .refine(
        (list) => REQUIRED_PRIMITIVES.every((p) => list.map(primitiveName).includes(p)),
        `must include all 17 primitives: ${REQUIRED_PRIMITIVES.join(", ")}`,
      ),
    components: z.array(componentEntrySchema).min(20),
  })
  .passthrough();

export type ComponentsCatalog = z.infer<typeof componentsCatalogSchema>;

export function validateComponentsCatalog(input: unknown): string | null {
  const r = componentsCatalogSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
