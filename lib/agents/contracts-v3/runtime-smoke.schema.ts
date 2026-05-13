import { z } from "zod";

import { AGENT_NAMES_V3 } from "./agent-names";

/**
 * Schemas for the Runtime Smoke gate (Gate 5 in ROADMAP_V3 § 5.1).
 *
 * The gate is a PROGRAMMATIC pre-wave check that runs BEFORE wave-7-runtime-qa
 * (Visual QA). It opens HTTP probes against an already-running app and
 * confirms the basic shape responds (home, sign-in/sign-up, route protection,
 * a public listing). It is NOT a Visual QA replacement — it's the cheap fast
 * fail before paying for browser orchestration.
 *
 * Output artifact: `.atelier/runtime-smoke-report.json`. Violations are also
 * merged into `GenerationV3Result.gateViolations` by the orchestrator.
 *
 * Authoritative reference: `ROADMAP_V3.md` § 5.1.
 */

// ─── Probe definition ────────────────────────────────────────────────

export const SMOKE_PROBE_METHODS = ["GET", "HEAD"] as const;

export const smokeProbeSchema = z
  .object({
    /** Stable kebab-case id (also the violation routing key). */
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    method: z.enum(SMOKE_PROBE_METHODS),
    /** Path relative to appUrl (must start with `/`). */
    path: z.string().regex(/^\/.*/),
    /** Expected HTTP status range (inclusive). */
    expectedStatusMin: z.number().int().min(100).max(599),
    expectedStatusMax: z.number().int().min(100).max(599),
    /** Human-readable purpose for the qa-reviewer LLM + humans. */
    intent: z.string().min(5),
    /** Provenance of this probe — what derived it. */
    derivedFrom: z.enum([
      "default",
      "architect.publicRoutes",
      "architect.privateRoutes",
      "architect.adminRoutes",
      "explicit",
    ]),
  })
  .strict()
  .refine(
    (p) => p.expectedStatusMin <= p.expectedStatusMax,
    "expectedStatusMin must be <= expectedStatusMax",
  );

// ─── Probe result ───────────────────────────────────────────────────

export const smokeProbeResultSchema = z
  .object({
    probe: smokeProbeSchema,
    /** null when the request never reached a status (network failure). */
    actualStatus: z.number().int().nullable(),
    passed: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    /** Populated on network failure or non-fetch error. */
    failure: z.string().optional(),
  })
  .strict();

// ─── Violation (uses the same shape pattern as Visual QA) ────────────

export const runtimeSmokeViolationSchema = z
  .object({
    rule: z.string().regex(/^[a-z][a-z0-9-]*$/, "rule must be a kebab-case fault id"),
    severity: z.enum(["critical", "error", "warn"]),
    agent: z.enum(AGENT_NAMES_V3 as readonly [string, ...string[]]),
    probeId: z.string().regex(/^[a-z][a-z0-9-]*$/),
    message: z.string().min(10),
    recommendedFix: z.string().min(10),
  })
  .strict();

// ─── Full report ────────────────────────────────────────────────────

export const runtimeSmokeReportSchema = z
  .object({
    generatedAt: z.string().datetime(),
    appUrl: z.string().url(),
    probes: z.array(smokeProbeSchema).min(1, "at least one probe"),
    results: z.array(smokeProbeResultSchema),
    violations: z.array(runtimeSmokeViolationSchema),
    decision: z.enum(["pass", "fail"]),
    totalDurationMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine(
    (r) => r.results.length === r.probes.length,
    "results count must equal probes count",
  )
  .refine(
    (r) => r.decision === "fail" || r.violations.every((v) => v.severity === "warn"),
    "decision='pass' requires zero error/critical violations",
  )
  .refine(
    (r) =>
      r.decision === "pass" ||
      r.results.some((res) => !res.passed) ||
      r.violations.some((v) => v.severity !== "warn"),
    "decision='fail' requires a failed probe or an error/critical violation",
  );

export type SmokeProbe = z.infer<typeof smokeProbeSchema>;
export type SmokeProbeResult = z.infer<typeof smokeProbeResultSchema>;
export type RuntimeSmokeViolation = z.infer<typeof runtimeSmokeViolationSchema>;
export type RuntimeSmokeReport = z.infer<typeof runtimeSmokeReportSchema>;

export function validateRuntimeSmokeReport(input: unknown): string | null {
  const r = runtimeSmokeReportSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
