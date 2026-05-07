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
    mutation: z.string().regex(/^use[A-Z][A-Za-z0-9]*$/, "mutation must be a use*-style hook"),
    fields: z.array(z.string().min(1)).min(1),
    submitFlow: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const formsValidationsSchema = z
  .object({
    forms: z.array(formSchema).min(1),
    schemaFiles: z.array(z.string().regex(/\.ts$/)).min(1),
  })
  .strict();

export type FormsValidations = z.infer<typeof formsValidationsSchema>;

export function validateFormsValidations(input: unknown): string | null {
  const r = formsValidationsSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
