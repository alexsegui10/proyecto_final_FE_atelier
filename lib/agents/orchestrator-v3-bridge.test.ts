import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";

// The bridge imports prisma at module load time; mock out the DB client so
// tests can run without a live DATABASE_URL.
vi.mock("@/lib/db/client", () => ({
  prisma: {
    event: { create: vi.fn() },
    generation: { update: vi.fn() },
  },
}));

import {
  resolveStitchMode,
  type StitchModeResolved,
} from "./orchestrator-v3-bridge";

// ─── Env snapshot helpers ────────────────────────────────────────────

let envSnapshot: Record<string, string | undefined>;

beforeEach(() => {
  envSnapshot = {
    ATELIER_STITCH_MODE: process.env.ATELIER_STITCH_MODE,
    ATELIER_STITCH_FIXTURE: process.env.ATELIER_STITCH_FIXTURE,
  };
  delete process.env.ATELIER_STITCH_MODE;
  delete process.env.ATELIER_STITCH_FIXTURE;
});

afterEach(() => {
  for (const [key, val] of Object.entries(envSnapshot)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  vi.restoreAllMocks();
});

// ─── resolveStitchMode tests ─────────────────────────────────────────

describe("resolveStitchMode", () => {
  const YOGA_FIXTURE_SUFFIX = join("fixtures", "stitch-yoga.json");

  it("returns fixture:default-yoga when env is unset", () => {
    const result = resolveStitchMode();
    expect(result.kind).toBe("fixture");
    if (result.kind === "fixture") {
      expect(result.source).toBe("default-yoga");
      expect(result.fixturePath.endsWith(YOGA_FIXTURE_SUFFIX)).toBe(true);
    }
  });

  it("returns fixture:default-yoga for ATELIER_STITCH_MODE=fixture:yoga", () => {
    process.env.ATELIER_STITCH_MODE = "fixture:yoga";
    const result = resolveStitchMode();
    expect(result.kind).toBe("fixture");
    if (result.kind === "fixture") {
      expect(result.source).toBe("default-yoga");
      expect(result.fixturePath.endsWith(YOGA_FIXTURE_SUFFIX)).toBe(true);
    }
  });

  it("returns { kind: 'live' } for ATELIER_STITCH_MODE=live", () => {
    process.env.ATELIER_STITCH_MODE = "live";
    const result = resolveStitchMode();
    expect(result).toEqual<StitchModeResolved>({ kind: "live" });
  });

  it("warns and falls back to yoga when ATELIER_STITCH_MODE=fixture but ATELIER_STITCH_FIXTURE is unset", () => {
    process.env.ATELIER_STITCH_MODE = "fixture";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = resolveStitchMode();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("ATELIER_STITCH_FIXTURE is empty");
    expect(result.kind).toBe("fixture");
    if (result.kind === "fixture") {
      expect(result.source).toBe("fallback-yoga");
      expect(result.fixturePath.endsWith(YOGA_FIXTURE_SUFFIX)).toBe(true);
    }
  });

  it("warns and falls back to yoga when ATELIER_STITCH_MODE=fixture with non-existent file path", () => {
    process.env.ATELIER_STITCH_MODE = "fixture";
    process.env.ATELIER_STITCH_FIXTURE = "/tmp/__does_not_exist_atelier_test__.json";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = resolveStitchMode();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("file not found at");
    expect(result.kind).toBe("fixture");
    if (result.kind === "fixture") {
      expect(result.source).toBe("fallback-yoga");
    }
  });

  it("returns env-fixture when ATELIER_STITCH_MODE=fixture with existing file", () => {
    // Use the real fixtures/stitch-yoga.json which we know exists.
    const { join: pjoin } = require("node:path");
    const realFixture = pjoin(process.cwd(), "fixtures", "stitch-yoga.json");
    process.env.ATELIER_STITCH_MODE = "fixture";
    process.env.ATELIER_STITCH_FIXTURE = realFixture;

    const result = resolveStitchMode();

    expect(result.kind).toBe("fixture");
    if (result.kind === "fixture") {
      expect(result.source).toBe("env-fixture");
      expect(result.fixturePath).toBe(realFixture);
    }
  });

  it("warns and falls back to yoga for unknown ATELIER_STITCH_MODE value", () => {
    process.env.ATELIER_STITCH_MODE = "garbage";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = resolveStitchMode();

    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain("Unknown ATELIER_STITCH_MODE");
    expect(result.kind).toBe("fixture");
    if (result.kind === "fixture") {
      expect(result.source).toBe("fallback-yoga");
      expect(result.fixturePath.endsWith(YOGA_FIXTURE_SUFFIX)).toBe(true);
    }
  });
});
