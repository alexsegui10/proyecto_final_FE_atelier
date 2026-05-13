import { z } from "zod";

/**
 * Zod schema for `.atelier/qa-report.json` produced by the QA Reviewer
 * agent (Wave 6). Encodes the gate results + routed violations + decision.
 *
 * The orchestrator-v2 fix loop reads this artifact, groups violations by
 * agent via the violations-router-v2, and re-launches the responsible
 * agents with the recommendedFix surfaced verbatim.
 */

const gateResultSchema = z
  .object({
    status: z.enum(["pass", "fail"]),
    detail: z.string().optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const violationSchema = z
  .object({
    severity: z.enum(["error", "warn"]),
    rule: z.string().min(1),
    agent: z.string().regex(/^[a-z][a-z0-9-]*$/, "agent must be kebab-case identifier").optional(),
    file: z.string().min(1),
    // 0 = file-level violation (no specific line); positive = anchored line.
    line: z.number().int().nonnegative().optional(),
    message: z.string().min(1),
    recommendedFix: z.string().optional(),
  })
  .passthrough();

const escalationSchema = z
  .object({
    reason: z.string().min(5),
    suggestedHumanAction: z.string().min(5),
  })
  .passthrough();

export const qaReportSchema = z
  .object({
    decision: z.enum(["go", "no-go"]),
    gates: z
      .object({
        typecheck: gateResultSchema,
        lint: gateResultSchema,
        deps: gateResultSchema,
        tests: gateResultSchema,
        format: gateResultSchema.optional(),
        security: gateResultSchema.optional(),
        structure: gateResultSchema.optional(),
      })
      .passthrough(),
    violations: z.array(violationSchema),
    metrics: z
      .object({
        filesGenerated: z.number().int().nonnegative().optional(),
        linesOfCode: z.number().int().nonnegative().optional(),
        testCoverage: z.string().optional(),
        totalDuration: z.string().optional(),
      })
      .passthrough()
      .optional(),
    escalation: escalationSchema.optional(),
    summary: z.string().min(1),
  })
  .passthrough()
  .refine(
    (r) => {
      // If decision='go', all required gates must be 'pass'.
      if (r.decision !== "go") return true;
      const required = [r.gates.typecheck, r.gates.lint, r.gates.deps, r.gates.tests];
      return required.every((g) => g.status === "pass");
    },
    "decision='go' requires all 4 core gates (typecheck/lint/deps/tests) passing",
  )
  .refine(
    (r) => {
      // If decision='no-go', there should be at least 1 error-level violation.
      if (r.decision !== "no-go") return true;
      return r.violations.some((v) => v.severity === "error");
    },
    "decision='no-go' requires at least 1 error-level violation",
  );

export type QaReport = z.infer<typeof qaReportSchema>;
export type Violation = z.infer<typeof violationSchema>;

export function validateQaReport(input: unknown): string | null {
  const r = qaReportSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
