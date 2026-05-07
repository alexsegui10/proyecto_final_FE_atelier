export type PRDEntity = {
  name: string;
  fields: string[];
  notes?: string;
};

export type PRDState = {
  objective: string;
  roles: string[];
  entities: PRDEntity[];
  useCases: string[];
  notes: string[];
};

export type PartialPRDState = Partial<PRDState>;

export const EMPTY_PRD_STATE: PRDState = {
  objective: "",
  roles: [],
  entities: [],
  useCases: [],
  notes: [],
};

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item).trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * Merge a partial update from the agent into the running PRD state.
 *
 * Rules:
 * - `objective` is replaced if the partial includes a non-empty string
 * - String arrays (roles, useCases, notes) are unioned and de-duplicated
 *   case-insensitively
 * - `entities` are merged by `name` (case-insensitive); a later entity with
 *   the same name overrides fields/notes
 * - Anything not present in the partial is left untouched
 */
export function mergePRDState(current: PRDState, partial: PartialPRDState): PRDState {
  const next: PRDState = {
    objective: current.objective,
    roles: [...current.roles],
    entities: current.entities.map((e) => ({ ...e, fields: [...e.fields] })),
    useCases: [...current.useCases],
    notes: [...current.notes],
  };

  if (typeof partial.objective === "string" && partial.objective.trim().length > 0) {
    next.objective = partial.objective.trim();
  }

  if (Array.isArray(partial.roles)) {
    next.roles = dedupe([...next.roles, ...partial.roles.filter((r): r is string => typeof r === "string")], (r) => r);
  }

  if (Array.isArray(partial.useCases)) {
    next.useCases = dedupe(
      [...next.useCases, ...partial.useCases.filter((u): u is string => typeof u === "string")],
      (u) => u,
    );
  }

  if (Array.isArray(partial.notes)) {
    next.notes = dedupe([...next.notes, ...partial.notes.filter((n): n is string => typeof n === "string")], (n) => n);
  }

  if (Array.isArray(partial.entities)) {
    const byName = new Map<string, PRDEntity>();
    for (const entity of next.entities) {
      byName.set(entity.name.trim().toLowerCase(), entity);
    }
    for (const incoming of partial.entities) {
      if (!incoming || typeof incoming.name !== "string" || incoming.name.trim().length === 0) {
        continue;
      }
      const key = incoming.name.trim().toLowerCase();
      const existing = byName.get(key);
      const mergedFields = dedupe(
        [
          ...(existing?.fields ?? []),
          ...(Array.isArray(incoming.fields)
            ? incoming.fields.filter((f): f is string => typeof f === "string")
            : []),
        ],
        (f) => f,
      );
      byName.set(key, {
        name: existing?.name ?? incoming.name.trim(),
        fields: mergedFields,
        notes: incoming.notes ?? existing?.notes,
      });
    }
    next.entities = Array.from(byName.values());
  }

  return next;
}

/**
 * Decide whether the PRD is rich enough to start building.
 * Mirrors the `READY_TO_BUILD` thresholds documented in discovery.md.
 *
 * Phase 3 sprint 2B raised the bar:
 *   - 4+ entities (was 3)
 *   - 2+ roles (unchanged)
 *   - 8+ useCases (was 6)
 *   - every entity has ≥3 documented fields (new)
 *   - objective non-empty
 */
export function isPRDReady(state: PRDState): boolean {
  if (state.objective.trim().length === 0) return false;
  if (state.roles.length < 2) return false;
  if (state.entities.length < 4) return false;
  if (state.useCases.length < 8) return false;
  if (state.entities.some((e) => e.fields.length < 3)) return false;
  return true;
}

/**
 * 0-100% measure of how filled-in the PRD is, used by the Discover UI to
 * show the "PRD madurez" bar. Hits 100% only when `isPRDReady` is true and
 * notes have at least one entry — that final 10% nudges the user to
 * articulate business rules.
 *
 * Component breakdown:
 *   objective non-empty         → 10pts
 *   roles (proportional, cap 2) → 15pts
 *   entities (proportional, cap 4) → 25pts
 *   3+ fields per entity (proportional) → 20pts
 *   useCases (proportional, cap 8) → 20pts
 *   notes (≥1) → 10pts
 *   total = 100
 */
export function prdMaturity(state: PRDState): number {
  let score = 0;
  if (state.objective.trim().length > 0) score += 10;
  score += Math.min(2, state.roles.length) * 7.5;
  score += Math.min(4, state.entities.length) * 6.25;
  if (state.entities.length > 0) {
    const avgFields =
      state.entities.reduce((sum, e) => sum + Math.min(3, e.fields.length), 0) /
      state.entities.length;
    score += (avgFields / 3) * 20;
  }
  score += Math.min(8, state.useCases.length) * 2.5;
  if (state.notes.length > 0) score += 10;
  return Math.round(score);
}

/**
 * Extract the FIRST fenced ```json``` block from agent text.
 * Returns the parsed object or null if none / invalid.
 */
export function extractStateBlock(text: string): unknown | null {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Detect the READY_TO_BUILD sentinel as a standalone token.
 */
export function detectReadySignal(text: string): boolean {
  return /(^|\n)\s*READY_TO_BUILD\s*(\n|$)/.test(text);
}
