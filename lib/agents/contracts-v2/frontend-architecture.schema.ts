import { z } from "zod";

/**
 * Zod schema for `.atelier/frontend-architecture.json` produced by the
 * Frontend Architect agent (Wave 4). Encodes the React Context + TanStack
 * Query layout — which contexts exist, which queries/mutations are wired,
 * what their cache keys are. UI Components and Forms & Validations read
 * this to know which hooks to import.
 */

const contextSchema = z
  .object({
    // Accept both `*Context` (named after the context value) and `*Provider`
    // (named after the wrapper component) — both are valid React patterns,
    // and pure Provider wrappers like QueryProvider are common.
    // Accept *Context / *Provider / *Providers — all are valid React patterns
    // (Context value, single Provider wrapper, or composition-root Providers).
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*(Context|Provider|Providers)$/, "must end in Context|Provider|Providers"),
    // Pure providers (e.g. QueryProvider wrapping TanStack Query) have no
    // own state — they just inject a dependency. Empty array is valid.
    state: z.array(z.string().min(1)),
    actions: z.array(z.string().min(1)),
  })
  .passthrough();

const querySchema = z
  .object({
    name: z.string().regex(/^use[A-Z][A-Za-z0-9]*$/, "must be a use*-style hook name"),
    endpoint: z
      .string()
      .regex(/^GET \/api\//, "endpoint must be like 'GET /api/...'"),
    cacheKey: z.union([
      z.string().min(1),
      z.array(z.string().min(1)).min(1),
    ]),
    staleTimeMs: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const mutationSchema = z
  .object({
    name: z.string().regex(/^use[A-Z][A-Za-z0-9]*$/),
    endpoint: z.string().regex(/^(POST|PUT|PATCH|DELETE) \/api\//),
    // Mutations like signOut/signOutEverywhere clear the cache entirely (no
    // specific invalidates). Empty array is valid.
    invalidates: z.array(z.union([z.string(), z.array(z.string())])),
  })
  .passthrough();

export const frontendArchitectureSchema = z
  .object({
    contexts: z.array(contextSchema).min(1),
    queries: z.array(querySchema).min(1),
    mutations: z.array(mutationSchema).min(1),
  })
  .passthrough();

export type FrontendArchitecture = z.infer<typeof frontendArchitectureSchema>;

export function validateFrontendArchitecture(input: unknown): string | null {
  const r = frontendArchitectureSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
