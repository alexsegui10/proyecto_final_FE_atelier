import { z } from "zod";

import { AGENT_NAMES_V3 } from "./agent-names";

/**
 * Schemas for the Visual QA Agent (v3 wave 7).
 *
 * The agent boots the generated app with Playwright headless, walks three
 * flows (client-anonymous, client-authenticated, admin), captures
 * screenshots + console/network events, and emits a structured report.
 *
 * It also reads `seed-manifest.json` written by the (future) Seeds &
 * Fixtures agent — that contract is captured in `seedManifestSchema` below
 * as a defensive read shape. The Seeds agent's eventual write shape is the
 * authority; this is just what Visual QA needs to FIND inside it.
 *
 * Authoritative reference: `ROADMAP_V3.md` § 3.6.
 */

// ─── seed-manifest.json (v1 — read-side defensive shape) ─────────────
//
// NOTE: this is the shape Visual QA depends on. When Seeds & Fixtures
// gets implemented (paso 9 del orden de implementación según el ROADMAP),
// the WRITE-side schema lives there and may add fields. We keep the
// `.passthrough()` so future additions don't break the read.

export const seedManifestSchema = z
  .object({
    domainSlug: z.enum(["yoga", "tutorias", "restaurant"]),
    adminEmail: z.string().email(),
    adminPassword: z.string().min(1),
    demoClientEmail: z.string().email(),
    demoClientPassword: z.string().min(1),
    /** Per-entity row counts, used by Visual QA to assert listings render data. */
    entityCounts: z.record(z.string().regex(/^[A-Z][A-Za-z0-9]*$/), z.number().int().nonnegative()),
    /** PascalCase entity name → stable slug/id of the canonical demo row. */
    primaryDemoIds: z.record(z.string().regex(/^[A-Z][A-Za-z0-9]*$/), z.string().min(1)),
  })
  .passthrough();

export type SeedManifest = z.infer<typeof seedManifestSchema>;

export function validateSeedManifest(input: unknown): string | null {
  const r = seedManifestSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}

// ─── visual-qa-report.json (primary artifact) ────────────────────────

const FLOW = z.enum(["setup", "client-anonymous", "client-authenticated", "admin"]);
const RUNTIME_FLOW = z.enum(["client-anonymous", "client-authenticated", "admin"]);

const screenshotSchema = z
  .object({
    stepName: z.string().min(1),
    path: z.string().regex(/^\.atelier\/screenshots\/.+\.png$/),
    capturedAt: z.string().datetime(),
    url: z.string(),
  })
  .strict();

const consoleEventSchema = z
  .object({
    level: z.enum(["error", "warning", "info"]),
    text: z.string().min(1),
    pageUrl: z.string(),
    source: z.string().optional(),
    flow: FLOW,
  })
  .strict();

const networkEventSchema = z
  .object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
    url: z.string(),
    status: z.number().int().optional(),
    failure: z.string().optional(),
    triggeredByStep: z.string(),
    flow: FLOW,
  })
  .strict();

const stepResultSchema = z
  .object({
    flow: RUNTIME_FLOW,
    name: z.string().min(1),
    startedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
    status: z.enum(["ok", "failed", "skipped"]),
    screenshot: z.string().optional(),
    /** Fault ids from skills/runtime-diagnostics. */
    detectedFaults: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).optional(),
    failureMessage: z.string().optional(),
  })
  .strict()
  .refine(
    (s) => s.status !== "failed" || (typeof s.failureMessage === "string" && s.failureMessage.length > 0),
    "failed step requires a non-empty failureMessage",
  );

const flowSummarySchema = z
  .object({
    flow: RUNTIME_FLOW,
    startedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
    stepsTotal: z.number().int().nonnegative(),
    stepsOk: z.number().int().nonnegative(),
    stepsFailed: z.number().int().nonnegative(),
    stepsSkipped: z.number().int().nonnegative(),
    decision: z.enum(["go", "no-go"]),
  })
  .strict()
  .refine(
    (f) => f.stepsOk + f.stepsFailed + f.stepsSkipped === f.stepsTotal,
    "stepsOk + stepsFailed + stepsSkipped must equal stepsTotal",
  );

const evidenceSchema = z
  .object({
    screenshot: z.string().optional(),
    stepName: z.string().optional(),
    consoleLog: z.string().optional(),
    networkLog: z.string().optional(),
  })
  .strict();

const visualQaViolationSchema = z
  .object({
    /** Fault id from skills/runtime-diagnostics — e.g. "db-unreachable", "hydration-mismatch". */
    rule: z.string().regex(/^[a-z][a-z0-9-]*$/, "rule must be a kebab-case fault id"),
    /**
     * Severity hierarchy:
     *   - `critical`: terminal failure that NEEDS human intervention. The
     *     orchestrator emits `generation.failed` instead of feeding into the
     *     fix loop. Examples: app boot definitively impossible after 3 fix
     *     rounds; contract violation between core agents that can't be
     *     auto-resolved.
     *   - `error`: bug the fix loop can route to an agent. Default for most
     *     Visual QA findings (404s, hydration mismatches, missing endpoints).
     *   - `warn`: documented but doesn't block go/no-go. E.g. selector
     *     flakiness while D2 (test-id contract) is unresolved.
     */
    severity: z.enum(["critical", "error", "warn"]),
    /** Target agent for the fix loop. Required even for critical (humans look here too). */
    agent: z.enum(AGENT_NAMES_V3 as readonly [string, ...string[]]),
    file: z.string().optional(),
    line: z.number().int().nonnegative().optional(),
    message: z.string().min(10),
    recommendedFix: z.string().min(10),
    evidence: evidenceSchema.optional(),
  })
  .strict();

export const visualQaReportSchema = z
  .object({
    generatedAt: z.string().datetime(),
    appUrl: z.string().url(),
    setup: z
      .object({
        setupCommand: z.string().min(1),
        setupDurationMs: z.number().int().nonnegative(),
        bootTimeMs: z.number().int().nonnegative(),
        healthcheckUrl: z.string(),
        healthcheckStatus: z.number().int(),
      })
      .strict(),
    flows: z.array(flowSummarySchema).min(1).max(3),
    steps: z.array(stepResultSchema).min(1),
    screenshots: z.array(screenshotSchema),
    consoleEvents: z.array(consoleEventSchema),
    networkEvents: z.array(networkEventSchema),
    violations: z.array(visualQaViolationSchema),
    decision: z.enum(["go", "no-go"]),
    summary: z.string().min(20),
    /** Path to the .spec.ts the agent generated and ran. Reproducibility. */
    playwrightScriptPath: z.string().regex(/^\.atelier\/visual-qa-script\..+$/),
  })
  .strict()
  // every declared flow has at least one step
  .refine(
    (a) => a.flows.every((f) => a.steps.some((s) => s.flow === f.flow)),
    "every declared flow must have at least one step in steps[]",
  )
  // decision='go' requires all flows green AND zero error-or-critical violations
  .refine(
    (a) =>
      a.decision === "no-go" ||
      (a.flows.every((f) => f.decision === "go") &&
        a.violations.every((v) => v.severity === "warn")),
    "decision='go' requires all flows green and zero error/critical violations",
  )
  // decision='no-go' requires evidence (a failed flow or a non-warn violation)
  .refine(
    (a) =>
      a.decision === "go" ||
      a.flows.some((f) => f.decision === "no-go") ||
      a.violations.some((v) => v.severity === "error" || v.severity === "critical"),
    "decision='no-go' requires at least one no-go flow or error/critical violation",
  )
  // critical violation FORCES decision='no-go' (bypasses any other claim)
  .refine(
    (a) => a.decision === "no-go" || a.violations.every((v) => v.severity !== "critical"),
    "any critical-severity violation forces decision='no-go'",
  );

export type Screenshot = z.infer<typeof screenshotSchema>;
export type ConsoleEvent = z.infer<typeof consoleEventSchema>;
export type NetworkEvent = z.infer<typeof networkEventSchema>;
export type StepResult = z.infer<typeof stepResultSchema>;
export type FlowSummary = z.infer<typeof flowSummarySchema>;
export type VisualQaViolation = z.infer<typeof visualQaViolationSchema>;
export type VisualQaReport = z.infer<typeof visualQaReportSchema>;

export function validateVisualQaReport(input: unknown): string | null {
  const r = visualQaReportSchema.safeParse(input);
  if (r.success) return null;
  return r.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}
