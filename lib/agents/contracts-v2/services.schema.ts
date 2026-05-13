import { z } from "zod";

/**
 * Zod schema for `.atelier/services.json` produced by the Service Layer agent.
 * Captures one entry per feature with a single `<Feature>Service` class and
 * its public methods. The API Backend agent (Wave 4) reads this artifact to
 * know which methods to expose via Controllers.
 */

const serviceMethodSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, "method name must be camelCase"),
    inputType: z.string().min(1),
    outputType: z.string().min(1),
    transactional: z.boolean().optional(),
    isolation: z.enum(["READ_COMMITTED", "REPEATABLE_READ", "SERIALIZABLE"]).optional(),
    businessRules: z.array(z.string().min(1)).optional(),
    throws: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

const serviceSchema = z
  .object({
    feature: z.string().regex(/^[a-z][a-z0-9-]*$/),
    className: z.string().regex(/^[A-Z][A-Za-z0-9]*Service$/, "class must end in 'Service'"),
    constructorDeps: z.array(z.string().min(1)).min(0),
    methods: z.array(serviceMethodSchema).min(1),
    testFile: z.string().min(1),
  })
  .passthrough();

export const servicesSchema = z
  .object({
    services: z.array(serviceSchema).min(1),
  })
  .passthrough();

export type ServicesArtifact = z.infer<typeof servicesSchema>;
export type ServiceMethod = z.infer<typeof serviceMethodSchema>;

export function validateServices(input: unknown): string | null {
  const r = servicesSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
