import { z } from "zod";

/**
 * Zod schema for `.atelier/rbac-policy.json` produced by the RBAC &
 * Authorization agent. Captures the per-role abilities (CASL-shaped),
 * ownership rules, and row-level security policy. Controllers in Wave 4
 * read this artifact to know which `assertCan(action, subject)` calls to
 * compose before invoking services.
 */

const abilityRuleSchema = z
  .object({
    action: z.string().min(1),
    subject: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    conditions: z.record(z.string(), z.unknown()).optional(),
    fields: z.array(z.string().min(1)).optional(),
    inverted: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

const roleAbilitiesSchema = z
  .object({
    role: z.string().regex(/^[a-z][a-z0-9_]*$/, "role must be lowercase identifier"),
    rules: z.array(abilityRuleSchema).min(1),
  })
  .passthrough();

const ownershipRuleSchema = z
  .object({
    entity: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
    // Single owner field (yoga: Booking.userId) OR multiple owner fields
    // (tutorias: Session has tutorId AND studentId). When ALL three are
    // empty/absent, the rule is documenting "no ownership" (global catalog
    // like Subject — admin-only). The empty entry is informational; downstream
    // services key off enforceAt being empty to skip ownership checks.
    ownerField: z.string().min(1).optional(),
    ownerFields: z.array(z.string().min(1)).optional(),
    ownerRoles: z.record(z.string(), z.string()).optional(),
    enforceAt: z.array(z.enum(["service-level", "row-level", "controller-level"])),
  })
  .passthrough();

export const rbacPolicySchema = z
  .object({
    roles: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1),
    abilities: z.array(roleAbilitiesSchema).min(1),
    ownershipRules: z.array(ownershipRuleSchema),
    rowLevelSecurity: z
      .object({
        enabled: z.boolean(),
        reason: z.string().optional(),
      })
      .strict(),
  })
  .passthrough()
  .refine(
    // Each declared business role MUST have at least one abilities entry.
    // `anonymous` / `public` virtual roles can appear in abilities without
    // being in the declared roles[] list (common RBAC pattern).
    (p) => p.roles.every((r) => p.abilities.some((a) => a.role === r)),
    "every role must have at least one abilities entry",
  );

export type RbacPolicy = z.infer<typeof rbacPolicySchema>;

export function validateRbacPolicy(input: unknown): string | null {
  const r = rbacPolicySchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
