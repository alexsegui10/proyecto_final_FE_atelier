import { describe, it, expect } from "vitest";

import {
  EMPTY_PRD_STATE,
  detectReadySignal,
  extractStateBlock,
  isPRDReady,
  mergePRDState,
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
        { name: "X", fields: [] },
        { name: "Y", fields: [] },
        { name: "Z", fields: [] },
      ],
      useCases: ["u1", "u2", "u3", "u4", "u5"],
    });
    expect(isPRDReady(partial)).toBe(false);
  });

  it("returns true when objective, 2 roles, 3 entities, 6 useCases are present", () => {
    const ready = mergePRDState(EMPTY_PRD_STATE, {
      objective: "yoga",
      roles: ["admin", "alumno"],
      entities: [
        { name: "User", fields: [] },
        { name: "Class", fields: [] },
        { name: "Booking", fields: [] },
      ],
      useCases: ["u1", "u2", "u3", "u4", "u5", "u6"],
    });
    expect(isPRDReady(ready)).toBe(true);
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
