import { z } from "zod";

/**
 * Zod schema for `.atelier/auth-mechanics.json` produced by the Auth &
 * Security agent. Encodes the JWT/refresh-token policy + password hashing
 * choice + rate-limit + session strategy that the API Backend agent (Wave 4)
 * uses to wire route handlers.
 */

const tokenSpecSchema = z
  .object({
    lifetime: z.string().regex(/^\d+(s|m|h|d)$/, "lifetime must be like 15m, 30d"),
    algorithm: z.enum(["HS256", "HS384", "HS512", "RS256", "ES256"]),
    claims: z.array(z.string().min(1)).min(1),
    rotation: z.boolean().optional(),
    familyDetection: z.boolean().optional(),
  })
  .strict();

const passwordPolicySchema = z
  .object({
    backend: z.enum(["argon2id", "bcrypt"]),
    backendForPlatform: z
      .object({
        win32: z.enum(["bcrypt", "argon2id"]),
        linux: z.enum(["bcrypt", "argon2id"]),
        darwin: z.enum(["bcrypt", "argon2id"]),
      })
      .strict(),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    minLength: z.number().int().min(8),
  })
  .strict();

const rateLimitSchema = z.record(
  z.string().regex(/^\/(api|app)\//, "must be a route path"),
  z.string().min(1),
);

const sessionStrategySchema = z
  .object({
    storage: z.enum(["DB", "redis", "memory"]),
    deviceTracking: z.boolean(),
    globalLogoutSupport: z.boolean(),
  })
  .strict();

export const authMechanicsSchema = z
  .object({
    tokens: z
      .object({
        access: tokenSpecSchema,
        refresh: tokenSpecSchema,
      })
      .strict(),
    passwordPolicy: passwordPolicySchema,
    rateLimit: rateLimitSchema,
    sessions: sessionStrategySchema,
    services: z.array(z.string().min(1)).min(4),
    repositories: z.array(z.string().min(1)).min(2),
  })
  .strict();

export type AuthMechanics = z.infer<typeof authMechanicsSchema>;

export function validateAuthMechanics(input: unknown): string | null {
  const r = authMechanicsSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
