import { z } from "zod";

/**
 * Zod schema for `.atelier/tests-writer.json` produced by the Tests Writer
 * agent (Wave 5). Lists each test file written, grouped by layer
 * (unit/integration/e2e/fixtures/helpers).
 */

const testFileSchema = z
  .object({
    path: z.string().regex(/^tests\/(unit|integration|e2e|fixtures|helpers)\//),
    layer: z.enum(["unit", "integration", "e2e", "fixtures", "helpers"]),
    tests: z.number().int().nonnegative(),
    feature: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  })
  .passthrough();

export const testsWriterSchema = z
  .object({
    files: z.array(testFileSchema).min(5, "at least 5 test files"),
    counts: z
      .object({
        unit: z.number().int().nonnegative(),
        integration: z.number().int().nonnegative(),
        e2e: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .strict(),
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
    (a) => a.counts.unit + a.counts.integration + a.counts.e2e === a.counts.total,
    "counts.total must equal sum of unit + integration + e2e",
  )
  .refine(
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
