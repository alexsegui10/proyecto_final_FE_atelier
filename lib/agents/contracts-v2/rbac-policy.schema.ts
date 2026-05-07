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
  .strict();

const roleAbilitiesSchema = z
  .object({
    role: z.string().regex(/^[a-z][a-z0-9_]*$/, "role must be lowercase identifier"),
    rules: z.array(abilityRuleSchema).min(1),
  })
  .strict();

const ownershipRuleSchema = z
  .object({
    entity: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
    ownerField: z.string().min(1),
    enforceAt: z.array(z.enum(["service-level", "row-level", "controller-level"])).min(1),
  })
  .strict();

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
  .strict()
  .refine(
    (p) => p.abilities.every((a) => p.roles.includes(a.role)),
    "every abilities[].role must be present in roles[]",
  )
  .refine(
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
