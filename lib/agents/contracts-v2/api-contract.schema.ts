import { z } from "zod";

/**
 * Zod schema for `.atelier/api-contract.json` produced by the API Backend
 * agent (Wave 4). Lists every HTTP endpoint of the generated app + the
 * controller / service method / authz check / request schema / response
 * type that fulfills it. Frontend Architect (also Wave 4) reads this to
 * know which paths to wire into TanStack Query / mutations.
 */

const errorMappingSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    status: z.number().int().min(400).max(599),
  })
  .strict();

const endpointSchema = z
  .object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().regex(/^\/api\//, "path must start with /api/"),
    handler: z.string().min(1),
    auth: z.enum(["public", "authenticated", "admin"]),
    rbac: z
      .object({
        action: z.string().min(1),
        subject: z.string().min(1),
      })
      .strict()
      .optional(),
    request: z.string().optional(),
    response: z.string().min(1),
    successStatus: z.number().int().min(200).max(299),
    errors: z.array(errorMappingSchema).optional(),
  })
  .strict();

export const apiContractSchema = z
  .object({
    endpoints: z.array(endpointSchema).min(1),
    openApiPath: z.string().optional(),
  })
  .strict();

export type ApiContract = z.infer<typeof apiContractSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;

export function validateApiContract(input: unknown): string | null {
  const r = apiContractSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
