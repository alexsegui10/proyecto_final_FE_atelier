import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  domainModelSchema,
  validateDomainModel,
} from "../contracts-v2/domain-model.schema";

const fixtures = join(__dirname, "fixtures");
const dm = JSON.parse(readFileSync(join(fixtures, "yoga-domain-model.json"), "utf-8"));

describe("domain-model schema", () => {
  it("accepts the yoga fixture (4 entities, 8 errors)", () => {
    const r = domainModelSchema.safeParse(dm);
    expect(r.success).toBe(true);
    expect(dm.entities).toHaveLength(4);
    expect(dm.domainErrors).toHaveLength(8);
  });

  it("rejects entity names that aren't PascalCase", () => {
    const broken = JSON.parse(JSON.stringify(dm));
    broken.entities[0].name = "user";
    expect(validateDomainModel(broken)).toMatch(/PascalCase/);
  });

  it("rejects feature names that aren't kebab-case", () => {
    const broken = JSON.parse(JSON.stringify(dm));
    broken.entities[0].feature = "Auth_Module";
    expect(validateDomainModel(broken)).toMatch(/kebab-case/);
  });

  it("rejects domain errors that don't end in 'Error'", () => {
    const broken = JSON.parse(JSON.stringify(dm));
    broken.domainErrors[0].name = "ResourceNotFoundException";
    expect(validateDomainModel(broken)).toMatch(/PascalCase/);
  });

  it("rejects error codes that aren't SCREAMING_SNAKE", () => {
    const broken = JSON.parse(JSON.stringify(dm));
    broken.domainErrors[0].code = "ResourceNotFound";
    expect(validateDomainModel(broken)).toMatch(/SCREAMING_SNAKE/);
  });

  it("rejects HTTP status outside 4xx-5xx", () => {
    const broken = JSON.parse(JSON.stringify(dm));
    broken.domainErrors[0].httpStatus = 200;
    expect(validateDomainModel(broken)).not.toBeNull();
  });

  it("requires at least 2 fields per entity", () => {
    const broken = JSON.parse(JSON.stringify(dm));
    broken.entities[0].fields = [{ name: "id", type: "string" }];
    expect(validateDomainModel(broken)).not.toBeNull();
  });

  it("yoga fixture covers the canonical 5 base errors", () => {
    const codes = (dm as { domainErrors: Array<{ code: string }> }).domainErrors.map((e) => e.code);
    for (const code of [
      "RESOURCE_NOT_FOUND",
      "DUPLICATE_RESOURCE",
      "VALIDATION_ERROR",
      "UNAUTHORIZED",
      "FORBIDDEN",
    ]) {
      expect(codes).toContain(code);
    }
  });

  it("yoga fixture includes the booking-specific business errors", () => {
    const codes = (dm as { domainErrors: Array<{ code: string }> }).domainErrors.map((e) => e.code);
    expect(codes).toContain("BOOKING_CAPACITY");
    expect(codes).toContain("BOOKING_TOO_LATE");
  });
});

describe("domain-modeler prompt file", () => {
  const promptPath = join(__dirname, "..", "prompts-v2", "domain-modeler.md");
  const prompt = readFileSync(promptPath, "utf-8");

  it("exists and is non-trivial", () => {
    expect(prompt.length).toBeGreaterThan(2000);
  });

  it("documents R1-R7 explicitly", () => {
    for (const rule of ["R1", "R2", "R3", "R4", "R5", "R6", "R7"]) {
      expect(prompt).toContain(`**${rule}**`);
    }
  });

  it("targets the v2 feature-first paths", () => {
    expect(prompt).toContain("src/<feature>/domain/entity/");
    expect(prompt).toContain("src/<feature>/domain/dto/");
    expect(prompt).toContain("src/_shared/domain/errors.ts");
  });

  it("documents the exact stop sentinel", () => {
    expect(prompt).toContain("DOMAIN_MODELER_DONE: entities=<n>, errors=<n>");
  });
});
