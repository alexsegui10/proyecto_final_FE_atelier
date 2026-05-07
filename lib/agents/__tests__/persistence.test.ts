import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  persistenceSchema,
  validatePersistence,
} from "../contracts-v2/persistence.schema";

const fixtures = join(__dirname, "fixtures");
const persistence = JSON.parse(readFileSync(join(fixtures, "yoga-persistence.json"), "utf-8"));

describe("persistence schema", () => {
  it("accepts the yoga fixture", () => {
    const r = persistenceSchema.safeParse(persistence);
    expect(r.success).toBe(true);
    expect(persistence.schema.models).toHaveLength(4);
    expect(persistence.repositories).toHaveLength(4);
  });

  it("rejects an interface name that doesn't end in 'Repository'", () => {
    const broken = JSON.parse(JSON.stringify(persistence));
    broken.repositories[0].interface = "UserRepo";
    expect(validatePersistence(broken)).not.toBeNull();
  });

  it("rejects an impl name that doesn't end in 'RepositoryImpl'", () => {
    const broken = JSON.parse(JSON.stringify(persistence));
    broken.repositories[0].impl = "UserRepoImpl";
    expect(validatePersistence(broken)).not.toBeNull();
  });

  it("rejects feature kebab-case violations", () => {
    const broken = JSON.parse(JSON.stringify(persistence));
    broken.repositories[0].feature = "Auth_Module";
    expect(validatePersistence(broken)).not.toBeNull();
  });

  it("requires at least 2 methods per repository", () => {
    const broken = JSON.parse(JSON.stringify(persistence));
    broken.repositories[0].methods = [
      { name: "findById", params: "id: string", returns: "User | null" },
    ];
    expect(validatePersistence(broken)).not.toBeNull();
  });

  it("validates index types are from the allowed set", () => {
    const broken = JSON.parse(JSON.stringify(persistence));
    broken.schema.indices[0].type = "fulltext";
    expect(validatePersistence(broken)).not.toBeNull();
  });

  it("yoga fixture covers all 4 features (auth, classes, bookings, memberships)", () => {
    const features = (persistence as { repositories: Array<{ feature: string }> }).repositories.map(
      (r) => r.feature,
    );
    expect(features).toEqual(
      expect.arrayContaining(["auth", "classes", "bookings", "memberships"]),
    );
  });

  it("yoga fixture has unique indices for every slug", () => {
    const uniques = (persistence as { schema: { indices: Array<Record<string, unknown>> } }).schema
      .indices.filter((i) => i.type === "unique" && Array.isArray(i.fields) && (i.fields as string[]).includes("slug"));
    expect(uniques.length).toBeGreaterThanOrEqual(4);
  });
});

describe("persistence prompt file", () => {
  const promptPath = join(__dirname, "..", "prompts-v2", "persistence.md");
  const prompt = readFileSync(promptPath, "utf-8");

  it("exists and is non-trivial", () => {
    expect(prompt.length).toBeGreaterThan(2000);
  });

  it("documents R4-R8", () => {
    for (const rule of ["R4", "R5", "R6", "R7", "R8"]) {
      expect(prompt).toContain(`**${rule}**`);
    }
  });

  it("triggers prisma generate explicitly (Camino 3 lesson)", () => {
    expect(prompt).toMatch(/prisma:generate|prisma generate/);
  });

  it("targets the v2 feature-first paths", () => {
    expect(prompt).toContain("src/<feature>/infrastructure/repository/");
    expect(prompt).toContain("src/<feature>/application/mapper/");
    expect(prompt).toContain("src/_shared/infrastructure/db/client.ts");
  });

  it("documents the exact stop sentinel", () => {
    expect(prompt).toContain("PERSISTENCE_DONE: models=<n>, repositories=<n>");
  });
});
