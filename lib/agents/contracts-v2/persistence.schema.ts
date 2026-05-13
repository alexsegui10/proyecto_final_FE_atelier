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
    // 'primary' added for explicit PK index declarations. Prisma auto-derives
    // PKs but the LLM sometimes documents them in the metadata explicitly.
    type: z.enum(["unique", "btree", "unique-where-active", "gin", "hash", "primary"]),
  })
  .passthrough();

// Passthrough — LLM may produce alternative check shapes (e.g. {model, field,
// values, documentedAs} for enum-like CHECK constraints) which are sensible
// even when the canonical shape is {model, constraint}. We require `model`
// only; the rest is flexible. Downstream Persistence-impl agent can adapt.
const checkSchema = z
  .object({
    model: z.string().min(1),
    constraint: z.string().min(1).optional(),
  })
  .passthrough();

const repoMethodSchema = z
  .object({
    name: z.string().min(1),
    // empty string accepted for parameterless methods (e.g. listAll())
    params: z.string(),
    returns: z.string().min(1),
    notes: z.string().optional(),
  })
  .passthrough();

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
  .passthrough();

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
            }).passthrough(),
          )
          .min(1),
        indices: z.array(indexSchema),
        checks: z.array(checkSchema),
      })
      .passthrough(),
    repositories: z.array(repositorySchema).min(1),
  })
  .passthrough(); // top-level passthrough so the agent can attach `shared`,
                  // `migrations`, or other top-level metadata sections.

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
