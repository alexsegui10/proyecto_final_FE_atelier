import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { seedsPlanSchema, validateSeedsPlan } from "../contracts-v2/seeds-plan.schema";

const fixtures = join(__dirname, "fixtures");
const plan = JSON.parse(readFileSync(join(fixtures, "yoga-seeds-plan.json"), "utf-8"));

describe("seeds-plan schema", () => {
  it("accepts the yoga fixture", () => {
    const r = seedsPlanSchema.safeParse(plan);
    expect(r.success).toBe(true);
  });

  it("requires fixed users to include credentials", () => {
    const broken = JSON.parse(JSON.stringify(plan));
    delete broken.demoUsers[0].credentials;
    expect(validateSeedsPlan(broken)).not.toBeNull();
  });

  it("rejects roles that aren't lowercase identifiers", () => {
    const broken = JSON.parse(JSON.stringify(plan));
    broken.demoUsers[0].role = "Admin";
    expect(validateSeedsPlan(broken)).toMatch(/lowercase identifier/);
  });

  it("rejects entity names that aren't PascalCase", () => {
    const broken = JSON.parse(JSON.stringify(plan));
    broken.domainData[0].entity = "class";
    expect(validateSeedsPlan(broken)).not.toBeNull();
  });

  it("requires at least 1 edge case", () => {
    const broken = JSON.parse(JSON.stringify(plan));
    broken.edgeCases = [];
    expect(validateSeedsPlan(broken)).not.toBeNull();
  });

  it("rejects credentials with weak password (< 8 chars)", () => {
    const broken = JSON.parse(JSON.stringify(plan));
    broken.demoUsers[0].credentials.password = "weak";
    expect(validateSeedsPlan(broken)).not.toBeNull();
  });

  it("yoga fixture has exactly 1 fixed admin user", () => {
    const fixedAdmins = (plan as { demoUsers: Array<{ role: string; fixed: boolean }> }).demoUsers
      .filter((u) => u.role === "admin" && u.fixed);
    expect(fixedAdmins).toHaveLength(1);
  });

  it("yoga fixture covers Class + Booking + Membership", () => {
    const entities = (plan as { domainData: Array<{ entity: string }> }).domainData.map(
      (d) => d.entity,
    );
    expect(entities).toEqual(expect.arrayContaining(["Class", "Booking", "Membership"]));
  });
});

describe("seeds-shape prompt file", () => {
  const promptPath = join(__dirname, "..", "prompts-v2", "seeds-shape.md");
  const prompt = readFileSync(promptPath, "utf-8");

  it("exists and is non-trivial", () => {
    expect(prompt.length).toBeGreaterThan(1500);
  });

  it("emphasizes that NO .ts files are written (planning only)", () => {
    expect(prompt).toMatch(/NO escribís archivos|NO escribas/i);
  });

  it("documents the exact stop sentinel", () => {
    expect(prompt).toContain("SEEDS_SHAPE_DONE: users=<n>, entities_planned=<n>");
  });
});
