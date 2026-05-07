import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rbacPolicySchema, validateRbacPolicy } from "../contracts-v2/rbac-policy.schema";

const fixtures = join(__dirname, "fixtures");
const policy = JSON.parse(readFileSync(join(fixtures, "yoga-rbac-policy.json"), "utf-8"));

describe("rbac-policy schema", () => {
  it("accepts the yoga fixture (3 roles, 3 ownership rules)", () => {
    const r = rbacPolicySchema.safeParse(policy);
    expect(r.success).toBe(true);
    expect(policy.roles).toHaveLength(3);
    expect(policy.ownershipRules).toHaveLength(3);
  });

  it("rejects roles that aren't lowercase identifiers", () => {
    const broken = JSON.parse(JSON.stringify(policy));
    broken.roles[0] = "Admin";
    expect(validateRbacPolicy(broken)).not.toBeNull();
  });

  it("rejects abilities entries for unknown roles (consistency check)", () => {
    const broken = JSON.parse(JSON.stringify(policy));
    broken.abilities.push({ role: "ghost", rules: [{ action: "read", subject: "Class" }] });
    expect(validateRbacPolicy(broken)).toMatch(/role.*present in roles/);
  });

  it("rejects roles that have no abilities entry", () => {
    const broken = JSON.parse(JSON.stringify(policy));
    broken.roles.push("auditor");
    expect(validateRbacPolicy(broken)).toMatch(/role must have at least one abilities/);
  });

  it("rejects entities that aren't PascalCase in ownershipRules", () => {
    const broken = JSON.parse(JSON.stringify(policy));
    broken.ownershipRules[0].entity = "booking";
    expect(validateRbacPolicy(broken)).not.toBeNull();
  });

  it("rejects unknown enforceAt levels", () => {
    const broken = JSON.parse(JSON.stringify(policy));
    broken.ownershipRules[0].enforceAt = ["middleware-level"];
    expect(validateRbacPolicy(broken)).not.toBeNull();
  });

  it("requires at least 1 ability rule per role", () => {
    const broken = JSON.parse(JSON.stringify(policy));
    broken.abilities[0].rules = [];
    expect(validateRbacPolicy(broken)).not.toBeNull();
  });
});

describe("rbac-policy semantics — yoga fixture", () => {
  type Rule = {
    action: string;
    subject: string;
    conditions?: Record<string, unknown>;
    inverted?: boolean;
    fields?: string[];
    reason?: string;
  };
  type Abilities = { role: string; rules: Rule[] };
  const abilities = (policy as { abilities: Abilities[] }).abilities;
  function rulesFor(role: string): Rule[] {
    return abilities.find((a) => a.role === role)?.rules ?? [];
  }

  it("admin has manage:all", () => {
    const adminRules = rulesFor("admin");
    expect(adminRules.some((r) => r.action === "manage" && r.subject === "all")).toBe(true);
  });

  it("teacher can update Class only with teacherId condition", () => {
    const rule = rulesFor("teacher").find((r) => r.action === "update" && r.subject === "Class");
    expect(rule?.conditions).toEqual({ teacherId: "${user.id}" });
  });

  it("teacher can update Booking but only the status field", () => {
    const rule = rulesFor("teacher").find(
      (r) => r.action === "update" && r.subject === "Booking",
    );
    expect(rule?.fields).toEqual(["status"]);
  });

  it("student can delete Booking only with userId === user.id", () => {
    const rule = rulesFor("student").find((r) => r.action === "delete" && r.subject === "Booking");
    expect(rule?.conditions).toEqual({ userId: "${user.id}" });
  });

  it("student has an inverted manage:User rule (cannot manage other users)", () => {
    const rule = rulesFor("student").find(
      (r) => r.action === "manage" && r.subject === "User" && r.inverted === true,
    );
    expect(rule).toBeDefined();
    expect(rule?.reason).toBeTruthy();
  });

  it("student can update only own User profile and only safe fields", () => {
    const rule = rulesFor("student").find(
      (r) => r.action === "update" && r.subject === "User",
    );
    expect(rule?.conditions).toEqual({ id: "${user.id}" });
    expect(rule?.fields).toEqual(["name", "email"]);
  });

  it("ownership rules cover Booking and Membership at row-level", () => {
    const rowLevel = (policy as { ownershipRules: Array<{ entity: string; enforceAt: string[] }> })
      .ownershipRules.filter((o) => o.enforceAt.includes("row-level"));
    expect(rowLevel.map((o) => o.entity).sort()).toEqual(["Booking", "Membership"]);
  });
});

describe("rbac-authorization prompt file", () => {
  const promptPath = join(__dirname, "..", "prompts-v2", "rbac-authorization.md");
  const prompt = readFileSync(promptPath, "utf-8");

  it("exists and is non-trivial", () => {
    expect(prompt.length).toBeGreaterThan(2500);
  });

  it("documents R18-R19", () => {
    for (const rule of ["R18", "R19"]) {
      expect(prompt).toContain(`**${rule}**`);
    }
  });

  it("explicitly enforces Option A (services stay pure)", () => {
    expect(prompt).toMatch(/Opción A/);
    expect(prompt).toMatch(/NO modificás los Services|NO los modificás/i);
  });

  it("documents `assertCan` throws ForbiddenError", () => {
    expect(prompt).toContain("assertCan");
    expect(prompt).toContain("ForbiddenError");
  });

  it("documents `getOwnershipFilter` for row-level filtering", () => {
    expect(prompt).toContain("getOwnershipFilter");
  });

  it("documents the exact stop sentinel", () => {
    expect(prompt).toContain(
      "RBAC_AUTHORIZATION_DONE: roles=<n>, abilities=<n>, ownership_rules=<n>, tests=<n>",
    );
  });

  it("requires minimum 20 tests in the matrix", () => {
    expect(prompt).toMatch(/[Mm]ínimo 20 tests/);
  });
});
