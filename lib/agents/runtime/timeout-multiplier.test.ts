import { describe, it, expect, vi } from "vitest";

import {
  TIMEOUT_MULTIPLIER_ENV,
  applyTimeoutMultiplier,
  getTimeoutMultiplier,
} from "./timeout-multiplier";

// Build an env stub that contains *only* what the test cares about.
// We never touch process.env directly — the helpers accept env+warn as
// injected dependencies precisely so tests stay hermetic.
function envWith(value?: string): Record<string, string | undefined> {
  return value === undefined ? {} : { [TIMEOUT_MULTIPLIER_ENV]: value };
}

// ─── getTimeoutMultiplier ───────────────────────────────────────────

describe("getTimeoutMultiplier — default + valid parsing", () => {
  it("returns 1.0 when env var is absent", () => {
    expect(getTimeoutMultiplier(envWith(undefined), () => {})).toBe(1.0);
  });

  it("returns 1.0 when env var is empty string", () => {
    expect(getTimeoutMultiplier(envWith(""), () => {})).toBe(1.0);
  });

  it("parses a valid numeric string", () => {
    expect(getTimeoutMultiplier(envWith("1.5"), () => {})).toBe(1.5);
    expect(getTimeoutMultiplier(envWith("2"), () => {})).toBe(2);
    expect(getTimeoutMultiplier(envWith("0.75"), () => {})).toBe(0.75);
  });

  it("accepts the lower bound 0.5 and upper bound 5.0", () => {
    expect(getTimeoutMultiplier(envWith("0.5"), () => {})).toBe(0.5);
    expect(getTimeoutMultiplier(envWith("5"), () => {})).toBe(5);
    expect(getTimeoutMultiplier(envWith("5.0"), () => {})).toBe(5.0);
  });
});

describe("getTimeoutMultiplier — invalid inputs fall back to 1.0 with warning", () => {
  it("non-numeric string warns and returns 1.0", () => {
    const warn = vi.fn();
    expect(getTimeoutMultiplier(envWith("abc"), warn)).toBe(1.0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/not a number/);
  });

  it("below-min value warns and returns 1.0 (catches '0.1' typo)", () => {
    const warn = vi.fn();
    expect(getTimeoutMultiplier(envWith("0.1"), warn)).toBe(1.0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/out of bounds/);
  });

  it("above-max value warns and returns 1.0 (catches '15' instead of '1.5')", () => {
    const warn = vi.fn();
    expect(getTimeoutMultiplier(envWith("15"), warn)).toBe(1.0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/out of bounds/);
  });

  it("Infinity warns and returns 1.0", () => {
    const warn = vi.fn();
    expect(getTimeoutMultiplier(envWith("Infinity"), warn)).toBe(1.0);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("NaN-producing input warns and returns 1.0", () => {
    const warn = vi.fn();
    expect(getTimeoutMultiplier(envWith("NaN"), warn)).toBe(1.0);
    expect(warn).toHaveBeenCalledOnce();
  });
});

// ─── applyTimeoutMultiplier ─────────────────────────────────────────

describe("applyTimeoutMultiplier", () => {
  it("no-ops when env var is absent (multiplier 1.0)", () => {
    expect(applyTimeoutMultiplier(1000, envWith(undefined), () => {})).toBe(1000);
    expect(applyTimeoutMultiplier(60_000, envWith(undefined), () => {})).toBe(60_000);
  });

  it("multiplies the timeout by the env-var value", () => {
    expect(applyTimeoutMultiplier(1000, envWith("2"), () => {})).toBe(2000);
    expect(applyTimeoutMultiplier(60_000, envWith("1.5"), () => {})).toBe(90_000);
  });

  it("rounds to an integer (no fractional ms reach the executor)", () => {
    // 1000 * 1.5 = 1500 (clean)
    expect(applyTimeoutMultiplier(1000, envWith("1.5"), () => {})).toBe(1500);
    // 333 * 1.5 = 499.5 → 500
    expect(applyTimeoutMultiplier(333, envWith("1.5"), () => {})).toBe(500);
  });

  it("falls back to 1.0 (no multiplication) on invalid env", () => {
    expect(applyTimeoutMultiplier(60_000, envWith("garbage"), () => {})).toBe(60_000);
  });

  it("falls back to 1.0 on out-of-bounds env", () => {
    expect(applyTimeoutMultiplier(60_000, envWith("100"), () => {})).toBe(60_000);
  });

  it("works at the bounds (0.5 and 5.0)", () => {
    expect(applyTimeoutMultiplier(10_000, envWith("0.5"), () => {})).toBe(5000);
    expect(applyTimeoutMultiplier(10_000, envWith("5"), () => {})).toBe(50_000);
  });
});

// ─── Realistic agent-config scenarios ────────────────────────────────
//
// These mirror the actual AGENT_CONFIG_V{2,3} numbers used in production.
// They document expected behavior with the canonical 1.5x slowdown setting
// observed across F3-runs 17-20.

describe("applyTimeoutMultiplier — production-shape scenarios", () => {
  const slowdown = envWith("1.5");

  it("bootstrap-devops 12min cap → 18min at 1.5x", () => {
    expect(applyTimeoutMultiplier(12 * 60_000, slowdown, () => {})).toBe(18 * 60_000);
  });

  it("api-backend 30min cap → 45min at 1.5x", () => {
    expect(applyTimeoutMultiplier(30 * 60_000, slowdown, () => {})).toBe(45 * 60_000);
  });

  it("seeds-fixtures 15min cap (the run-20 timeout) → 22.5min at 1.5x", () => {
    // 15 * 60_000 * 1.5 = 1_350_000 = 22.5min → covers the observed 900s + 50%
    expect(applyTimeoutMultiplier(15 * 60_000, slowdown, () => {})).toBe(22.5 * 60_000);
  });

  it("visual-adapter 50min cap → 75min at 1.5x", () => {
    expect(applyTimeoutMultiplier(50 * 60_000, slowdown, () => {})).toBe(75 * 60_000);
  });
});
