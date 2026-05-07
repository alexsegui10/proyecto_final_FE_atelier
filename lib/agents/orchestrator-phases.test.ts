import { describe, it, expect } from "vitest";

import { phasesFor } from "./orchestrator";
import { GENERATOR_AGENT_ORDER, GENERATOR_PHASES } from "./shared-state";

describe("phasesFor", () => {
  it("returns the canonical GENERATOR_PHASES when no custom subset is given", () => {
    expect(phasesFor()).toBe(GENERATOR_PHASES);
  });

  it("collapses to single-agent phases when a custom subset is given (no parallelization)", () => {
    const phases = phasesFor(["architect", "qa-reviewer"]);
    expect(phases).toEqual([["architect"], ["qa-reviewer"]]);
  });

  it("respects canonical order even when the custom subset is unordered", () => {
    const phases = phasesFor(["qa-reviewer", "architect", "use-cases"]);
    expect(phases.map((p) => p[0])).toEqual([
      "architect",
      "use-cases",
      "qa-reviewer",
    ]);
  });

  it("the default phases include exactly one parallel group", () => {
    const parallelPhases = GENERATOR_PHASES.filter((p) => p.length > 1);
    expect(parallelPhases).toHaveLength(1);
    expect(parallelPhases[0]).toEqual(["use-cases", "auth-rbac"]);
  });

  it("the union of phase agents equals the canonical agent list", () => {
    const flat = GENERATOR_PHASES.flat();
    expect([...flat].sort()).toEqual([...GENERATOR_AGENT_ORDER].sort());
    expect(flat).toHaveLength(GENERATOR_AGENT_ORDER.length);
  });

  it("phases are ordered to respect input dependencies", () => {
    // domain-persistence must come before any agent that depends on it.
    // architect must be first.
    const flat = GENERATOR_PHASES.flat();
    expect(flat[0]).toBe("architect");
    expect(flat.indexOf("architect")).toBeLessThan(
      flat.indexOf("domain-persistence"),
    );
    expect(flat.indexOf("domain-persistence")).toBeLessThan(
      flat.indexOf("use-cases"),
    );
    expect(flat.indexOf("domain-persistence")).toBeLessThan(
      flat.indexOf("auth-rbac"),
    );
    expect(
      Math.max(flat.indexOf("use-cases"), flat.indexOf("auth-rbac")),
    ).toBeLessThan(flat.indexOf("api-frontend"));
    expect(flat.indexOf("api-frontend")).toBeLessThan(
      flat.indexOf("qa-reviewer"),
    );
  });
});
