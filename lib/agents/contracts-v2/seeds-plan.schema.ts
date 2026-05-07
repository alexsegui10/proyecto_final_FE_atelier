import { z } from "zod";

/**
 * Zod schema for `.atelier/seeds-plan.json` produced by the Seeds Shape
 * Designer. This is a PLANNING artifact — describes WHAT data to seed in
 * the demo, not the seed data itself. The actual `prisma/seed.ts` is
 * generated in Wave 5 by the Seeds & Fixtures agent based on this plan.
 */

const credentialsSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
  })
  .strict();

const distributionSchema = z
  .record(z.string().min(1), z.number().int().nonnegative())
  .refine((d) => Object.keys(d).length > 0, "distribution must have at least one bucket");

const demoUserSchema = z
  .object({
    role: z.string().regex(/^[a-z][a-z0-9_]*$/, "role must be lowercase identifier"),
    count: z.number().int().positive(),
    fixed: z.boolean(),
    credentials: credentialsSchema.optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    personasHints: z.array(z.string().min(1)).optional(),
    distribution: distributionSchema.optional(),
  })
  .strict()
  .refine(
    (u) => !u.fixed || u.credentials !== undefined,
    "fixed users must include credentials",
  );

const domainDataSchema = z
  .object({
    entity: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
    count: z.number().int().positive(),
    distribution: z.string().optional(),
    constraints: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const seedsPlanSchema = z
  .object({
    demoUsers: z.array(demoUserSchema).min(1),
    domainData: z.array(domainDataSchema).min(1),
    edgeCases: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type SeedsPlan = z.infer<typeof seedsPlanSchema>;

export function validateSeedsPlan(input: unknown): string | null {
  const r = seedsPlanSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
