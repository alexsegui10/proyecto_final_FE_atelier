import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createStitchFixturePreparerGate,
  prepareStitchFixtureForAttempt,
  readStitchAttemptFromRunState,
} from "./stitch-fixture-helper";

let workDir: string;
let fixturePath: string;

const VALID_FIXTURE = {
  stitchProjectId: "fix-001",
  designVibe: "Calm",
  designMd: "# Synthetic design\n\nTwo pages, two attempts.",
  attempts: [
    {
      attempt: 0,
      screens: [
        {
          screenId: "scr-001",
          routeSlug: "home",
          pageRoute: "/",
          rawHtml: "<!doctype html><html><body><header><h1>Home v0</h1></header><main>x</main></body></html>",
        },
        {
          screenId: "scr-002",
          routeSlug: "sign-in",
          pageRoute: "/sign-in",
          rawHtml: "<!doctype html><html><body><h1>Sign in v0</h1></body></html>",
        },
      ],
    },
    {
      attempt: 1,
      screens: [
        {
          screenId: "scr-001-v1",
          routeSlug: "home",
          pageRoute: "/",
          rawHtml: "<!doctype html><html><body><header><nav>n</nav><h1>Home v1</h1></header><main>x</main></body></html>",
        },
        {
          screenId: "scr-002-v1",
          routeSlug: "sign-in",
          pageRoute: "/sign-in",
          rawHtml: "<!doctype html><html><body><form aria-label='signin'><input/><input/><button>Go</button></form></body></html>",
        },
      ],
    },
  ],
};

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "fixture-helper-test-"));
  fixturePath = join(workDir, "fixture.json");
  writeFileSync(fixturePath, JSON.stringify(VALID_FIXTURE), "utf8");
});

afterEach(() => {
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
});

// ─── prepareStitchFixtureForAttempt ─────────────────────────────────

describe("prepareStitchFixtureForAttempt", () => {
  it("materialises attempt 0 to .atelier/stitch-html and .atelier/stitch-mockups", async () => {
    const result = await prepareStitchFixtureForAttempt({
      workDir,
      fixturePath,
      attempt: 0,
    });
    expect(result.attempt).toBe(0);
    expect(existsSync(join(workDir, ".atelier/stitch-html/home.html"))).toBe(true);
    expect(existsSync(join(workDir, ".atelier/stitch-html/sign-in.html"))).toBe(true);
    expect(existsSync(join(workDir, ".atelier/stitch-mockups/home.png"))).toBe(true);
    expect(existsSync(join(workDir, ".atelier/stitch-mockups/sign-in.png"))).toBe(true);
    expect(existsSync(join(workDir, ".atelier/stitch-design.md"))).toBe(true);
    expect(existsSync(join(workDir, ".atelier/stitch-fixture-state.json"))).toBe(true);
    expect(result.fixtureStatePath).toBe(".atelier/stitch-fixture-state.json");

    const html0 = readFileSync(join(workDir, ".atelier/stitch-html/home.html"), "utf8");
    expect(html0).toContain("Home v0");
  });

  it("materialises attempt 1 with different content than attempt 0", async () => {
    await prepareStitchFixtureForAttempt({ workDir, fixturePath, attempt: 0 });
    await prepareStitchFixtureForAttempt({ workDir, fixturePath, attempt: 1 });
    const html1 = readFileSync(join(workDir, ".atelier/stitch-html/home.html"), "utf8");
    expect(html1).toContain("Home v1");
    const signin1 = readFileSync(join(workDir, ".atelier/stitch-html/sign-in.html"), "utf8");
    expect(signin1).toContain("<form");
  });

  it("writes the fixture-state.json with the matching attempt + projectId + designVibe", async () => {
    await prepareStitchFixtureForAttempt({ workDir, fixturePath, attempt: 1 });
    const state = JSON.parse(
      readFileSync(join(workDir, ".atelier/stitch-fixture-state.json"), "utf8"),
    );
    expect(state.mode).toBe("fixture");
    expect(state.attempt).toBe(1);
    expect(state.stitchProjectId).toBe("fix-001");
    expect(state.designVibe).toBe("Calm");
    expect(state.designMdPath).toBe(".atelier/stitch-design.md");
    expect(state.screens).toHaveLength(2);
    expect(state.screens[0].pageRoute).toBe("/");
    expect(state.screens[0].rawHtmlPath).toBe(".atelier/stitch-html/home.html");
  });

  it("throws when fixture does not validate", async () => {
    const bad = { ...VALID_FIXTURE, attempts: [] };
    writeFileSync(fixturePath, JSON.stringify(bad), "utf8");
    await expect(
      prepareStitchFixtureForAttempt({ workDir, fixturePath, attempt: 0 }),
    ).rejects.toThrow(/Invalid Stitch fixture/);
  });

  it("CLAMPS gracefully when requested attempt is ABOVE max declared (B8)", async () => {
    // Fixture has attempts 0 and 1. Orchestrator can ask for 2.
    const result = await prepareStitchFixtureForAttempt({
      workDir,
      fixturePath,
      attempt: 2,
    });
    expect(result.attempt).toBe(1); // clamped to max declared
    expect(result.clampedFromMissing).toBe(true);

    // Content materialised matches attempt 1 (not attempt 0).
    const html = readFileSync(join(workDir, ".atelier/stitch-html/home.html"), "utf8");
    expect(html).toContain("Home v1");

    // State file records the EFFECTIVE attempt, not the requested one.
    const state = JSON.parse(
      readFileSync(join(workDir, ".atelier/stitch-fixture-state.json"), "utf8"),
    );
    expect(state.attempt).toBe(1);
  });

  it("does NOT clamp when requested attempt exists (clampedFromMissing=false)", async () => {
    const result = await prepareStitchFixtureForAttempt({
      workDir,
      fixturePath,
      attempt: 1,
    });
    expect(result.attempt).toBe(1);
    expect(result.clampedFromMissing).toBe(false);
  });

  it("throws when requested attempt is BELOW max but the gap is real (e.g. fixture has 0 and 2 but not 1)", async () => {
    // Skip-numbered attempts are a malformed fixture, NOT a clamp case.
    // (Note: stitchFixtureSchema's consecutive-attempts refinement already
    //  blocks this; the test asserts the preparer would also catch it if
    //  somehow validation slipped.)
    const malformed = {
      ...VALID_FIXTURE,
      attempts: VALID_FIXTURE.attempts.map((a, i) =>
        i === 1 ? { ...a, attempt: 2 } : a,
      ),
    };
    // Schema-level validation will trip first.
    writeFileSync(fixturePath, JSON.stringify(malformed), "utf8");
    await expect(
      prepareStitchFixtureForAttempt({ workDir, fixturePath, attempt: 1 }),
    ).rejects.toThrow(); // either "Invalid Stitch fixture" or "no entry for attempt=1"
  });
});

// ─── readStitchAttemptFromRunState ──────────────────────────────────

describe("readStitchAttemptFromRunState", () => {
  it("returns 0 when run-state.json does not exist", async () => {
    expect(await readStitchAttemptFromRunState(workDir)).toBe(0);
  });

  it("reads stitchAttempt from run-state.json", async () => {
    writeFileSync(
      join(workDir, ".atelier"),
      "",
      { flag: "w" },
    );
    // Recreate as directory
    rmSync(join(workDir, ".atelier"));
    const fs = await import("node:fs/promises");
    await fs.mkdir(join(workDir, ".atelier"), { recursive: true });
    await fs.writeFile(
      join(workDir, ".atelier/run-state.json"),
      JSON.stringify({ currentWave: "wave-2-design", stitchAttempt: 1 }),
      "utf8",
    );
    expect(await readStitchAttemptFromRunState(workDir)).toBe(1);
  });

  it("falls back to 0 for malformed run-state.json", async () => {
    const fs = await import("node:fs/promises");
    await fs.mkdir(join(workDir, ".atelier"), { recursive: true });
    await fs.writeFile(join(workDir, ".atelier/run-state.json"), "not json", "utf8");
    expect(await readStitchAttemptFromRunState(workDir)).toBe(0);
  });

  it("clamps invalid attempt numbers to 0", async () => {
    const fs = await import("node:fs/promises");
    await fs.mkdir(join(workDir, ".atelier"), { recursive: true });
    await fs.writeFile(
      join(workDir, ".atelier/run-state.json"),
      JSON.stringify({ stitchAttempt: 99 }),
      "utf8",
    );
    expect(await readStitchAttemptFromRunState(workDir)).toBe(0);
  });
});

// ─── createStitchFixturePreparerGate ────────────────────────────────

describe("createStitchFixturePreparerGate", () => {
  it("prepares attempt 0 on first invocation, returns no violations", async () => {
    const gate = createStitchFixturePreparerGate({ fixturePath });
    const violations = await gate.run({ workDir, artifacts: {} });
    expect(violations).toEqual([]);
    expect(existsSync(join(workDir, ".atelier/stitch-html/home.html"))).toBe(true);
  });

  it("uses _resolveAttempt to pick the right attempt on each invocation", async () => {
    let attemptToReturn = 0;
    const gate = createStitchFixturePreparerGate({
      fixturePath,
      _resolveAttempt: async () => attemptToReturn,
    });
    await gate.run({ workDir, artifacts: {} });
    let html = readFileSync(join(workDir, ".atelier/stitch-html/home.html"), "utf8");
    expect(html).toContain("Home v0");

    attemptToReturn = 1;
    await gate.run({ workDir, artifacts: {} });
    html = readFileSync(join(workDir, ".atelier/stitch-html/home.html"), "utf8");
    expect(html).toContain("Home v1");
  });

  it("emits an error-severity violation when the fixture is missing on disk", async () => {
    const gate = createStitchFixturePreparerGate({
      fixturePath: join(workDir, "does-not-exist.json"),
    });
    const violations = await gate.run({ workDir, artifacts: {} });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("stitch-fixture-preparer-failed");
    expect(violations[0]?.severity).toBe("error");
    expect(violations[0]?.agent).toBe("layout-architect");
  });

  it("emits an error-severity violation when the fixture is malformed", async () => {
    writeFileSync(fixturePath, JSON.stringify({ stitchProjectId: "x" }), "utf8");
    const gate = createStitchFixturePreparerGate({ fixturePath });
    const violations = await gate.run({ workDir, artifacts: {} });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("stitch-fixture-preparer-failed");
    expect(violations[0]?.message).toMatch(/Invalid Stitch fixture/);
  });
});
