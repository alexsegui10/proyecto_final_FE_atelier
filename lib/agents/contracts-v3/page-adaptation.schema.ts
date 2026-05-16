import { z } from "zod";

/**
 * `.atelier/page-adaptations.json` — Visual Adapter (v3 wave-4-frontend).
 *
 * Manifest of how each page from `stitch-analysis.pages[]` was transformed
 * into a functional React/Next.js page WHILE PRESERVING the look Stitch
 * produced. The Visual Adapter:
 *
 *   1. Reads the HTML literal from `.atelier/stitch-html/<slug>.html`.
 *   2. Inserts `data-testid` attributes from `test-id-contract.json`.
 *   3. Substitutes placeholder text with `microcopy.<key>` from
 *      `brand-identity.json`.
 *   4. Wires data fetching, form handlers and auth using `api-contract.json`.
 *   5. Preserves `<link rel="stylesheet">` font URLs from
 *      `stitch-analysis.pages[].linkedFonts[]` in `app/layout.tsx`.
 *   6. Writes the result to `app/<route>/page.tsx`.
 *
 * What the Visual Adapter NEVER does:
 *   - Re-author the look in shadcn / re-write the CSS.
 *   - Replace native form elements (<input>, <select>, <textarea>) with
 *     shadcn primitives by default — see R5 INVERTED in the prompt.
 *     Swapping to shadcn is "last resort only" and registered as an
 *     explicit AdaptationChange of type `replaced-with-shadcn`.
 *   - Delete sections from the HTML. If a section cannot be wired, it
 *     remains visible and a warning is emitted.
 *
 * When the orchestrator activated plan B (`stitchHealth: "degraded"`),
 * pages missing from `stitch-analysis.pages[]` get a placeholder
 * adaptation with `adaptationStatus: "requires-reprompt"` and
 * `reasonForReprompt` describing what Stitch failed to produce.
 *
 * Authoritative reference: `ROADMAP_V3.md` § 5.1 (rework reinterpretation).
 */

// ─── Adaptation change taxonomy ─────────────────────────────────────

export const ADAPTATION_CHANGE_TYPES = [
  /** Native control wired with onChange/onSubmit/value but NOT replaced. */
  "static-to-interactive",
  /** Hardcoded list / mock data replaced by useQuery + map (or RSC fetch). */
  "wired-data",
  /** Sign-in / sign-out button wired to real auth handler. */
  "wired-auth",
  /** <form> wired with useForm + zod schema + submit handler. */
  "wired-form",
  /** Lorem ipsum / placeholder text replaced with microcopy.<key>. */
  "injected-microcopy",
  /** data-testid attribute inserted from test-id-contract.json. */
  "injected-test-id",
  /** <link rel="stylesheet"> font URL copied to app/layout.tsx <head>. */
  "preserved-font-link",
  /**
   * LAST RESORT: a Stitch element replaced by a shadcn primitive because
   * the original genuinely could not fulfil its function (e.g. custom
   * combobox that has no accessible state machine). This IS a look
   * change — must be explicit, justified, and accepted as a trade-off.
   */
  "replaced-with-shadcn",
  /** `export const metadata: Metadata` injected into a page (R11, absorbed from pages-routing). */
  "injected-metadata",
  /** App-level special file generated: not-found / error / loading (R12, absorbed from pages-routing). */
  "generated-special-file",
] as const;

const adaptationChangeSchema = z
  .object({
    type: z.enum(ADAPTATION_CHANGE_TYPES),
    /** CSS selector inside the source HTML, pointing at the affected node. */
    targetSelector: z.string().min(1),
    /**
     * Short rationale (≥10 chars). For `replaced-with-shadcn` this must
     * explain why the Stitch element couldn't fulfil its function.
     */
    rationale: z.string().min(10),
    /** Optional before/after snippet for traceability. */
    before: z.string().optional(),
    after: z.string().optional(),
  })
  .strict();

// ─── Per-page adaptation ────────────────────────────────────────────

export const ADAPTATION_STATUSES = ["clean", "partial", "requires-reprompt"] as const;

const pageAdaptationSchema = z
  .object({
    pageRoute: z.string().regex(/^\/.*/),
    /** Source HTML path under `.atelier/stitch-html/`. */
    sourceHtmlPath: z
      .string()
      .regex(
        /^\.atelier\/stitch-html\/.+\.html$/,
        "sourceHtmlPath must live under .atelier/stitch-html/",
      ),
    /**
     * Generated Next.js page. Either `app/page.tsx` (home) or
     * `app/<route>/page.tsx` for any other route. The regex accepts both
     * to match Next.js App Router conventions exactly.
     */
    generatedPagePath: z
      .string()
      .regex(/^app\/(.+\/)?page\.tsx$/, "generatedPagePath must be 'app/page.tsx' or 'app/<route>/page.tsx'"),
    adaptationStatus: z.enum(ADAPTATION_STATUSES),
    changes: z.array(adaptationChangeSchema),
    /**
     * Font URLs copied from `stitch-analysis.pages[].linkedFonts[]` into
     * the corresponding `app/<group>/layout.tsx`. Closes the silent-font
     * fallback chain — capa 3 de 4.
     */
    preservedFonts: z.array(z.string().url()),
    /** Critical test-id selectors actually injected by the Adapter. */
    injectedTestIds: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)),
    /** When status === "requires-reprompt", explain what Stitch failed to do. */
    reasonForReprompt: z.string().optional(),
    /**
     * SEO metadata injected as `export const metadata: Metadata` (R11,
     * absorbed from the removed pages-routing). `title` required, non-empty.
     */
    metadata: z
      .object({
        title: z.string().min(1, "metadata.title must be non-empty"),
        description: z.string().optional(),
      })
      .strict()
      .optional(),
    /**
     * RSC vs Client decision for this page (R13, absorbed from
     * pages-routing). "server" = RSC default; "client" = needs
     * hooks/state/events.
     */
    renderMode: z.enum(["server", "client"]).optional(),
  })
  .strict()
  .refine(
    (p) => p.adaptationStatus !== "requires-reprompt" || (p.reasonForReprompt?.length ?? 0) >= 10,
    "page with adaptationStatus='requires-reprompt' must include reasonForReprompt (≥10 chars)",
  );

// ─── Full artifact ──────────────────────────────────────────────────

export const pageAdaptationsSchema = z
  .object({
    generatedAt: z.string().datetime(),
    /** Stitch project id this run adapted (for cross-trace with stitch-analysis). */
    stitchProjectId: z.string().min(1),
    /**
     * Mirror of `stitch-analysis.stitchHealth`. When `degraded`, pages
     * missing from the HTML set are still present in this manifest with
     * `adaptationStatus: "requires-reprompt"` so downstream waves see a
     * complete page list.
     */
    stitchHealth: z.enum(["clean", "degraded"]),
    pages: z.array(pageAdaptationSchema).min(1),
    /**
     * App-level special files generated by R12 (absorbed from the removed
     * pages-routing). Not per-route. Optional for backward compatibility
     * with adapters that predate the absorption.
     */
    specialFiles: z
      .object({
        notFound: z.string().regex(/^app\/not-found\.tsx$/),
        error: z.string().regex(/^app\/error\.tsx$/),
        loading: z.string().regex(/^app\/loading\.tsx$/),
      })
      .strict()
      .optional(),
  })
  .strict()
  // No duplicate pageRoute
  .refine(
    (a) => new Set(a.pages.map((p) => p.pageRoute)).size === a.pages.length,
    "duplicate pageRoute in pages[]",
  )
  // Every `replaced-with-shadcn` change must have rationale that mentions
  // why the original Stitch element could not fulfil its function. Loose
  // heuristic — the agent prompt enforces stricter rules.
  .refine(
    (a) =>
      a.pages.every((p) =>
        p.changes
          .filter((c) => c.type === "replaced-with-shadcn")
          .every((c) => c.rationale.length >= 20),
      ),
    "replaced-with-shadcn changes must include rationale of at least 20 chars (explain why the original could not fulfil its function)",
  );

// ─── Types + validator ─────────────────────────────────────────────

export type AdaptationChangeType = (typeof ADAPTATION_CHANGE_TYPES)[number];
export type AdaptationStatus = (typeof ADAPTATION_STATUSES)[number];
export type AdaptationChange = z.infer<typeof adaptationChangeSchema>;
export type PageAdaptation = z.infer<typeof pageAdaptationSchema>;
export type PageAdaptations = z.infer<typeof pageAdaptationsSchema>;

export function validatePageAdaptations(input: unknown): string | null {
  const r = pageAdaptationsSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
