/**
 * Artifact boundary validation (B-w4-5b).
 *
 * The runner composes each agent's emitted `.atelier/*.json` into the
 * artifact bundle the orchestrator hands to gates. A v2-reused or even a
 * v3 agent driven by a non-deterministic LLM can emit a structurally
 * wrong shape (observed in F3-run-10a: layout-architect wrote
 * `{ "selectors": [...] }` instead of `{ "entries": [...] }`). If that
 * malformed artifact flows downstream, a gate that iterates
 * `artifact.entries` throws an uncaught exception and the whole
 * generation dies with `generation.failed` — instead of the orchestrator
 * treating it as an agent failure it can reprompt or escalate (B12).
 *
 * This module validates emitted artifacts AT THE BOUNDARY (right after the
 * runner produced them, before they reach any gate). A schema violation
 * here throws — and a throw from the runner is the established signal the
 * orchestrator interprets as "agent failed" (same as
 * `result.status === "failed"`), which routes into the reprompt / B12 path
 * rather than a fatal gate crash.
 *
 * Generic by design: callers pass a map of `.atelier` filename → validator
 * (the `validateX(input): string | null` convention every contracts-v3
 * schema already exports). Extending coverage to more artifacts
 * (layout-tree, stitch-analysis, brand-identity, page-adaptation) is just
 * adding entries to a slot's `validators` map — see R5 in V3_PROGRESS.md.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** `validateX(input) => null` when valid, or a short error string. */
export type ArtifactValidator = (input: unknown) => string | null;

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Notified once per artifact that passed schema validation. */
export type OnValidArtifact = (
  agent: string,
  file: string,
) => void | Promise<void>;

/**
 * Validate every `(filename → validator)` pair for `agent` against the
 * files it emitted under `<workDir>/.atelier/`. Throws on the first
 * unreadable / non-JSON / schema-violating artifact with a message that
 * names the agent, the file and the schema error — so the orchestrator
 * fails the agent cleanly at the boundary instead of letting the bad
 * shape cascade into a downstream gate throw.
 *
 * No-op when `validators` is undefined or empty.
 *
 * The success path used to be entirely silent (B-w4-11/12: an absent log
 * line was indistinguishable from "validator never ran" when auditing
 * F3-run-13). `onValid` is invoked once per artifact that passes so the
 * runner can emit a `[boundary] ✓` trace into `_orchestration.log`. It
 * never affects the error path — a schema violation still throws.
 */
export async function assertArtifactsValid(
  agent: string,
  workDir: string,
  validators: Record<string, ArtifactValidator> | undefined,
  onValid?: OnValidArtifact,
): Promise<void> {
  if (!validators) return;
  for (const [file, validate] of Object.entries(validators)) {
    const path = join(workDir, ".atelier", file);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (e) {
      throw new Error(
        `agent ${agent} emitted unreadable or non-JSON .atelier/${file}: ${describeError(e)} ` +
          `(B-w4-5b boundary validation — agent must re-emit a parseable artifact)`,
      );
    }
    const err = validate(parsed);
    if (err !== null) {
      throw new Error(
        `agent ${agent} emitted .atelier/${file} that violates its schema: ${err}. ` +
          `(B-w4-5b boundary validation — likely an LLM field-name synonym, e.g. ` +
          `'selectors' instead of 'entries'. Reprompt the agent or pin the shape ` +
          `in its prompt; do NOT let this reach a gate.)`,
      );
    }
    await onValid?.(agent, file);
  }
}
