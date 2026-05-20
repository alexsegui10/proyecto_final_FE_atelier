/**
 * Slowness absorber: `ATELIER_TIMEOUT_MULTIPLIER` env var multiplies every
 * agent subprocess timeout uniformly.
 *
 * Default 1.0 (no change). Use 1.5 during claude.exe / API slowdown
 * windows to avoid bump-by-bump whack-a-mole — F3-runs 17-20 burned 4
 * consecutive 2h cycles each fixing one agent's timeout while the
 * systemic ~1.5x slowdown affected ALL of them uniformly. One env-var
 * multiplier resolves the root cause; per-agent `AGENT_CONFIG.timeoutMs`
 * remains the per-task baseline.
 *
 * Bounds: [0.5, 5.0]. Out-of-range or non-numeric → warn + default 1.0
 * (catches typos like `15` for `1.5`).
 *
 * Scope: applied at a SINGLE site — `runGeneratorAgentV2` resolves the
 * effective per-agent `timeoutMs` from `config.timeoutMs` and pipes it
 * to the subprocess executor that spawns claude.exe. v3 agents pass
 * through the same path via `configOverride`, so v2 and v3 both
 * benefit. NOT applied to `input.timeoutMs` overrides (tests pass
 * literal short values like 100ms and would break with multiplication),
 * to `file-based-approval` (human-paced 24h polling), or to
 * `format-rescue` (deterministic `pnpm format`, not LLM-paced).
 *
 * Closes deuda #25.
 */

export const TIMEOUT_MULTIPLIER_ENV = "ATELIER_TIMEOUT_MULTIPLIER";

const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 5.0;
const DEFAULT_MULTIPLIER = 1.0;

function parseMultiplier(
  raw: string | undefined,
  warn: (msg: string) => void,
): number {
  if (raw === undefined || raw === "") return DEFAULT_MULTIPLIER;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    warn(
      `[timeout-multiplier] ${TIMEOUT_MULTIPLIER_ENV}="${raw}" is not a number — using ${DEFAULT_MULTIPLIER}`,
    );
    return DEFAULT_MULTIPLIER;
  }
  if (n < MIN_MULTIPLIER || n > MAX_MULTIPLIER) {
    warn(
      `[timeout-multiplier] ${TIMEOUT_MULTIPLIER_ENV}=${n} out of bounds [${MIN_MULTIPLIER}, ${MAX_MULTIPLIER}] — using ${DEFAULT_MULTIPLIER}`,
    );
    return DEFAULT_MULTIPLIER;
  }
  return n;
}

/**
 * Read the current multiplier from the environment. Per-call (not cached):
 * the cost is a single `Number()` call, negligible vs the multi-minute
 * agent invocations this guards.
 */
export function getTimeoutMultiplier(
  env: Record<string, string | undefined> = process.env,
  warn: (msg: string) => void = (m) => console.warn(m),
): number {
  return parseMultiplier(env[TIMEOUT_MULTIPLIER_ENV], warn);
}

/**
 * Apply the multiplier to a baseline timeout. Rounds to an integer so
 * the executor doesn't see floats.
 */
export function applyTimeoutMultiplier(
  timeoutMs: number,
  env: Record<string, string | undefined> = process.env,
  warn: (msg: string) => void = (m) => console.warn(m),
): number {
  return Math.round(timeoutMs * parseMultiplier(env[TIMEOUT_MULTIPLIER_ENV], warn));
}
