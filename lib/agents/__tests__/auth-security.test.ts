import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  authMechanicsSchema,
  validateAuthMechanics,
} from "../contracts-v2/auth-mechanics.schema";

const fixtures = join(__dirname, "fixtures");
const auth = JSON.parse(readFileSync(join(fixtures, "yoga-auth-mechanics.json"), "utf-8"));

describe("auth-mechanics schema", () => {
  it("accepts the yoga fixture", () => {
    const r = authMechanicsSchema.safeParse(auth);
    expect(r.success).toBe(true);
  });

  it("rejects invalid token lifetime format (must be like 15m, 30d)", () => {
    const broken = JSON.parse(JSON.stringify(auth));
    broken.tokens.access.lifetime = "fifteen-minutes";
    expect(validateAuthMechanics(broken)).not.toBeNull();
  });

  it("rejects unknown JWT algorithms", () => {
    const broken = JSON.parse(JSON.stringify(auth));
    broken.tokens.access.algorithm = "MD5";
    expect(validateAuthMechanics(broken)).not.toBeNull();
  });

  it("rejects password backends other than argon2id|bcrypt", () => {
    const broken = JSON.parse(JSON.stringify(auth));
    broken.passwordPolicy.backend = "sha1";
    expect(validateAuthMechanics(broken)).not.toBeNull();
  });

  it("requires backend choices for ALL three platforms (win32 / linux / darwin)", () => {
    const broken = JSON.parse(JSON.stringify(auth));
    delete broken.passwordPolicy.backendForPlatform.win32;
    expect(validateAuthMechanics(broken)).not.toBeNull();
  });

  it("rejects passwords shorter than 8 chars policy", () => {
    const broken = JSON.parse(JSON.stringify(auth));
    broken.passwordPolicy.minLength = 4;
    expect(validateAuthMechanics(broken)).not.toBeNull();
  });

  it("rejects rate-limit keys that aren't api/app paths", () => {
    const broken = JSON.parse(JSON.stringify(auth));
    broken.rateLimit["random-key"] = "5/min";
    expect(validateAuthMechanics(broken)).not.toBeNull();
  });

  it("requires the 4 canonical auth services", () => {
    const broken = JSON.parse(JSON.stringify(auth));
    broken.services = ["AuthService", "TokenService"];
    expect(validateAuthMechanics(broken)).not.toBeNull();
  });

  it("yoga fixture uses bcrypt on win32 and argon2id elsewhere", () => {
    expect(auth.passwordPolicy.backendForPlatform.win32).toBe("bcrypt");
    expect(auth.passwordPolicy.backendForPlatform.linux).toBe("argon2id");
    expect(auth.passwordPolicy.backendForPlatform.darwin).toBe("argon2id");
  });

  it("yoga fixture has refresh rotation + family detection enabled", () => {
    expect(auth.tokens.refresh.rotation).toBe(true);
    expect(auth.tokens.refresh.familyDetection).toBe(true);
  });

  it("yoga fixture has access lifetime = 15m and refresh lifetime = 30d", () => {
    expect(auth.tokens.access.lifetime).toBe("15m");
    expect(auth.tokens.refresh.lifetime).toBe("30d");
  });
});

describe("auth-security prompt file", () => {
  const promptPath = join(__dirname, "..", "prompts-v2", "auth-security.md");
  const prompt = readFileSync(promptPath, "utf-8");

  it("exists and is non-trivial", () => {
    expect(prompt.length).toBeGreaterThan(2500);
  });

  it("documents R14-R17", () => {
    for (const rule of ["R14", "R15", "R16", "R17"]) {
      expect(prompt).toContain(`**${rule}**`);
    }
  });

  it("documents the platform-aware password hashing branch", () => {
    expect(prompt).toMatch(/process\.platform === ["']win32["']/);
    expect(prompt).toContain("bcrypt");
    expect(prompt).toContain("argon2");
  });

  it("forbids RBAC concerns (Option A boundary)", () => {
    expect(prompt).toMatch(/NO chequees roles ni permisos|NO permisos|RBAC/i);
  });

  it("documents the exact stop sentinel", () => {
    expect(prompt).toContain("AUTH_SECURITY_DONE: services=4, security_filter=1, repos=2, tests=<n>");
  });

  it("calls out that passwordHash never crosses the DTO boundary", () => {
    expect(prompt).toMatch(/passwordHash.*jamás|passwordHash.*nunca/i);
  });
});
