import { z } from "zod";

/**
 * Zod schema for `.atelier/pages-routing.json` produced by the Pages &
 * Routing agent (Wave 4). Lists every Next.js App Router page + layout +
 * special file (loading, error, not-found), grouped by access level
 * (public / dashboard / admin), each with metadata and a flag for
 * Server vs Client component.
 */

const pageSchema = z
  .object({
    name: z.string().min(1),
    route: z.string().regex(/^\/.*/),
    file: z
      .string()
      .regex(/^app\//, "file path must start with app/"),
    component: z.enum(["server", "client"]),
    access: z.enum(["public", "private", "admin"]),
    metadataTitle: z.string().min(1),
    metadataDescription: z.string().optional(),
    suspense: z.boolean().optional(),
    errorBoundary: z.boolean().optional(),
  })
  .passthrough();

const layoutSchema = z
  .object({
    // accepts both `app/layout.tsx` (root) and `app/(group)/layout.tsx`
    file: z.string().regex(/^app\/.*layout\.tsx$/),
    wraps: z.enum(["public", "private", "admin", "root"]),
    component: z.enum(["server", "client"]),
  })
  .passthrough();

export const pagesRoutingSchema = z
  .object({
    pages: z.array(pageSchema).min(1),
    layouts: z.array(layoutSchema).min(1),
    // LLM emits either flat string paths or `{ file, purpose }` objects.
    specialFiles: z
      .array(
        z.union([
          z.string().regex(/^app\//),
          z
            .object({ file: z.string().regex(/^app\//) })
            .passthrough(),
        ]),
      )
      .min(1),
  })
  .passthrough();

export type PagesRouting = z.infer<typeof pagesRoutingSchema>;

export function validatePagesRouting(input: unknown): string | null {
  const r = pagesRoutingSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
