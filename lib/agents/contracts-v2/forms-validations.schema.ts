import { z } from "zod";

/**
 * Zod schema for `.atelier/forms-validations.json` produced by the Forms &
 * Validations agent (Wave 4). Encodes which forms exist, their react-hook-
 * form schemas, the mutation they trigger on submit.
 */

const formSchema = z
  .object({
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*Form$/, "must end in 'Form'"),
    path: z
      .string()
      .regex(/^client\/components\/forms\/.+\.tsx$/, "must live under client/components/forms/"),
    schemaFile: z.string().regex(/\.ts$/, "schemaFile must be a TS file"),
    schemaName: z.string().min(1),
    // mutation is usually a single use* hook name, but the LLM emits
    // composite descriptions ("useCreateClass + useUpdateClass") for forms
    // that unify create/edit. Allow free-text; the use* contract is enforced
    // by the actual `client/hooks/mutations/` files written to disk.
    mutation: z.string().min(1),
    // Accepts flat field names ("email") OR rich descriptors
    // `{name, type, label, required, validation}` that document the
    // form field inline. Both are valid representations.
    fields: z
      .array(
        z.union([
          z.string().min(1),
          z.object({ name: z.string().min(1) }).passthrough(),
        ]),
      )
      .min(1),
    submitFlow: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

export const formsValidationsSchema = z
  .object({
    forms: z.array(formSchema).min(1),
    // schemaFiles may be flat paths or `{ path, schemas, consumedBy, notes }` objects.
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

export type FormsValidations = z.infer<typeof formsValidationsSchema>;

export function validateFormsValidations(input: unknown): string | null {
  const r = formsValidationsSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
