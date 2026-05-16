import { z } from "zod";

import { REQUIRED_PRIMITIVES } from "../contracts-v2/components-catalog.schema";

/**
 * Reduced v3 schema for `.atelier/components-catalog.json`.
 *
 * v3 rework: the v2 UI Components agent had two blocks — (A) the 17 shadcn
 * primitives, and (B) ~60-90 area components synthesised from
 * `screens-map.componentSpecs`. Block B is the exact v2 design re-authoring
 * bug the Stitch-preserve rework closes (visual-adapter R0): in v3,
 * visual-adapter renders each page from Stitch HTML literally, so there is
 * nothing to compose from a semantic component tree. Block B is removed.
 *
 * The v3 UI Components agent emits ONLY Block A. The v2 schema is unusable
 * here because it requires `components: z.array(...).min(20)` (Block B);
 * this reduced schema requires the 17 primitives and makes `components`
 * optional (kept for traceability only — no agent reads it downstream once
 * pages-routing is removed; visual-adapter R5 depends on the primitive
 * `.tsx` files on disk, not this JSON).
 *
 * `REQUIRED_PRIMITIVES` is imported from the v2 schema as the single
 * source of truth for the canonical 17-primitive list (data, not
 * behaviour — avoids drift).
 */

const primitiveEntrySchema = z.union([
  z.string().min(1),
  z.object({ name: z.string().min(1) }).passthrough(),
]);

function primitiveName(p: z.infer<typeof primitiveEntrySchema>): string {
  return typeof p === "string" ? p : p.name;
}

const reducedComponentEntrySchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, "must be PascalCase"),
    path: z
      .string()
      .regex(/^client\/components\/.+\.tsx$/, "must live under client/components/"),
    area: z.enum(["ui", "Shared"]),
    states: z.array(z.string().min(1)).optional(),
    appliesDesignTokens: z.boolean().optional(),
  })
  .passthrough();

export const componentsCatalogV3Schema = z
  .object({
    primitives: z
      .array(primitiveEntrySchema)
      .refine(
        (list) => REQUIRED_PRIMITIVES.every((p) => list.map(primitiveName).includes(p)),
        `must include all 17 primitives: ${REQUIRED_PRIMITIVES.join(", ")}`,
      ),
    /**
     * Reduced role: no Block B area components. Optional, defaults to [].
     * Kept only so QA/traceability tooling can record what was emitted.
     */
    components: z.array(reducedComponentEntrySchema).optional().default([]),
  })
  .passthrough();

export type ComponentsCatalogV3 = z.infer<typeof componentsCatalogV3Schema>;

/** Boundary validator (B-w4-5b pattern): null when valid, else error string. */
export function validateComponentsCatalogV3(input: unknown): string | null {
  const r = componentsCatalogV3Schema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
