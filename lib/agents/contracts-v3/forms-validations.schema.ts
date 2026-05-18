import { z } from "zod";

/**
 * Zod schema for `.atelier/forms-validations.json` — v3 (B-w4-13).
 *
 * v3-native superset of `contracts-v2/forms-validations.schema.ts` (which
 * stays INTACT for the v2 generators). The v2 schema is `.passthrough()` by
 * design (the LLM emits composite descriptors); v3 keeps that flexibility on
 * the form body but adds a REQUIRED, `.strict()` `mountHint` so visual-adapter
 * can mount EVERY canonical form deterministically — closing B-w4-13, where
 * the same prompt produced 5 mounted forms (run-11, liberal R6 reading) vs 2
 * (run-12, literal `<form>`-only reading). mountHint removes the ambiguity:
 * forms-validations declares WHERE and HOW each form is mounted.
 *
 * Wired as the boundary validator of the `forms-validations` slot in
 * scripts/full-yoga-regen-v3.ts (closes deuda #23 for this slot).
 */

export const MOUNT_PATTERNS = ["inline", "trigger-dialog"] as const;
export type MountPattern = (typeof MOUNT_PATTERNS)[number];

/**
 * Where/how visual-adapter must mount the canonical form.
 * - `inline`: Stitch renders a literal `<form>` (e.g. sign-in/sign-up) —
 *   replace that subtree, preserve the surrounding container/styles.
 * - `trigger-dialog`: no literal `<form>`; a button/FAB/row-action opens the
 *   form. `triggerHint` locates that trigger (the button vs FAB vs row-action
 *   distinction lives in the hint text, not the enum — fewer enum values =
 *   less ambiguity for the consuming LLM = more determinism).
 */
const mountHintSchema = z
  .object({
    pageRoute: z
      .string()
      .regex(/^\/.*/, "mountHint.pageRoute must start with '/'"),
    mountPattern: z.enum(MOUNT_PATTERNS),
    /** Selector / testId / label / description of the trigger element. */
    triggerHint: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (m) => m.mountPattern !== "trigger-dialog" || (m.triggerHint?.length ?? 0) >= 1,
    "mountHint.triggerHint is required when mountPattern === 'trigger-dialog'",
  );

const formSchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*Form$/, "must end in 'Form'"),
    path: z
      .string()
      .regex(/^client\/components\/forms\/.+\.tsx$/, "must live under client/components/forms/"),
    schemaFile: z.string().regex(/\.ts$/, "schemaFile must be a TS file"),
    schemaName: z.string().min(1),
    mutation: z.string().min(1),
    fields: z
      .array(
        z.union([
          z.string().min(1),
          z.object({ name: z.string().min(1) }).passthrough(),
        ]),
      )
      .min(1),
    submitFlow: z.array(z.string().min(1)).optional(),
    /** B-w4-13: REQUIRED in v3 — visual-adapter consumes this for R6/R6b. */
    mountHint: mountHintSchema,
  })
  // Body stays passthrough (rich descriptors like testId/note/submitButtonTestId
  // the LLM already emits) — but mountHint above is strict + required.
  .passthrough();

export const formsValidationsSchemaV3 = z
  .object({
    forms: z.array(formSchema).min(1),
    schemaFiles: z
      .array(
        z.union([
          z.string().regex(/\.ts$/),
          z.object({ path: z.string().regex(/\.ts$/) }).passthrough(),
        ]),
      )
      .min(1),
  })
  .passthrough();

export type FormsValidationsV3 = z.infer<typeof formsValidationsSchemaV3>;

export function validateFormsValidationsV3(input: unknown): string | null {
  const r = formsValidationsSchemaV3.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
