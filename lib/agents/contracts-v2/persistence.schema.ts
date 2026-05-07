import { z } from "zod";

/**
 * Zod schema for `.atelier/persistence.json` produced by the Persistence agent.
 * Captures the Prisma schema metadata + the repositories declared per feature
 * so downstream agents (Service Layer, API Backend) know which methods exist
 * on each repository interface without re-reading the .ts files.
 */

const indexSchema = z
  .object({
    model: z.string().min(1),
    fields: z.array(z.string().min(1)).min(1),
    type: z.enum(["unique", "btree", "unique-where-active", "gin", "hash"]),
  })
  .strict();

const checkSchema = z
  .object({
    model: z.string().min(1),
    constraint: z.string().min(1),
  })
  .strict();

const repoMethodSchema = z
  .object({
    name: z.string().min(1),
    params: z.string().min(1),
    returns: z.string().min(1),
    notes: z.string().optional(),
  })
  .strict();

const repositorySchema = z
  .object({
    feature: z.string().regex(/^[a-z][a-z0-9-]*$/),
    interface: z.string().regex(/^[A-Z][A-Za-z0-9]*Repository$/),
    impl: z
      .string()
      .regex(/^[A-Z][A-Za-z0-9]*RepositoryImpl$/)
      .optional(),
    methods: z.array(repoMethodSchema).min(2),
  })
  .strict();

export const persistenceSchema = z
  .object({
    schema: z
      .object({
        models: z
          .array(
            z.object({
              name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
              feature: z.string().regex(/^[a-z][a-z0-9-]*$/),
              softDelete: z.boolean().optional(),
            }),
          )
          .min(1),
        indices: z.array(indexSchema),
        checks: z.array(checkSchema),
      })
      .strict(),
    repositories: z.array(repositorySchema).min(1),
  })
  .strict();

export type PersistenceArtifact = z.infer<typeof persistenceSchema>;
export type RepositoryDecl = z.infer<typeof repositorySchema>;

export function validatePersistence(input: unknown): string | null {
  const r = persistenceSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
