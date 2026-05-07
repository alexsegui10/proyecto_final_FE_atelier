import { describe, it, expect } from "vitest";

import {
  EMPTY_PRD_STATE,
  detectReadySignal,
  extractStateBlock,
  isPRDReady,
  mergePRDState,
  prdMaturity,
} from "./prd-state";

describe("mergePRDState", () => {
  it("leaves the state untouched when the partial is empty", () => {
    const result = mergePRDState(EMPTY_PRD_STATE, {});
    expect(result).toEqual(EMPTY_PRD_STATE);
    expect(result).not.toBe(EMPTY_PRD_STATE);
  });

  it("replaces the objective when the partial provides a non-empty string", () => {
    const next = mergePRDState(EMPTY_PRD_STATE, { objective: "  yoga app  " });
    expect(next.objective).toBe("yoga app");
  });

  it("ignores empty-string objective updates", () => {
    const start = mergePRDState(EMPTY_PRD_STATE, { objective: "yoga app" });
    const next = mergePRDState(start, { objective: "" });
    expect(next.objective).toBe("yoga app");
  });

  it("unions roles, useCases and notes case-insensitively without dropping order", () => {
    const start = mergePRDState(EMPTY_PRD_STATE, {
      roles: ["admin", "alumno"],
      useCases: ["alumno reserva clase"],
    });
    const next = mergePRDState(start, {
      roles: ["Admin", "profesor"],
      useCases: ["alumno cancela reserva", "ALUMNO RESERVA CLASE"],
      notes: ["Cancelación 2h antes."],
    });
    expect(next.roles).toEqual(["admin", "alumno", "profesor"]);
    expect(next.useCases).toEqual([
      "alumno reserva clase",
      "alumno cancela reserva",
    ]);
    expect(next.notes).toEqual(["Cancelación 2h antes."]);
  });

  it("merges entities by name and accumulates fields without duplicates", () => {
    const start = mergePRDState(EMPTY_PRD_STATE, {
      entities: [{ name: "Class", fields: ["title", "startsAt"] }],
    });
    const next = mergePRDState(start, {
      entities: [
        { name: "class", fields: ["startsAt", "capacity"] },
        { name: "Booking", fields: ["userId", "classId"], notes: "estado pendiente|ok" },
      ],
    });
    expect(next.entities).toHaveLength(2);
    const klass = next.entities.find((e) => e.name === "Class")!;
    expect(klass.fields).toEqual(["title", "startsAt", "capacity"]);
    const booking = next.entities.find((e) => e.name === "Booking")!;
    expect(booking.fields).toEqual(["userId", "classId"]);
    expect(booking.notes).toBe("estado pendiente|ok");
  });

  it("does not mutate the input state", () => {
    const start = mergePRDState(EMPTY_PRD_STATE, {
      roles: ["admin"],
      entities: [{ name: "User", fields: ["email"] }],
    });
    const snapshot = JSON.stringify(start);
    mergePRDState(start, { roles: ["alumno"] });
    expect(JSON.stringify(start)).toBe(snapshot);
  });

  it("ignores entities without a usable name", () => {
    const next = mergePRDState(EMPTY_PRD_STATE, {
      entities: [
        { name: "", fields: ["foo"] },
        { name: "   ", fields: ["bar"] },
        { name: "Real", fields: ["x"] },
      ],
    });
    expect(next.entities).toHaveLength(1);
    expect(next.entities[0].name).toBe("Real");
  });
});

describe("isPRDReady", () => {
  it("returns false until the thresholds are met", () => {
    expect(isPRDReady(EMPTY_PRD_STATE)).toBe(false);
    const partial = mergePRDState(EMPTY_PRD_STATE, {
      objective: "yoga",
      roles: ["a", "b"],
      entities: [
        { name: "X", fields: ["f1", "f2", "f3"] },
        { name: "Y", fields: ["f1", "f2", "f3"] },
        { name: "Z", fields: ["f1", "f2", "f3"] },
      ],
      useCases: ["u1", "u2", "u3", "u4", "u5"],
    });
    expect(isPRDReady(partial)).toBe(false);
  });

  it("returns true when objective, 2 roles, 4 entities (3+ fields each), 8 useCases", () => {
    const ready = mergePRDState(EMPTY_PRD_STATE, {
      objective: "yoga",
      roles: ["admin", "alumno"],
      entities: [
        { name: "User", fields: ["email", "name", "role"] },
        { name: "Class", fields: ["title", "startsAt", "capacity"] },
        { name: "Booking", fields: ["userId", "classId", "status"] },
        { name: "Membership", fields: ["userId", "tier", "validUntil"] },
      ],
      useCases: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"],
    });
    expect(isPRDReady(ready)).toBe(true);
  });

  it("returns false when an entity has fewer than 3 fields documented", () => {
    const stillIncomplete = mergePRDState(EMPTY_PRD_STATE, {
      objective: "yoga",
      roles: ["admin", "alumno"],
      entities: [
        { name: "User", fields: ["email", "name", "role"] },
        { name: "Class", fields: ["title", "startsAt"] }, // only 2 fields
        { name: "Booking", fields: ["userId", "classId", "status"] },
        { name: "Membership", fields: ["userId", "tier", "validUntil"] },
      ],
      useCases: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"],
    });
    expect(isPRDReady(stillIncomplete)).toBe(false);
  });
});

describe("prdMaturity", () => {
  it("starts at 0 with an empty PRD", () => {
    expect(prdMaturity(EMPTY_PRD_STATE)).toBe(0);
  });

  it("hits 100 when every component is filled", () => {
    const full = mergePRDState(EMPTY_PRD_STATE, {
      objective: "yoga",
      roles: ["admin", "alumno", "profesor"],
      entities: [
        { name: "User", fields: ["a", "b", "c"] },
        { name: "Class", fields: ["a", "b", "c"] },
        { name: "Booking", fields: ["a", "b", "c"] },
        { name: "Membership", fields: ["a", "b", "c"] },
      ],
      useCases: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"],
      notes: ["regla de cancelación"],
    });
    expect(prdMaturity(full)).toBe(100);
  });

  it("scales smoothly between 0 and 100 with partial inputs", () => {
    const half = mergePRDState(EMPTY_PRD_STATE, {
      objective: "x",
      roles: ["a", "b"],
      entities: [
        { name: "E1", fields: ["a", "b"] },
        { name: "E2", fields: ["a"] },
      ],
      useCases: ["u1", "u2", "u3", "u4"],
    });
    const score = prdMaturity(half);
    expect(score).toBeGreaterThan(20);
    expect(score).toBeLessThan(100);
  });

  it("missing notes blocks the last 10 points", () => {
    const noNotes = mergePRDState(EMPTY_PRD_STATE, {
      objective: "yoga",
      roles: ["admin", "alumno"],
      entities: [
        { name: "User", fields: ["a", "b", "c"] },
        { name: "Class", fields: ["a", "b", "c"] },
        { name: "Booking", fields: ["a", "b", "c"] },
        { name: "Membership", fields: ["a", "b", "c"] },
      ],
      useCases: ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"],
    });
    expect(prdMaturity(noNotes)).toBe(90);
  });
});

describe("extractStateBlock", () => {
  it("parses the first ```json``` block", () => {
    const text = '```json\n{"objective": "yoga"}\n```\n\nbla bla';
    const out = extractStateBlock(text);
    expect(out).toEqual({ objective: "yoga" });
  });

  it("returns null when no block is present", () => {
    expect(extractStateBlock("just prose")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(extractStateBlock("```json\n{nope}\n```")).toBeNull();
  });
});

describe("detectReadySignal", () => {
  it("matches READY_TO_BUILD on its own line", () => {
    expect(detectReadySignal("recap...\n\nREADY_TO_BUILD\n")).toBe(true);
  });

  it("does not match it inline inside prose", () => {
    expect(detectReadySignal("estoy READY_TO_BUILD-ish")).toBe(false);
  });
});
