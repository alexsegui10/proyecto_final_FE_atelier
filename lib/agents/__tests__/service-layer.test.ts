import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { servicesSchema, validateServices } from "../contracts-v2/services.schema";

const fixtures = join(__dirname, "fixtures");
const services = JSON.parse(readFileSync(join(fixtures, "yoga-services.json"), "utf-8"));

describe("services schema", () => {
  it("accepts the yoga fixture (3 services: classes, bookings, memberships)", () => {
    const r = servicesSchema.safeParse(services);
    expect(r.success).toBe(true);
    expect(services.services).toHaveLength(3);
  });

  it("rejects a className that doesn't end in 'Service'", () => {
    const broken = JSON.parse(JSON.stringify(services));
    broken.services[0].className = "ClassesManager";
    expect(validateServices(broken)).toMatch(/Service/);
  });

  it("rejects method names that aren't camelCase", () => {
    const broken = JSON.parse(JSON.stringify(services));
    broken.services[0].methods[0].name = "Create";
    expect(validateServices(broken)).toMatch(/camelCase/);
  });

  it("rejects feature names that aren't kebab-case", () => {
    const broken = JSON.parse(JSON.stringify(services));
    broken.services[0].feature = "Classes_Module";
    expect(validateServices(broken)).not.toBeNull();
  });

  it("requires at least 1 method per service", () => {
    const broken = JSON.parse(JSON.stringify(services));
    broken.services[0].methods = [];
    expect(validateServices(broken)).not.toBeNull();
  });

  it("rejects invalid isolation level", () => {
    const broken = JSON.parse(JSON.stringify(services));
    broken.services[1].methods[0].isolation = "DIRTY_READ";
    expect(validateServices(broken)).not.toBeNull();
  });

  it("yoga fixture omits the auth feature (handled by Auth & Security agent)", () => {
    const features = (services as { services: Array<{ feature: string }> }).services.map(
      (s) => s.feature,
    );
    expect(features).not.toContain("auth");
  });

  it("yoga BookingsService.create is transactional with SERIALIZABLE isolation", () => {
    const bookingsService = (services as { services: Array<{ feature: string; methods: Array<Record<string, unknown>> }> })
      .services.find((s) => s.feature === "bookings");
    const createMethod = bookingsService?.methods.find((m) => m.name === "create");
    expect(createMethod?.transactional).toBe(true);
    expect(createMethod?.isolation).toBe("SERIALIZABLE");
  });
});

describe("service-layer prompt file", () => {
  const promptPath = join(__dirname, "..", "prompts-v2", "service-layer.md");
  const prompt = readFileSync(promptPath, "utf-8");

  it("exists and is non-trivial", () => {
    expect(prompt.length).toBeGreaterThan(2500);
  });

  it("explicitly forbids authorization checks (Option A)", () => {
    expect(prompt).toMatch(/NO hacen checks de permisos|NO hagas checks de permisos/);
    expect(prompt).toMatch(/Opción A/);
  });

  it("documents R9-R12", () => {
    for (const rule of ["R9", "R10", "R11", "R12"]) {
      expect(prompt).toContain(`**${rule}**`);
    }
  });

  it("targets v2 feature-first paths for service files", () => {
    expect(prompt).toContain("src/<feature>/application/service/<Feature>Service.ts");
  });

  it("documents the exact stop sentinel", () => {
    expect(prompt).toContain("SERVICE_LAYER_DONE: services=<n>, methods=<total>, tests=<n>");
  });

  it("excludes the auth feature explicitly", () => {
    expect(prompt).toMatch(/excepto.*auth|NO escribís archivos de auth/);
  });
});
