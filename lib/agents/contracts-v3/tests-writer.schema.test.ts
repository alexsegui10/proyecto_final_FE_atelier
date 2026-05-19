import { describe, it, expect } from "vitest";

import {
  validateTestsWriter,
  type TestsWriter,
} from "./tests-writer.schema";

// ─── Fixture builder — mirrors the real F3-run-14 shape ─────────────

function tw(over: Partial<TestsWriter> = {}): TestsWriter {
  return {
    generatedAt: "2026-05-19T13:20:00.000Z",
    runner: { unit: "vitest", integration: "vitest", e2e: "playwright" },
    files: [
      { path: "tests/fixtures/in-memory-repos.ts", layer: "fixtures", tests: 0, notes: "barrel re-export" },
      { path: "tests/unit/classes/ClassesService.test.ts", layer: "unit", tests: 24, feature: "classes" },
      { path: "tests/e2e/auth-flow.spec.ts", layer: "e2e", tests: 3 },
    ],
    counts: { unit: 59, integration: 50, e2e: 13, total: 122 },
    coverage: { servicesPercent: 88, controllersPercent: 100, endpointsCovered: 16, endpointsTotal: 16 },
    verification: {
      unitIntegrationStatus: "green",
      command: "npx vitest run tests/unit tests/integration",
      result: "6 files, 109 tests passed",
    },
    notes: ["Unit complementan los tests de Wave 3 con edge cases"],
    ...over,
  };
}

describe("validateTestsWriter — shape-only + counts refinement (v3 wave-5b)", () => {
  it("accepts the real F3-run-14 shape", () => {
    expect(validateTestsWriter(tw())).toBeNull();
  });

  it("accepts files entries with neither notes nor feature (e2e shape)", () => {
    expect(
      validateTestsWriter(tw({ files: [{ path: "tests/e2e/x.spec.ts", layer: "e2e", tests: 1 }] })),
    ).toBeNull();
  });

  it("does NOT .strict() top-level — tolerates a benign extra field", () => {
    expect(validateTestsWriter({ ...tw(), extraDrift: "ignored" })).toBeNull();
  });

  it("rejects counts.total that does not equal unit+integration+e2e (refinement)", () => {
    const r = validateTestsWriter(tw({ counts: { unit: 59, integration: 50, e2e: 13, total: 999 } }));
    expect(r).toMatch(/counts\.total must equal/);
  });

  it("rejects coverage percent above 100", () => {
    const r = validateTestsWriter(
      tw({ coverage: { servicesPercent: 120, controllersPercent: 100, endpointsCovered: 1, endpointsTotal: 1 } }),
    );
    expect(r).toMatch(/coverage\.servicesPercent/);
  });

  it("rejects a files entry missing path", () => {
    const r = validateTestsWriter(
      tw({ files: [{ layer: "unit", tests: 1 } as never] }),
    );
    expect(r).toMatch(/files\.0\.path/);
  });

  it("rejects an unknown key inside the strict files sub-object", () => {
    const r = validateTestsWriter(
      tw({ files: [{ path: "p", layer: "unit", tests: 1, rogue: 1 } as never] }),
    );
    expect(r).toMatch(/files\.0/);
  });

  it("rejects a missing runner sub-field (strict)", () => {
    const r = validateTestsWriter(
      tw({ runner: { unit: "vitest", integration: "vitest" } as never }),
    );
    expect(r).toMatch(/runner\.e2e/);
  });

  it("rejects verification as a non-record (array)", () => {
    const r = validateTestsWriter(tw({ verification: ["green"] as never }));
    expect(r).toMatch(/verification/);
  });
});
