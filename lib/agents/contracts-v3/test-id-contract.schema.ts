import { z } from "zod";

/**
 * `.atelier/test-id-contract.json` — Layout Architect (v3 wave 2).
 *
 * Declares the `data-testid` selectors that UI Components (v3 future rework)
 * MUST emit on specific components or layout wrappers. Visual QA reads this
 * to drive Playwright with stable selectors instead of falling back to
 * role/label/text (D2 closure).
 *
 * Authoritative reference: `ROADMAP_V3.md` § 3.2 + PENDING_V3_DECISIONS.md D2.
 */

/**
 * Three scopes a critical selector can live at:
 *
 *   - `layoutGroup` — universal in that group (e.g. `header-root` in every
 *     `public` page). The Stitch completeness scanner can verify these
 *     directly against the layout-tree.
 *   - `pageRoute`   — local to one specific page (e.g. `signin-form` in
 *     `/sign-in`). The scanner finds the page in layout-tree and verifies.
 *   - `component`   — transversal, no fixed route (e.g. `admin-create-class`
 *     where the create button may live in the page OR a modal). Verified
 *     by a wave-4-presentation scanner that has the component↔page map.
 *
 * The scanner reports a single warn-summary listing component-scoped
 * entries deferred to wave-4 — silence is the failure mode we are
 * explicitly retiring (B1 of the F3 first-real-run triage).
 */
const requiredOnSchema = z
  .object({
    /** PascalCase component name owned by UI Components. */
    component: z
      .string()
      .regex(/^[A-Z][A-Za-z0-9]*$/, "component must be PascalCase")
      .optional(),
    /** Layout group owned by Layout Architect (renders the wrapper). */
    layoutGroup: z.enum(["public", "dashboard", "admin", "standalone"]).optional(),
    /** Single page route the selector is local to (e.g. "/sign-in", "/"). */
    pageRoute: z
      .string()
      .regex(/^\/.*/, "pageRoute must start with '/'")
      .optional(),
  })
  .strict()
  .refine(
    (r) =>
      r.component !== undefined ||
      r.layoutGroup !== undefined ||
      r.pageRoute !== undefined,
    "requiredOn must specify at least one of: component, layoutGroup, pageRoute",
  );

const testIdEntrySchema = z
  .object({
    /** The kebab-case selector. Emitted as `data-testid="{selector}"`. */
    selector: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/, "selector must be kebab-case"),
    purpose: z.string().min(10),
    requiredOn: requiredOnSchema,
    /**
     * - critical: Visual QA fails the flow if selector missing
     * - recommended: VQA falls back + emits selector-flaky warn
     * - optional: nice to have, no warning if missing
     */
    criticality: z.enum(["critical", "recommended", "optional"]),
    /** Which visual-qa flows depend on this selector. */
    consumedByFlow: z
      .array(z.enum(["client-anonymous", "client-authenticated", "admin"]))
      .min(1),
  })
  .strict();

export const testIdContractSchema = z
  .object({
    generatedAt: z.string().datetime(),
    entries: z
      .array(testIdEntrySchema)
      .min(5, "at least 5 critical selectors (auth + nav + main CTAs)"),
  })
  .strict()
  .refine(
    (c) => new Set(c.entries.map((e) => e.selector)).size === c.entries.length,
    "duplicate selector in entries[]",
  );

export type TestIdEntry = z.infer<typeof testIdEntrySchema>;
export type TestIdContract = z.infer<typeof testIdContractSchema>;

export function validateTestIdContract(input: unknown): string | null {
  const r = testIdContractSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
