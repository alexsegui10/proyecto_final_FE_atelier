import { z } from "zod";

/**
 * `.atelier/seeds-fixtures.json` — Seeds & Fixtures agent (v3 wave-5a-seeds).
 *
 * Metadata manifest of the demo seed the agent generated: the executable
 * `prisma/seed.ts`, the inspectable `prisma/seed-data/*.json` source of
 * truth, the `tests/fixtures/*.fixture.ts` re-exports, the fixed login
 * credentials, and the seeded entity / edge-case inventory.
 *
 * Designed SHAPE-FIRST from the F3-run-14 real output
 * (`out/yoga-regen-v3-2026-05-19T10-01-49/.atelier/seeds-fixtures.json`),
 * not from a spec — the v2 prompt is reused verbatim and the LLM varies
 * field *content* run-to-run (entity counts, edge-case wording, role
 * names). The schema validates structure, never content.
 *
 * Design decisions (approved pre-flight, lesson B-w4-11):
 *   - Top-level is NOT `.strict()` — the reused v2 prompt may emit an
 *     extra field; a strict top-level would false-red → reprompt/B12 for
 *     a benign addition. Stable sub-objects ARE `.strict()`.
 *   - `userDistribution` is value-polymorphic (a role maps to a flat
 *     number OR a nested breakdown). Modelled as a record with a
 *     `number | record<string,number>` value union — NOT passthrough
 *     (the variance is in the value type, not in unknown extra keys).
 *   - `constraints` mixes boolean flags and string descriptions under
 *     domain-derived keys → laxo `record<string, boolean | string>`.
 */

const fixedCredentialSchema = z
  .object({
    email: z.string(),
    password: z.string(),
    role: z.string(),
    name: z.string(),
  })
  .strict();

const seededEntitySchema = z
  .object({
    entity: z.string(),
    count: z.number().int().min(0),
    notes: z.string(),
  })
  .strict();

const edgeCaseSchema = z
  .object({
    case: z.string(),
    where: z.string(),
  })
  .strict();

export const seedsFixturesSchema = z
  .object({
    seedScript: z.string(),
    runCommand: z.string(),
    resetCommand: z.string(),
    seedDataFiles: z.array(z.string()),
    fixtureFiles: z.array(z.string()),
    fixedCredentials: z.array(fixedCredentialSchema),
    seededEntities: z.array(seededEntitySchema),
    edgeCasesCovered: z.array(edgeCaseSchema),
    /**
     * Role → headcount. Value is a flat number OR a nested breakdown
     * object (run-14: `alumno` carried `{total,active,newcomers,lapsed}`
     * while `admin`/`profesor` were flat numbers). Keys are domain roles
     * and vary by app — record, not a fixed object.
     */
    userDistribution: z.record(
      z.string(),
      z.union([z.number(), z.record(z.string(), z.number())]),
    ),
    totalRecords: z.number().int().min(0),
    /**
     * Invariant flags + free-form descriptions under domain-derived keys
     * (e.g. `uniqueEmails: true`, `passwordHashing: "bcrypt..."`). Laxo
     * by design — the key set is not load-bearing downstream.
     */
    constraints: z.record(z.string(), z.union([z.boolean(), z.string()])),
    notes: z.array(z.string()),
  })
  // NOT .strict() — see file header.
  ;

export type SeedsFixtures = z.infer<typeof seedsFixturesSchema>;

export function validateSeedsFixtures(input: unknown): string | null {
  const r = seedsFixturesSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
