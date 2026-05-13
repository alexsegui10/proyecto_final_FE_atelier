import { z } from "zod";

/**
 * Zod schema for `.atelier/auth-mechanics.json` produced by the Auth &
 * Security agent. Encodes the JWT/refresh-token policy + password hashing
 * choice + rate-limit + session strategy that the API Backend agent (Wave 4)
 * uses to wire route handlers.
 */

// Access tokens are always JWTs (need algorithm + claims). Refresh tokens
// are sometimes opaque random strings stored server-side, in which case
// algorithm/claims don't apply — keep them OPTIONAL and let passthrough
// absorb extras like `format`, `byteLength`, `storage`, etc.
const tokenSpecSchema = z
  .object({
    lifetime: z.string().regex(/^\d+(s|m|h|d)$/, "lifetime must be like 15m, 30d"),
    // JWT algorithms (HS256/RS256/etc) for access tokens, or descriptors
    // like 'opaque-random-256bit' for non-JWT refresh tokens. Free-form
    // string keeps the field semantic without locking it to crypto enums.
    algorithm: z.string().min(1).optional(),
    claims: z.array(z.string().min(1)).min(1).optional(),
    rotation: z.boolean().optional(),
    familyDetection: z.boolean().optional(),
  })
  .passthrough();

const passwordPolicySchema = z
  .object({
    backend: z.enum(["argon2id", "bcrypt"]),
    backendForPlatform: z
      .object({
        win32: z.enum(["bcrypt", "argon2id"]),
        linux: z.enum(["bcrypt", "argon2id"]),
        darwin: z.enum(["bcrypt", "argon2id"]),
      })
      .passthrough(),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    minLength: z.number().int().min(8),
  })
  .passthrough();

// Accept route-path keys (`/api/...`) AND metadata siblings like `enforcedBy`
// that the LLM emits to document who applies the policy.
const rateLimitSchema = z.record(z.string(), z.string().min(1));

const sessionStrategySchema = z
  .object({
    storage: z.enum(["DB", "redis", "memory"]),
    deviceTracking: z.boolean(),
    globalLogoutSupport: z.boolean(),
  })
  .passthrough();

export const authMechanicsSchema = z
  .object({
    tokens: z
      .object({
        access: tokenSpecSchema,
        refresh: tokenSpecSchema,
      })
      .passthrough(),
    passwordPolicy: passwordPolicySchema,
    rateLimit: rateLimitSchema,
    sessions: sessionStrategySchema,
    // The LLM emits either flat strings ("AuthService") or objects
    // ({ name, file, methods }) — accept both via union.
    services: z
      .array(
        z.union([
          z.string().min(1),
          z.object({ name: z.string().min(1) }).passthrough(),
        ]),
      )
      .min(4),
    repositories: z
      .array(
        z.union([
          z.string().min(1),
          z.object({ name: z.string().min(1) }).passthrough(),
        ]),
      )
      .min(2),
  })
  .passthrough();

export type AuthMechanics = z.infer<typeof authMechanicsSchema>;

export function validateAuthMechanics(input: unknown): string | null {
  const r = authMechanicsSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
