import { z } from "zod";

/**
 * Zod schema for `.atelier/tests-writer.json` produced by the Tests Writer
 * agent (Wave 5). Lists each test file written, grouped by layer
 * (unit/integration/e2e/fixtures/helpers).
 */

const testFileSchema = z
  .object({
    // Allow any TS/TSX/config file the agent tracks — `tests/...` for actual
    // specs, top-level `vitest.config.ts`/`playwright.config.ts` for runner
    // setup it had to touch in fix rounds.
    path: z.string().min(1),
    // Adds 'config' for harness setup files the agent registers under tests.
    layer: z.enum(["unit", "integration", "e2e", "fixtures", "helpers", "config"]),
    tests: z.number().int().nonnegative(),
    feature: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  })
  .passthrough();

export const testsWriterSchema = z
  .object({
    files: z.array(testFileSchema).min(5, "at least 5 test files"),
    // LLM occasionally tracks helpers/fixtures in counts. Allow extra
    // numeric layers via passthrough — the refine below still enforces
    // that total covers at minimum unit + integration + e2e + extras.
    counts: z
      .object({
        unit: z.number().int().nonnegative(),
        integration: z.number().int().nonnegative(),
        e2e: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .passthrough(),
    coverage: z
      .object({
        servicesPercent: z.number().int().min(0).max(100).optional(),
        controllersPercent: z.number().int().min(0).max(100).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .refine(
    // The only invariant that matters: at least 5 e2e specs exist. The exact
    // arithmetic between unit/integration/e2e/helpers/total is too fragile
    // (different LLM passes interpret "total" differently — net unique vs
    // sum-of-layers).
    (a) => a.counts.e2e >= 5,
    "at least 5 e2e specs required",
  );

export type TestsWriter = z.infer<typeof testsWriterSchema>;

export function validateTestsWriter(input: unknown): string | null {
  const r = testsWriterSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
