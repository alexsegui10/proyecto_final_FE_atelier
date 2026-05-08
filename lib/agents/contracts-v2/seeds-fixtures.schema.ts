import { z } from "zod";

/**
 * Zod schema for `.atelier/seeds-fixtures.json` produced by the Seeds &
 * Fixtures agent (Wave 5). Encodes WHAT was seeded — count per entity,
 * fixed admin credentials, files generated. Distinct from seeds-plan.json
 * (Wave 2 planning artifact); this is the post-execution metadata.
 */

const seededEntitySchema = z
  .object({
    entity: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
    count: z.number().int().nonnegative(),
    notes: z.string().optional(),
  })
  .passthrough();

const fixedCredentialSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    role: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name: z.string().min(1),
  })
  .passthrough();

export const seedsFixturesSchema = z
  .object({
    seedScript: z
      .string()
      .regex(/^prisma\/seed\.ts$/, "must be prisma/seed.ts"),
    seedDataFiles: z.array(z.string().regex(/^prisma\/seed-data\//)).min(1),
    fixtureFiles: z.array(z.string().regex(/^tests\/fixtures\//)).min(1),
    fixedCredentials: z.array(fixedCredentialSchema).min(1, "at least 1 fixed admin"),
    seededEntities: z.array(seededEntitySchema).min(1),
    totalRecords: z.number().int().nonnegative(),
  })
  .passthrough();

export type SeedsFixtures = z.infer<typeof seedsFixturesSchema>;

export function validateSeedsFixtures(input: unknown): string | null {
  const r = seedsFixturesSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
