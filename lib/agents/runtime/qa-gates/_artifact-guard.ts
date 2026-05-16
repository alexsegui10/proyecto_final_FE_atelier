/**
 * Defensive artifact-field access for QA gates (B-w4-5a).
 *
 * A gate is a pure function that returns `QaViolationV3[]`. It must NEVER
 * throw on a structurally malformed artifact — a throw from a postWaveGate
 * is uncaught and kills the whole run with `generation.failed` (the
 * F3-run-10a crash: `for (const e of testIdContract.entries)` where the
 * LLM had emitted `{ selectors: [...] }`, so `.entries` was `undefined`).
 *
 * `expectArray` is the single chokepoint: when the field is a real array
 * it's returned as-is; otherwise an `error`-severity violation is pushed
 * and an empty array is returned so the caller's loop is a clean no-op.
 * The boundary validator (B-w4-5b) should catch most of these earlier and
 * fail the agent; this is the in-gate safety net for anything that slips
 * through (e.g. gates wired without boundary validation).
 */
import type { QaViolationV3 } from "../../orchestrator-v3";

export interface ExpectArrayCtx {
  /** Violations sink — the gate's accumulator. */
  violations: QaViolationV3[];
  /** Stable rule id, e.g. `"test-id-contract-malformed"`. */
  rule: string;
  /** Owning agent for routing the violation. */
  agent: string;
  /** Artifact path for the violation, e.g. `".atelier/test-id-contract.json"`. */
  file: string;
  /** Dotted field being accessed, e.g. `"testIdContract.entries"`. */
  field: string;
}

function describeKind(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * Return `value` when it is an array; otherwise push an `error` violation
 * describing the malformed field and return `[]` (never throw).
 */
export function expectArray<T>(value: unknown, ctx: ExpectArrayCtx): readonly T[] {
  if (Array.isArray(value)) return value as T[];
  ctx.violations.push({
    rule: ctx.rule,
    severity: "error",
    agent: ctx.agent,
    file: ctx.file,
    message:
      `${ctx.field} is missing or not an array (got ${describeKind(value)}); ` +
      `the artifact shape is invalid. The producing agent likely used a ` +
      `field-name synonym or omitted the field.`,
    recommendedFix:
      `Re-emit the artifact conforming to its schema so ${ctx.field} is a ` +
      `proper array. This should normally be caught at the runner boundary ` +
      `(B-w4-5b); if you see this violation, that agent's slot has no ` +
      `boundary validator wired yet.`,
  });
  return [];
}
