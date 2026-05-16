/**
 * Atelier v3 generator-agent runner config.
 *
 * The runner implementation is the same as v2 — we reuse {@link runGeneratorAgentV2}
 * verbatim because the subprocess plumbing (spawn `claude.exe`, stream stdout,
 * detect stop sentinel, validate artifact JSON, diff file tree) is identical.
 *
 * What changes in v3 is the **per-agent config table**: AGENT_CONFIG_V3 holds
 * the 22-agent timeouts + stop sentinels, including the 6 net-new agents
 * introduced by v3 (bootstrap-devops, layout-architect, brand-identity,
 * visual-adapter, accessibility, visual-qa).
 *
 * Defaults are deliberately conservative — yoga + tutorias v2 taught us that
 * underestimating wave-4 agents leads to wasted runs. We bump conservatively
 * and let real telemetry tune them down later.
 */
import type { AgentNameV3 } from "../contracts-v3/agent-names";
import {
  AGENT_CONFIG_V2,
  runGeneratorAgentV2,
  type AgentConfigEntry,
  type GeneratorAgentInput,
  type GeneratorAgentResult,
} from "./runner-generator-v2";

export type { AgentConfigEntry, GeneratorAgentInput, GeneratorAgentResult };

// ─── v3 config ──────────────────────────────────────────────────────

/**
 * 22 entries used in v3: 16 of the 17 v2 configs (pages-routing dropped in
 * v3 — its app/* role is absorbed by visual-adapter) + 6 new agent configs.
 * AGENT_CONFIG_V2 is still spread verbatim (v2 intact); the pages-routing
 * v2 config simply goes unused because WAVES_V3 never schedules it.
 *
 * Bootstrap-devops: small artifact + many tiny files (env.example, scripts,
 * etc.). 8 min is plenty.
 * Layout-architect: needs to call Stitch via MCP, can be slow. 20 min.
 * Brand-identity: token decisions + microcopy bundle. Comparable to
 * ux-ui-designer. 15 min.
 * Visual-adapter: reads HTML literal per page, parses with cheerio, mutates
 * (inject test-ids + microcopy + preserve fonts + wire forms/data/auth),
 * serializes JSX, writes app/<route>/page.tsx. Worst case 35 min for an
 * 8-page app — the adapter does substantial work per page but no LLM
 * generation of look (Stitch already did that).
 * Accessibility: audits + patches across many files. 20 min.
 * Visual-qa: runs Playwright suites + Claude Vision analysis. Worst case
 * 40 min (post-yoga lesson: don't underestimate boot+probe latency).
 */
export const AGENT_CONFIG_V3: Record<AgentNameV3, AgentConfigEntry> = {
  // ── Inherited from v2 ──────────────────────────────────────────────
  ...AGENT_CONFIG_V2,

  // ── v3 net-new ─────────────────────────────────────────────────────
  "bootstrap-devops": {
    timeoutMs: 8 * 60_000,
    model: "opus",
    stopSentinel: "BOOTSTRAP_DEVOPS_DONE",
  },
  "layout-architect": {
    timeoutMs: 20 * 60_000,
    model: "opus",
    stopSentinel: "LAYOUT_ARCHITECT_DONE",
  },
  "brand-identity": {
    timeoutMs: 15 * 60_000,
    model: "opus",
    stopSentinel: "BRAND_IDENTITY_DONE",
  },
  "visual-adapter": {
    timeoutMs: 35 * 60_000,
    model: "opus",
    stopSentinel: "VISUAL_ADAPTER_DONE",
  },
  accessibility: {
    timeoutMs: 20 * 60_000,
    model: "opus",
    stopSentinel: "ACCESSIBILITY_DONE",
  },
  "visual-qa": {
    timeoutMs: 40 * 60_000,
    model: "opus",
    stopSentinel: "VISUAL_QA_DONE",
  },
};

// ─── Re-export the v2 runner (it accepts any agent name string) ─────

/**
 * Run a v3 generator agent. The underlying implementation is the v2 runner —
 * `runGeneratorAgentV2`'s only typed dependency is `AgentNameV2`, and the
 * `stopSentinel` field of the input is read from the config table the caller
 * passes in. We don't pass `AGENT_CONFIG_V2`; we pass `AGENT_CONFIG_V3`.
 *
 * To keep the v2 runner intact without widening its signature, this wrapper
 * coerces the v3 agent name down to the v2 type at the boundary. The runner
 * never introspects the agent name beyond logging + config lookup, so this
 * is safe.
 */
export async function runGeneratorAgentV3(
  input: Omit<GeneratorAgentInput, "agent"> & { agent: AgentNameV3 },
): Promise<GeneratorAgentResult> {
  const cfg = AGENT_CONFIG_V3[input.agent];
  const v2input: GeneratorAgentInput = {
    ...input,
    agent: input.agent as never, // safe: v2 runner uses the name as a string
    // Forward the v3 config explicitly so the v2 runner can resolve sentinel,
    // timeout and model for agents that don't exist in AGENT_CONFIG_V2.
    configOverride: cfg,
  };
  return runGeneratorAgentV2(v2input);
}
