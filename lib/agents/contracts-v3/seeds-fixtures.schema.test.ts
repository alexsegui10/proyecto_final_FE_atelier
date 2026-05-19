import { describe, it, expect } from "vitest";

import {
  validateSeedsFixtures,
  type SeedsFixtures,
} from "./seeds-fixtures.schema";

// ─── Fixture builder — mirrors the real F3-run-14 shape ─────────────

function seeds(over: Partial<SeedsFixtures> = {}): SeedsFixtures {
  return {
    seedScript: "prisma/seed.ts",
    runCommand: "pnpm prisma:seed",
    resetCommand: "SEED_RESET=true pnpm tsx prisma/seed.ts",
    seedDataFiles: ["prisma/seed-data/admin.json", "prisma/seed-data/classes.json"],
    fixtureFiles: ["tests/fixtures/users.fixture.ts"],
    fixedCredentials: [
      { email: "admin@demo.yoga", password: "demo1234", role: "admin", name: "Lucía Fernández" },
    ],
    seededEntities: [
      { entity: "User", count: 16, notes: "1 admin + 3 profesores + 14 alumnos" },
      { entity: "Booking", count: 85, notes: "17 canceladas, resto active/completed" },
    ],
    edgeCasesCovered: [
      { case: "membresía exhausta", where: "Raúl Cabrera — mensual 12/12" },
    ],
    // value-polymorphic: flat number AND nested breakdown (G1)
    userDistribution: {
      admin: 1,
      profesor: 3,
      alumno: { total: 14, active: 9, newcomers: 3, lapsed: 2 },
    },
    totalRecords: 141,
    constraints: {
      uniqueEmails: true,
      noFaker: true,
      passwordHashing: "bcrypt cost 12 en win32, argon2id en linux/darwin",
      namesLocale: "castellano (España)",
    },
    notes: ["Fuente de verdad única: prisma/seed-data/*.json"],
    ...over,
  };
}

describe("validateSeedsFixtures — shape-only (v3 wave-5a)", () => {
  it("accepts the real F3-run-14 shape", () => {
    expect(validateSeedsFixtures(seeds())).toBeNull();
  });

  it("accepts userDistribution with all-flat-number values (LLM variance)", () => {
    expect(
      validateSeedsFixtures(seeds({ userDistribution: { admin: 1, profesor: 3, alumno: 14 } })),
    ).toBeNull();
  });

  it("does NOT .strict() top-level — tolerates a benign extra field", () => {
    expect(
      validateSeedsFixtures({ ...seeds(), extraFieldFromPromptDrift: "ignored" }),
    ).toBeNull();
  });

  it("rejects seededEntities as a keyed map instead of an array", () => {
    const r = validateSeedsFixtures(seeds({ seededEntities: { User: 16 } as never }));
    expect(r).toMatch(/seededEntities/);
  });

  it("rejects a seededEntities entry with a non-numeric count", () => {
    const r = validateSeedsFixtures(
      seeds({ seededEntities: [{ entity: "User", count: "16" as never, notes: "x" }] }),
    );
    expect(r).toMatch(/seededEntities\.0\.count/);
  });

  it("rejects userDistribution with a string value (not number | breakdown)", () => {
    const r = validateSeedsFixtures(seeds({ userDistribution: { admin: "one" as never } }));
    expect(r).toMatch(/userDistribution\.admin/);
  });

  it("rejects a negative totalRecords", () => {
    const r = validateSeedsFixtures(seeds({ totalRecords: -1 }));
    expect(r).toMatch(/totalRecords/);
  });

  it("rejects a fixedCredentials entry missing email (strict sub-object)", () => {
    const r = validateSeedsFixtures(
      seeds({ fixedCredentials: [{ password: "x", role: "admin", name: "n" } as never] }),
    );
    expect(r).toMatch(/fixedCredentials\.0\.email/);
  });

  it("rejects an unknown key inside a strict sub-object", () => {
    const r = validateSeedsFixtures(
      seeds({
        seededEntities: [
          { entity: "User", count: 1, notes: "n", rogue: true } as never,
        ],
      }),
    );
    expect(r).toMatch(/seededEntities\.0/);
  });
});
