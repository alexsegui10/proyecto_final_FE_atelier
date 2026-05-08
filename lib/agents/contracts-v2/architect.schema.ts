import { z } from "zod";

/**
 * Zod schema for `.atelier/architect.json` produced by the Architect agent
 * (Wave 1, post-Discovery). Documents the high-level technical plan the
 * downstream agents (Domain Modeler, Persistence, etc.) read.
 */

const stackDecisionsSchema = z
  .object({
    framework: z.string().min(1),
    database: z.string().min(1),
    auth: z.string().min(1),
    validation: z.string().min(1),
    styling: z.string().min(1),
    stateManagement: z.string().min(1),
    forms: z.string().min(1),
    tests: z.string().min(1),
  })
  .passthrough();

const featureSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/, "feature name must be kebab-case"),
    entities: z.array(z.string().regex(/^[A-Z][A-Za-z0-9]*$/)).min(1),
    useCases: z.array(z.string().min(5)).min(2, "at least 2 use cases per feature"),
    publicRoutes: z.array(z.string().regex(/^\/.*/, "routes must start with /")),
    privateRoutes: z.array(z.string().regex(/^\/.*/, "routes must start with /")),
    adminRoutes: z.array(z.string().regex(/^\/.*/, "routes must start with /")),
  })
  .passthrough();

const crossCuttingConcernsSchema = z
  .object({
    logging: z.string().min(1).optional(),
    rateLimit: z.array(z.string().regex(/^\/api\//)),
    auditLog: z.array(z.string().min(1)),
    i18n: z.boolean(),
    darkMode: z.string().min(1),
  })
  .passthrough();

export const architectSchema = z
  .object({
    stackDecisions: stackDecisionsSchema,
    features: z.array(featureSchema).min(1),
    crossCuttingConcerns: crossCuttingConcernsSchema,
    deploymentNotes: z.string().min(5),
  })
  .passthrough();

export type Architect = z.infer<typeof architectSchema>;

export function validateArchitect(input: unknown): string | null {
  const r = architectSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
