import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertArtifactsValid } from "./artifact-boundary";
import { validateTestIdContract } from "../contracts-v3/test-id-contract.schema";

// ─── B-w4-5b: boundary validation fails the agent cleanly ───────────

describe("assertArtifactsValid — boundary validation (B-w4-5b)", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "atelier-boundary-"));
    await mkdir(join(workDir, ".atelier"), { recursive: true });
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function writeArtifact(name: string, value: unknown): Promise<void> {
    await writeFile(join(workDir, ".atelier", name), JSON.stringify(value), "utf8");
  }

  it("rejects the exact F3-run-10a shape (`selectors` instead of `entries`)", async () => {
    // What layout-architect's LLM actually emitted and crashed the run.
    await writeArtifact("test-id-contract.json", {
      selectors: [
        {
          selector: "header-root",
          requiredOn: { component: "AppHeader" },
          criticality: "critical",
          consumedByFlow: ["client-anonymous"],
        },
      ],
    });

    await expect(
      assertArtifactsValid("layout-architect", workDir, {
        "test-id-contract.json": validateTestIdContract,
      }),
    ).rejects.toThrow(/violates its schema/);
  });

  it("rejects unreadable / non-JSON artifact with a clear message", async () => {
    await writeFile(join(workDir, ".atelier", "test-id-contract.json"), "{ not json", "utf8");
    await expect(
      assertArtifactsValid("layout-architect", workDir, {
        "test-id-contract.json": validateTestIdContract,
      }),
    ).rejects.toThrow(/unreadable or non-JSON/);
  });

  it("passes a schema-valid test-id-contract (canonical `entries` shape)", async () => {
    await writeArtifact("test-id-contract.json", {
      generatedAt: new Date().toISOString(),
      entries: [
        { selector: "signin-form", purpose: "login form on /sign-in", requiredOn: { pageRoute: "/sign-in" }, criticality: "critical", consumedByFlow: ["client-anonymous"] },
        { selector: "signup-form", purpose: "register form on /sign-up", requiredOn: { pageRoute: "/sign-up" }, criticality: "critical", consumedByFlow: ["client-anonymous"] },
        { selector: "header-root", purpose: "shell header root wrapper", requiredOn: { component: "AppHeader" }, criticality: "critical", consumedByFlow: ["client-anonymous"] },
        { selector: "nav-primary", purpose: "primary navigation list", requiredOn: { component: "NavPrimary" }, criticality: "critical", consumedByFlow: ["client-anonymous"] },
        { selector: "signout-button", purpose: "sign out action in shell", requiredOn: { component: "SignoutButton" }, criticality: "critical", consumedByFlow: ["client-authenticated"] },
      ],
    });
    await expect(
      assertArtifactsValid("layout-architect", workDir, {
        "test-id-contract.json": validateTestIdContract,
      }),
    ).resolves.toBeUndefined();
  });

  it("is a no-op when no validators are declared", async () => {
    await expect(
      assertArtifactsValid("some-agent", workDir, undefined),
    ).resolves.toBeUndefined();
  });

  it("invokes onValid once per artifact that passes (success-path trace)", async () => {
    await writeArtifact("test-id-contract.json", {
      generatedAt: new Date().toISOString(),
      entries: [
        { selector: "signin-form", purpose: "login form on /sign-in", requiredOn: { pageRoute: "/sign-in" }, criticality: "critical", consumedByFlow: ["client-anonymous"] },
        { selector: "signup-form", purpose: "register form on /sign-up", requiredOn: { pageRoute: "/sign-up" }, criticality: "critical", consumedByFlow: ["client-anonymous"] },
        { selector: "header-root", purpose: "shell header root wrapper", requiredOn: { component: "AppHeader" }, criticality: "critical", consumedByFlow: ["client-anonymous"] },
        { selector: "nav-primary", purpose: "primary navigation list", requiredOn: { component: "NavPrimary" }, criticality: "critical", consumedByFlow: ["client-anonymous"] },
        { selector: "signout-button", purpose: "sign out action in shell", requiredOn: { component: "SignoutButton" }, criticality: "critical", consumedByFlow: ["client-authenticated"] },
      ],
    });
    const seen: Array<[string, string]> = [];
    await assertArtifactsValid(
      "layout-architect",
      workDir,
      { "test-id-contract.json": validateTestIdContract },
      (agent, file) => {
        seen.push([agent, file]);
      },
    );
    expect(seen).toEqual([["layout-architect", "test-id-contract.json"]]);
  });

  it("does NOT invoke onValid when the artifact violates its schema", async () => {
    await writeArtifact("test-id-contract.json", { selectors: [] });
    const seen: Array<[string, string]> = [];
    await expect(
      assertArtifactsValid(
        "layout-architect",
        workDir,
        { "test-id-contract.json": validateTestIdContract },
        (agent, file) => {
          seen.push([agent, file]);
        },
      ),
    ).rejects.toThrow(/violates its schema/);
    expect(seen).toEqual([]);
  });
});
