import { z } from "zod";

/**
 * `.atelier/layout-tree.json` — Layout Architect (v3 wave 2).
 *
 * Captures the global visual architecture of the generated app: which page
 * lives under which layout group (public / dashboard / admin / standalone),
 * what header/footer variant it renders, and the navigation surface that
 * appears across the public layout.
 *
 * This artifact closes the bug class E from yoga v2 (home '/' orphan from
 * the public layout, no header) — refinement R0 below blocks the
 * `home === standalone` shape that produced that bug.
 *
 * Authoritative reference: `ROADMAP_V3.md` § 3.2.
 */

// ─── Navigation items ────────────────────────────────────────────────

const navigationItemSchema = z
  .object({
    label: z.string().min(1),
    href: z.string().regex(/^(\/|#).*/, "href must start with / or #"),
    showOnGroups: z
      .array(z.enum(["public", "dashboard", "admin"]))
      .min(1, "every nav item must be visible on at least one layout group"),
    cta: z.boolean().default(false),
    /** Stable id linked to test-id-contract.json. */
    testId: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  })
  .passthrough();

// ─── Page entry ──────────────────────────────────────────────────────

const pageEntrySchema = z
  .object({
    pageRoute: z.string().regex(/^\/.*/),
    layoutGroup: z.enum(["public", "dashboard", "admin", "standalone"]),
    headerVariant: z.enum(["full", "compact", "hidden"]),
    footerVariant: z.enum(["full", "minimal", "hidden"]),
    /** Flag → reviewer in --step-by-step looks here first. */
    esQuestionable: z.boolean(),
    /** Human prose: WHY this layout. Force the LLM to justify, not improvise. */
    rationale: z.string().min(10),
    breadcrumbs: z.boolean().default(false),
    requiresAuth: z.boolean(),
  })
  .strict();

// ─── Layout compositions per group ───────────────────────────────────

const layoutCompositionSchema = z
  .object({
    slots: z
      .array(z.enum(["header", "sidebar", "main", "footer", "breadcrumbs"]))
      .min(2, "every layout must compose at least 2 slots (typical: header + main)"),
    sidebarPosition: z.enum(["left", "right", "none"]).default("none"),
  })
  .strict();

// ─── Layout tree ─────────────────────────────────────────────────────

export const layoutTreeSchema = z
  .object({
    pages: z.array(pageEntrySchema).min(1),
    navigationItems: z.array(navigationItemSchema).min(1),
    defaultHeaderVariant: z.enum(["full", "compact"]),
    layoutCompositions: z.record(
      z.enum(["public", "dashboard", "admin"]),
      layoutCompositionSchema,
    ),
  })
  .strict()
  // R0: the home '/' MUST NOT be standalone (yoga bug class E closure).
  .refine(
    (t) => {
      const home = t.pages.find((p) => p.pageRoute === "/");
      return !home || home.layoutGroup !== "standalone";
    },
    "the home '/' must NOT be standalone (yoga bug class E)",
  )
  // R-nav: every navigationItem.href either resolves to a page OR is a fragment (#)
  .refine(
    (t) =>
      t.navigationItems.every(
        (n) => n.href.startsWith("#") || t.pages.some((p) => p.pageRoute === n.href),
      ),
    "every navigationItem.href must correspond to a page or be a #anchor",
  )
  // R-page-unique: no duplicate pageRoute
  .refine(
    (t) => new Set(t.pages.map((p) => p.pageRoute)).size === t.pages.length,
    "duplicate pageRoute in pages[]",
  )
  // R-private-redirects: privateRoutes must be in dashboard or admin, not public/standalone
  .refine(
    (t) =>
      t.pages.every(
        (p) => !p.requiresAuth || p.layoutGroup === "dashboard" || p.layoutGroup === "admin",
      ),
    "requiresAuth=true pages must live in dashboard or admin layoutGroup",
  );

export type NavigationItem = z.infer<typeof navigationItemSchema>;
export type PageEntry = z.infer<typeof pageEntrySchema>;
export type LayoutComposition = z.infer<typeof layoutCompositionSchema>;
export type LayoutTree = z.infer<typeof layoutTreeSchema>;

export function validateLayoutTree(input: unknown): string | null {
  const r = layoutTreeSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
