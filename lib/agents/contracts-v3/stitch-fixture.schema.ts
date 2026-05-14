import { z } from "zod";

/**
 * `.atelier-fixtures/stitch-<project>.json` — Recorded or hand-crafted
 * Stitch output, used by Layout Architect in `STITCH_MODE=fixture` runs
 * to bypass real MCP calls.
 *
 * Attempt-aware design: the fixture declares an array of `attempts`,
 * one entry per `stitchAttempt` value the run might reach (0, 1, 2).
 * The Stitch reprompt loop in the orchestrator increments
 * `stitchAttempt` on each reprompt; the fixture preparer reads the
 * current attempt from `.atelier/run-state.json` and materialises the
 * matching screens to disk. This lets the first-run mini-pipeline
 * exercise BOTH branches of the reprompt loop:
 *
 *   - attempt 0 produces an HTML set with a deliberate gap (e.g.
 *     /sign-in missing a <form>) → stitch-completeness-scanner flags
 *     `stitch-missing-critical-element` → reprompt fires.
 *   - attempt 1 produces a corrected HTML set with the gap closed →
 *     scanner passes → wave converges.
 *
 * With a static fixture (no attempts array), we could only test the
 * "dispara + plan B" branch — never the convergence path.
 *
 * The fixture is intentionally schema-validated even though it never
 * round-trips through an LLM: hand-crafted fixtures benefit from the
 * same regex guards as real Stitch output.
 */

// ─── Screen entry (mirrors stitch-design.screens[] shape) ───────────

const screenSchema = z
  .object({
    /** Stitch screen id used downstream by get_screen_image (synthetic in fixture). */
    screenId: z.string().min(1),
    /**
     * Slug derived from the page route: `/admin/classes` → `admin-classes`,
     * `/` → `home`. Drives the filename of the persisted .html / .png.
     */
    routeSlug: z.string().regex(/^[a-z][a-z0-9-]*$/, "routeSlug must be kebab-case lowercase"),
    /** Page route the screen corresponds to (must match layout-tree.pages[]). */
    pageRoute: z.string().regex(/^\/.*/),
    /** Full HTML the agent would have received from Stitch. */
    rawHtml: z.string().min(20, "rawHtml too short to be a real Stitch screen"),
    /**
     * Optional base64-encoded PNG. When omitted, the preparer writes a
     * trivial placeholder PNG (1x1 transparent pixel). Visual regression
     * comparisons against real screenshots will diff, but that's
     * acceptable for the mini-pipeline run (visual-regression-scanner
     * is excluded from the first run anyway).
     */
    mockupBase64Png: z.string().optional(),
  })
  .strict();

// ─── Attempt entry ──────────────────────────────────────────────────

const attemptSchema = z
  .object({
    /** Which `stitchAttempt` value this entry serves (0, 1, or 2). */
    attempt: z.number().int().min(0).max(2),
    screens: z.array(screenSchema).min(1),
  })
  .strict();

// ─── Full fixture ───────────────────────────────────────────────────

export const stitchFixtureSchema = z
  .object({
    /** Stable project id; used to seed `stitch-analysis.stitchProjectId`. */
    stitchProjectId: z.string().min(1),
    designVibe: z.enum(["Linear", "Stripe", "Notion", "Vercel", "Calm"]),
    /**
     * Markdown the agent would receive from `design-md` MCP call.
     * Written verbatim to `.atelier/stitch-design.md` by the preparer.
     */
    designMd: z.string().min(20),
    /**
     * One entry per stitchAttempt the run might reach. The orchestrator
     * caps reprompts at 2, so 0/1/2 cover the full space.
     */
    attempts: z.array(attemptSchema).min(1),
    /** Free-form notes for humans inspecting the fixture. */
    notes: z.string().optional(),
  })
  .strict()
  // Attempts must be consecutive starting from 0.
  .refine(
    (f) => {
      const seen = f.attempts.map((a) => a.attempt).sort((a, b) => a - b);
      for (let i = 0; i < seen.length; i++) if (seen[i] !== i) return false;
      return true;
    },
    "attempts[] must declare consecutive attempt values starting at 0 (0, 0+1, 0+1+2)",
  )
  // routeSlug and pageRoute must agree within each screen.
  .refine(
    (f) =>
      f.attempts.every((a) =>
        a.screens.every((s) => {
          const slugFromRoute = s.pageRoute.replace(/^\//, "").replace(/\//g, "-") || "home";
          return s.routeSlug === slugFromRoute;
        }),
      ),
    "screen.routeSlug must equal pageRoute.replace(/^\\//,'').replace(/\\//g,'-') || 'home'",
  )
  // Within an attempt, routes must be unique.
  .refine(
    (f) =>
      f.attempts.every((a) => {
        const routes = a.screens.map((s) => s.pageRoute);
        return new Set(routes).size === routes.length;
      }),
    "each attempt must declare unique pageRoutes",
  );

export type StitchFixtureScreen = z.infer<typeof screenSchema>;
export type StitchFixtureAttempt = z.infer<typeof attemptSchema>;
export type StitchFixture = z.infer<typeof stitchFixtureSchema>;

export function validateStitchFixture(input: unknown): string | null {
  const r = stitchFixtureSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
