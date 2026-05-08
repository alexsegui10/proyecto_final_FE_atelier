import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { discoverySchema, validateDiscovery, VIBES } from "../contracts-v2/discovery.schema";
import { architectSchema, validateArchitect } from "../contracts-v2/architect.schema";
import {
  seedsFixturesSchema,
  validateSeedsFixtures,
} from "../contracts-v2/seeds-fixtures.schema";
import { testsWriterSchema, validateTestsWriter } from "../contracts-v2/tests-writer.schema";
import { qaReportSchema, validateQaReport } from "../contracts-v2/qa-report.schema";

const fixtures = join(__dirname, "fixtures");
const prdFixtures = resolve(__dirname, "..", "..", "..", "fixtures");

const yogaDiscovery = JSON.parse(readFileSync(join(fixtures, "yoga-discovery.json"), "utf-8"));
const yogaArchitect = JSON.parse(readFileSync(join(fixtures, "yoga-architect.json"), "utf-8"));
const tutorias = JSON.parse(readFileSync(join(prdFixtures, "tutorias-prd.json"), "utf-8"));
const veterinaria = JSON.parse(readFileSync(join(prdFixtures, "veterinaria-prd.json"), "utf-8"));
const yogaSeedsFix = JSON.parse(readFileSync(join(fixtures, "yoga-seeds-fixtures.json"), "utf-8"));
const yogaTests = JSON.parse(readFileSync(join(fixtures, "yoga-tests-writer.json"), "utf-8"));
const yogaQaGo = JSON.parse(readFileSync(join(fixtures, "yoga-qa-report.json"), "utf-8"));

// ─── discovery schema ────────────────────────────────────────────

describe("discovery schema (Wave 1)", () => {
  it("accepts the yoga discovery fixture", () => {
    const r = discoverySchema.safeParse(yogaDiscovery);
    expect(r.success).toBe(true);
  });

  it("accepts the tutorias-academicas PRD", () => {
    expect(validateDiscovery(tutorias)).toBeNull();
  });

  it("accepts the veterinaria PRD", () => {
    expect(validateDiscovery(veterinaria)).toBeNull();
  });

  it("rejects objective shorter than 10 words", () => {
    const broken = { ...yogaDiscovery, objective: "App de yoga simple" };
    expect(validateDiscovery(broken)).toMatch(/10 words/);
  });

  it("rejects domain that isn't kebab-case", () => {
    const broken = { ...yogaDiscovery, domain: "Yoga_App" };
    expect(validateDiscovery(broken)).toMatch(/domain/);
  });

  it("rejects designVibe outside the 5 allowed values", () => {
    const broken = { ...yogaDiscovery, designVibe: "Brutalist" };
    expect(validateDiscovery(broken)).not.toBeNull();
  });

  it("rejects fewer than 4 entities", () => {
    const broken = { ...yogaDiscovery, entities: yogaDiscovery.entities.slice(0, 2) };
    expect(validateDiscovery(broken)).toMatch(/4 entities/);
  });

  it("rejects fewer than 8 useCases", () => {
    const broken = { ...yogaDiscovery, useCases: yogaDiscovery.useCases.slice(0, 4) };
    expect(validateDiscovery(broken)).toMatch(/8 use cases/);
  });

  it("rejects fewer than 2 roles", () => {
    const broken = { ...yogaDiscovery, roles: ["admin"] };
    expect(validateDiscovery(broken)).toMatch(/2 roles/);
  });

  it("rejects more than 5 roles", () => {
    const broken = { ...yogaDiscovery, roles: ["a", "b", "c", "d", "e", "f"] };
    expect(validateDiscovery(broken)).not.toBeNull();
  });

  it("VIBES exports the 5 canonical names", () => {
    expect(VIBES).toEqual(["Linear", "Stripe", "Notion", "Vercel", "Calm"]);
  });

  it("tutorias designVibe is Notion (knowledge/editor domain)", () => {
    expect(tutorias.designVibe).toBe("Notion");
  });

  it("veterinaria designVibe is Stripe (clinical/professional B2B)", () => {
    expect(veterinaria.designVibe).toBe("Stripe");
  });
});

// ─── architect schema ────────────────────────────────────────────

describe("architect schema (Wave 1)", () => {
  it("accepts the yoga architect fixture", () => {
    const r = architectSchema.safeParse(yogaArchitect);
    expect(r.success).toBe(true);
  });

  it("rejects feature names that aren't kebab-case", () => {
    const broken = JSON.parse(JSON.stringify(yogaArchitect));
    broken.features[0].name = "Auth_Module";
    expect(validateArchitect(broken)).not.toBeNull();
  });

  it("rejects entity names that aren't PascalCase", () => {
    const broken = JSON.parse(JSON.stringify(yogaArchitect));
    broken.features[0].entities = ["user"];
    expect(validateArchitect(broken)).not.toBeNull();
  });

  it("rejects routes that don't start with /", () => {
    const broken = JSON.parse(JSON.stringify(yogaArchitect));
    broken.features[0].publicRoutes = ["sign-in"];
    expect(validateArchitect(broken)).toMatch(/start with \//);
  });

  it("rejects rateLimit entries that aren't /api/ paths", () => {
    const broken = JSON.parse(JSON.stringify(yogaArchitect));
    broken.crossCuttingConcerns.rateLimit = ["/auth/*"];
    expect(validateArchitect(broken)).not.toBeNull();
  });

  it("yoga architect has all 4 features (auth, classes, bookings, memberships)", () => {
    const names = (yogaArchitect as { features: Array<{ name: string }> }).features.map(
      (f) => f.name,
    );
    expect(names).toEqual(expect.arrayContaining(["auth", "classes", "bookings", "memberships"]));
  });
});

// ─── seeds-fixtures schema ────────────────────────────────────────

describe("seeds-fixtures schema (Wave 5)", () => {
  it("accepts the yoga fixture", () => {
    const r = seedsFixturesSchema.safeParse(yogaSeedsFix);
    expect(r.success).toBe(true);
  });

  it("rejects seedScript path other than prisma/seed.ts", () => {
    const broken = { ...yogaSeedsFix, seedScript: "scripts/seed.ts" };
    expect(validateSeedsFixtures(broken)).toMatch(/prisma\/seed\.ts/);
  });

  it("rejects seed-data files outside prisma/seed-data/", () => {
    const broken = JSON.parse(JSON.stringify(yogaSeedsFix));
    broken.seedDataFiles[0] = "fixtures/admin.json";
    expect(validateSeedsFixtures(broken)).not.toBeNull();
  });

  it("rejects fixtures outside tests/fixtures/", () => {
    const broken = JSON.parse(JSON.stringify(yogaSeedsFix));
    broken.fixtureFiles[0] = "src/teachers.fixture.ts";
    expect(validateSeedsFixtures(broken)).not.toBeNull();
  });

  it("requires at least 1 fixed admin credential", () => {
    const broken = { ...yogaSeedsFix, fixedCredentials: [] };
    expect(validateSeedsFixtures(broken)).toMatch(/1 fixed admin/);
  });

  it("rejects fixed credential with invalid email", () => {
    const broken = JSON.parse(JSON.stringify(yogaSeedsFix));
    broken.fixedCredentials[0].email = "not-an-email";
    expect(validateSeedsFixtures(broken)).not.toBeNull();
  });

  it("rejects fixed credential with password < 8 chars", () => {
    const broken = JSON.parse(JSON.stringify(yogaSeedsFix));
    broken.fixedCredentials[0].password = "demo";
    expect(validateSeedsFixtures(broken)).not.toBeNull();
  });

  it("yoga fixture has totalRecords == sum of seededEntities counts", () => {
    const sum = (yogaSeedsFix as { seededEntities: Array<{ count: number }> }).seededEntities
      .reduce((acc, s) => acc + s.count, 0);
    expect(yogaSeedsFix.totalRecords).toBe(sum);
  });
});

// ─── tests-writer schema ────────────────────────────────────────

describe("tests-writer schema (Wave 5)", () => {
  it("accepts the yoga fixture", () => {
    const r = testsWriterSchema.safeParse(yogaTests);
    expect(r.success).toBe(true);
  });

  it("rejects test files outside tests/", () => {
    const broken = JSON.parse(JSON.stringify(yogaTests));
    broken.files[0].path = "src/Service.test.ts";
    expect(validateTestsWriter(broken)).not.toBeNull();
  });

  it("rejects unknown test layer", () => {
    const broken = JSON.parse(JSON.stringify(yogaTests));
    broken.files[0].layer = "performance";
    expect(validateTestsWriter(broken)).not.toBeNull();
  });

  it("requires counts.total === unit + integration + e2e", () => {
    const broken = JSON.parse(JSON.stringify(yogaTests));
    broken.counts.total = 999;
    expect(validateTestsWriter(broken)).toMatch(/counts\.total/);
  });

  it("rejects fewer than 5 e2e specs (RBAC + auth + crud + edge + admin minimum)", () => {
    const broken = JSON.parse(JSON.stringify(yogaTests));
    broken.counts.e2e = 3;
    broken.counts.total = broken.counts.unit + broken.counts.integration + broken.counts.e2e;
    expect(validateTestsWriter(broken)).toMatch(/5 e2e specs/);
  });

  it("yoga fixture has unit, integration, e2e, fixtures, helpers all present", () => {
    const layers = new Set(
      (yogaTests as { files: Array<{ layer: string }> }).files.map((f) => f.layer),
    );
    for (const l of ["unit", "integration", "e2e", "fixtures", "helpers"]) {
      expect(layers, `missing ${l}`).toContain(l);
    }
  });
});

// ─── qa-report schema ───────────────────────────────────────────

describe("qa-report schema (Wave 6)", () => {
  it("accepts a go fixture with all gates passing", () => {
    const r = qaReportSchema.safeParse(yogaQaGo);
    expect(r.success).toBe(true);
  });

  it("rejects decision='go' when typecheck gate fails", () => {
    const broken = JSON.parse(JSON.stringify(yogaQaGo));
    broken.gates.typecheck.status = "fail";
    expect(validateQaReport(broken)).toMatch(/decision='go' requires/);
  });

  it("rejects decision='no-go' with no error-level violations", () => {
    const broken = JSON.parse(JSON.stringify(yogaQaGo));
    broken.decision = "no-go";
    broken.gates.typecheck.status = "fail";
    broken.violations = [{ severity: "warn", rule: "x", file: "y.ts", message: "z" }];
    expect(validateQaReport(broken)).toMatch(/at least 1 error-level/);
  });

  it("accepts a no-go report with error-level violations and recommendedFix", () => {
    const noGo = {
      decision: "no-go",
      gates: {
        typecheck: { status: "fail", detail: "1 error" },
        lint: { status: "pass" },
        deps: { status: "pass" },
        tests: { status: "pass" },
      },
      violations: [
        {
          severity: "error",
          rule: "TypecheckError",
          agent: "persistence",
          file: "src/bookings/infrastructure/repository/BookingRepositoryImpl.ts",
          line: 45,
          message: "Property 'findByIds' does not exist on type",
          recommendedFix:
            "agregar al final de la clase: async findByIds(ids: string[]): Promise<Booking[]> { return prisma.booking.findMany({ where: { id: { in: ids } } }); }",
        },
      ],
      summary: "1 typecheck error in BookingRepositoryImpl",
    };
    expect(validateQaReport(noGo)).toBeNull();
  });

  it("rejects unknown gate status", () => {
    const broken = JSON.parse(JSON.stringify(yogaQaGo));
    broken.gates.typecheck.status = "warning";
    expect(validateQaReport(broken)).not.toBeNull();
  });

  it("rejects severity values other than 'error'|'warn'", () => {
    const broken = {
      decision: "no-go",
      gates: {
        typecheck: { status: "fail" },
        lint: { status: "pass" },
        deps: { status: "pass" },
        tests: { status: "pass" },
      },
      violations: [
        { severity: "fatal", rule: "x", file: "y.ts", message: "z" },
      ],
      summary: "x",
    };
    expect(validateQaReport(broken)).not.toBeNull();
  });

  it("rejects agent values that aren't kebab-case", () => {
    const broken = {
      decision: "no-go",
      gates: { typecheck: { status: "fail" }, lint: { status: "pass" }, deps: { status: "pass" }, tests: { status: "pass" } },
      violations: [
        { severity: "error", rule: "x", agent: "Domain Modeler", file: "y.ts", message: "z" },
      ],
      summary: "x",
    };
    expect(validateQaReport(broken)).not.toBeNull();
  });

  it("accepts an escalation block after 3 rounds", () => {
    const escalated = {
      ...yogaQaGo,
      decision: "no-go",
      gates: { ...yogaQaGo.gates, typecheck: { status: "fail" } },
      violations: [{ severity: "error", rule: "x", file: "y.ts", message: "z" }],
      escalation: {
        reason: "After 3 rounds, persistent error in TokenService.test.ts",
        suggestedHumanAction: "Mock jose explicitly in vi.mock setup",
      },
    };
    expect(validateQaReport(escalated)).toBeNull();
  });
});

// ─── prompts presence + sentinel format ─────────────────────────

describe("Phase 1 prompts presence", () => {
  const promptsDir = resolve(__dirname, "..", "prompts-v2");

  it.each([
    "discovery.md",
    "architect.md",
    "seeds-fixtures.md",
    "tests-writer.md",
    "qa-reviewer.md",
  ])("%s exists and is non-trivial", (file) => {
    const text = readFileSync(join(promptsDir, file), "utf-8");
    expect(text.length).toBeGreaterThan(2000);
  });

  it("each prompt documents its exact stop sentinel", () => {
    const sentinels: Record<string, string> = {
      "discovery.md": "READY_TO_BUILD",
      "architect.md": "ARCHITECT_DONE: features=<n>, public_routes=<np>, private_routes=<npr>, admin_routes=<na>",
      "seeds-fixtures.md": "SEEDS_FIXTURES_DONE: users=<n>, entities=<n>, total_records=<n>",
      "tests-writer.md": "TESTS_WRITER_DONE: unit=<n>, integration=<n>, e2e=<n>, total=<n>",
      "qa-reviewer.md": "QA_REVIEWER_DONE: decision=<go|no-go>, gates=<x/y>, violations=<n>",
    };
    for (const [file, sentinel] of Object.entries(sentinels)) {
      const text = readFileSync(join(promptsDir, file), "utf-8");
      expect(text, `${file} missing sentinel`).toContain(sentinel);
    }
  });

  it("discovery prompt enforces 1 question per turn rule", () => {
    const text = readFileSync(join(promptsDir, "discovery.md"), "utf-8");
    expect(text).toMatch(/UNA pregunta por turno/i);
  });

  it("architect prompt fixes the stack (no alternatives)", () => {
    const text = readFileSync(join(promptsDir, "architect.md"), "utf-8");
    expect(text).toMatch(/Stack.*FIJO|stack.*fijo/i);
    expect(text).toContain("Next.js 16");
    expect(text).toContain("Prisma 7");
  });

  it("seeds-fixtures prompt forbids Lorem ipsum", () => {
    const text = readFileSync(join(promptsDir, "seeds-fixtures.md"), "utf-8");
    expect(text).toMatch(/Lorem ipsum/i);
    expect(text).toMatch(/realista/i);
  });

  it("tests-writer prompt requires minimum 5 e2e specs", () => {
    const text = readFileSync(join(promptsDir, "tests-writer.md"), "utf-8");
    expect(text).toMatch(/[Mm]ínimo 5 specs|5 specs/);
  });

  it("qa-reviewer prompt requires 0 lint warnings", () => {
    const text = readFileSync(join(promptsDir, "qa-reviewer.md"), "utf-8");
    expect(text).toMatch(/0 warnings/);
    expect(text).toContain("recommendedFix");
  });
});

// ─── PRD fixtures sanity (tutorias + veterinaria) ──────────────

describe("PRD fixtures (tutorias + veterinaria)", () => {
  it("tutorias has 5 entities (User, Subject, TutorProfile, Session, Review)", () => {
    const names = (tutorias as { entities: Array<{ name: string }> }).entities.map((e) => e.name);
    expect(names).toEqual(["User", "Subject", "TutorProfile", "Session", "Review"]);
  });

  it("veterinaria has 5 entities (User, Pet, Appointment, MedicalRecord, Vaccination)", () => {
    const names = (veterinaria as { entities: Array<{ name: string }> }).entities.map(
      (e) => e.name,
    );
    expect(names).toEqual(["User", "Pet", "Appointment", "MedicalRecord", "Vaccination"]);
  });

  it("tutorias has at least 14 useCases (rich domain)", () => {
    expect((tutorias as { useCases: unknown[] }).useCases.length).toBeGreaterThanOrEqual(14);
  });

  it("veterinaria has at least 13 useCases", () => {
    expect((veterinaria as { useCases: unknown[] }).useCases.length).toBeGreaterThanOrEqual(13);
  });

  it("both PRDs declare specialRequirements", () => {
    expect(tutorias.specialRequirements).toBeInstanceOf(Array);
    expect(tutorias.specialRequirements.length).toBeGreaterThan(0);
    expect(veterinaria.specialRequirements).toBeInstanceOf(Array);
    expect(veterinaria.specialRequirements.length).toBeGreaterThan(0);
  });

  it("veterinaria flags MedicalRecord as immutable (audit log requirement)", () => {
    const requirements = (veterinaria as { specialRequirements: string[] }).specialRequirements;
    expect(requirements.some((r) => /[Ii]nmutable|audit/i.test(r))).toBe(true);
  });

  it("tutorias has a Review entity with rating field", () => {
    const review = (tutorias as { entities: Array<{ name: string; fields: Array<{ name: string }> }> })
      .entities.find((e) => e.name === "Review");
    const fieldNames = review?.fields.map((f) => f.name) ?? [];
    expect(fieldNames).toContain("rating");
  });
});
