import { z } from "zod";

/**
 * Zod schema for `.atelier/discovery.json` produced by the Discovery agent
 * (Wave 1 chat phase). This is the PRD that everything else downstream
 * consumes — keep the required shape strict but allow domain-flavored
 * extras via passthrough on entities/useCases.
 */

const fieldSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    required: z.boolean().optional(),
    notes: z.string().optional(),
    references: z.string().optional(),
    values: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

const entitySchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, "entity name must be PascalCase"),
    fields: z.array(fieldSchema).min(3, "at least 3 fields per entity"),
    businessRules: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

const useCaseSchema = z
  .object({
    actor: z.string().min(1),
    action: z.string().min(5),
    constraints: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

export const VIBES = ["Linear", "Stripe", "Notion", "Vercel", "Calm"] as const;

export const discoverySchema = z
  .object({
    objective: z.string().refine(
      (s) => s.split(/\s+/).length >= 10,
      "objective must be at least 10 words",
    ),
    domain: z.string().regex(/^[a-z][a-z0-9-]*$/, "domain must be kebab-case-id"),
    designVibe: z.enum(VIBES).optional(),
    roles: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*$/, "roles must be lowercase identifiers"))
      .min(2, "at least 2 roles")
      .max(5, "at most 5 roles"),
    entities: z.array(entitySchema).min(4, "at least 4 entities"),
    useCases: z.array(useCaseSchema).min(8, "at least 8 use cases"),
    specialRequirements: z.array(z.string().min(1)).optional(),
  })
  .passthrough(); // allow extra top-level keys like `notes`

export type Discovery = z.infer<typeof discoverySchema>;

export function validateDiscovery(input: unknown): string | null {
  const r = discoverySchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
