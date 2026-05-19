import { z } from "zod";

/**
 * `.atelier/tests-writer.json` — Tests Writer agent (v3 wave-5b-tests).
 *
 * Metadata manifest of the test suite the agent wrote: per-file inventory
 * (layer + test count), aggregate counts, coverage figures, and the
 * agent's own verification run.
 *
 * Designed SHAPE-FIRST from the F3-run-14 real output
 * (`out/yoga-regen-v3-2026-05-19T10-01-49/.atelier/tests-writer.json`).
 * The v2 prompt is reused verbatim; the LLM varies counts, file lists and
 * verification wording run-to-run. The schema validates structure only.
 *
 * Design decisions (approved pre-flight, lesson B-w4-11):
 *   - Top-level is NOT `.strict()` (benign LLM additions must not
 *     false-red → reprompt/B12). Stable sub-objects ARE `.strict()`.
 *   - `files[]` carries TWO type-correlated optionals: `notes` on
 *     fixtures/helpers entries, `feature` on unit/integration entries,
 *     neither on e2e. Both modelled `.optional()`.
 *   - `verification` has domain-derived string keys → laxo
 *     `record<string,string>`.
 *   - Cross-field refinement: counts.unit + counts.integration +
 *     counts.e2e === counts.total (same category as the forms-validations
 *     mountPattern→triggerHint structural rule, B-w4-13).
 */

const fileEntrySchema = z
  .object({
    path: z.string(),
    layer: z.string(),
    tests: z.number().int().min(0),
    notes: z.string().optional(),
    feature: z.string().optional(),
  })
  .strict();

const countsSchema = z
  .object({
    unit: z.number().int().min(0),
    integration: z.number().int().min(0),
    e2e: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .strict();

const coverageSchema = z
  .object({
    servicesPercent: z.number().min(0).max(100),
    controllersPercent: z.number().min(0).max(100),
    endpointsCovered: z.number().int().min(0),
    endpointsTotal: z.number().int().min(0),
  })
  .strict();

const runnerSchema = z
  .object({
    unit: z.string(),
    integration: z.string(),
    e2e: z.string(),
  })
  .strict();

export const testsWriterSchema = z
  .object({
    generatedAt: z.string(),
    runner: runnerSchema,
    files: z.array(fileEntrySchema),
    counts: countsSchema,
    coverage: coverageSchema,
    /** Agent's own verification run — domain-derived string keys, laxo. */
    verification: z.record(z.string(), z.string()),
    notes: z.array(z.string()),
  })
  // NOT .strict() — see file header.
  .refine(
    (t) =>
      t.counts.unit + t.counts.integration + t.counts.e2e === t.counts.total,
    {
      message:
        "counts.total must equal counts.unit + counts.integration + counts.e2e",
      path: ["counts", "total"],
    },
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
