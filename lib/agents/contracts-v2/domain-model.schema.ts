import { z } from "zod";

/**
 * Zod schema for `.atelier/domain-model.json` produced by the Domain Modeler.
 * Mirrors the structure consumed by the Persistence agent (Wave 2) and
 * the Service Layer / Auth & Security agents (Wave 3).
 */

const fieldKindSchema = z.enum([
  "id",
  "uid",
  "slug",
  "scalar",
  "enum-string",
  "enum-numeric",
  "foreign-key",
  "soft-delete",
  "timestamp",
]);

const fieldSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    kind: fieldKindSchema.optional(),
    required: z.boolean().optional(),
    references: z.string().optional(),
    values: z.array(z.string().min(1)).optional(),
    notes: z.string().optional(),
  })
  .strict();

const valueObjectSchema = z
  .object({
    name: z.string().min(1),
    fields: z.array(z.object({ name: z.string(), type: z.string() })),
    invariants: z.array(z.string()).optional(),
  })
  .strict();

const entitySchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, "entity name must be PascalCase"),
    feature: z.string().regex(/^[a-z][a-z0-9-]*$/, "feature must be kebab-case"),
    fields: z.array(fieldSchema).min(2),
    invariants: z.array(z.string()).optional(),
    valueObjects: z.array(valueObjectSchema).optional(),
  })
  .strict();

const domainErrorSchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*Error$/, "domain error must be PascalCase + 'Error'"),
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "code must be SCREAMING_SNAKE"),
    httpStatus: z.number().int().min(400).max(599),
    message: z.string().optional(),
  })
  .strict();

export const domainModelSchema = z
  .object({
    entities: z.array(entitySchema).min(1),
    domainErrors: z.array(domainErrorSchema).min(1),
  })
  .strict();

export type DomainModel = z.infer<typeof domainModelSchema>;
export type DomainEntity = z.infer<typeof entitySchema>;
export type DomainError = z.infer<typeof domainErrorSchema>;

export function validateDomainModel(input: unknown): string | null {
  const r = domainModelSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
