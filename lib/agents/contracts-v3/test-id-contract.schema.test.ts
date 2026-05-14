import { describe, it, expect } from "vitest";

import {
  validateTestIdContract,
  type TestIdContract,
  type TestIdEntry,
} from "./test-id-contract.schema";

function entry(over: Partial<TestIdEntry> = {}): TestIdEntry {
  return {
    selector: "header-root",
    purpose: "Root <header> element rendered by every layout group",
    requiredOn: { layoutGroup: "public" },
    criticality: "critical",
    consumedByFlow: ["client-anonymous"],
    ...over,
  };
}

function contract(over: Partial<TestIdContract> = {}): TestIdContract {
  return {
    generatedAt: "2026-05-13T22:00:00.000Z",
    entries: [
      entry({ selector: "header-root" }),
      entry({ selector: "nav-primary", purpose: "Primary nav inside header" }),
      entry({
        selector: "signin-form",
        purpose: "Sign-in form root",
        requiredOn: { component: "SignInForm" },
        consumedByFlow: ["client-anonymous", "client-authenticated"],
      }),
      entry({
        selector: "signup-form",
        purpose: "Sign-up form root",
        requiredOn: { component: "SignUpForm" },
        consumedByFlow: ["client-anonymous"],
      }),
      entry({
        selector: "admin-create-class",
        purpose: "Create button on /admin/classes",
        requiredOn: { component: "AdminCreateButton" },
        consumedByFlow: ["admin"],
      }),
    ],
    ...over,
  };
}

describe("testIdContractSchema — positive", () => {
  it("accepts the 5-entry default", () => {
    expect(validateTestIdContract(contract())).toBeNull();
  });

  it("accepts entries with both component and layoutGroup keys", () => {
    expect(
      validateTestIdContract(
        contract({
          entries: [
            ...contract().entries,
            entry({
              selector: "signout-button",
              purpose: "Signout CTA in authenticated layouts",
              requiredOn: { layoutGroup: "dashboard" },
              consumedByFlow: ["client-authenticated", "admin"],
            }),
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("testIdContractSchema — refinements", () => {
  it("rejects fewer than 5 entries", () => {
    expect(validateTestIdContract(contract({ entries: [entry()] }))).toMatch(/at least 5/);
  });

  it("rejects duplicate selectors", () => {
    expect(
      validateTestIdContract(
        contract({
          entries: [
            entry({ selector: "header-root" }),
            entry({ selector: "header-root" }), // duplicate
            entry({ selector: "nav-primary" }),
            entry({ selector: "signin-form" }),
            entry({ selector: "signup-form" }),
          ],
        }),
      ),
    ).toMatch(/duplicate selector/);
  });

  it("rejects entries where requiredOn has NONE of component / layoutGroup / pageRoute", () => {
    expect(
      validateTestIdContract(
        contract({
          entries: [
            entry({ requiredOn: {} as never }),
            entry({ selector: "a" }),
            entry({ selector: "b" }),
            entry({ selector: "c" }),
            entry({ selector: "d" }),
          ],
        }),
      ),
    ).toMatch(/requiredOn must specify at least one of/);
  });

  it("rejects non-kebab-case selectors", () => {
    expect(
      validateTestIdContract(
        contract({
          entries: [
            entry({ selector: "HeaderRoot" }),
            entry({ selector: "a" }),
            entry({ selector: "b" }),
            entry({ selector: "c" }),
            entry({ selector: "d" }),
          ],
        }),
      ),
    ).toMatch(/kebab-case/);
  });

  it("rejects component name not in PascalCase", () => {
    expect(
      validateTestIdContract(
        contract({
          entries: [
            entry({ requiredOn: { component: "sign-in-form" as never } }),
            entry({ selector: "a" }),
            entry({ selector: "b" }),
            entry({ selector: "c" }),
            entry({ selector: "d" }),
          ],
        }),
      ),
    ).toMatch(/PascalCase/);
  });

  it("rejects consumedByFlow with unknown flow names", () => {
    expect(
      validateTestIdContract(
        contract({
          entries: [
            entry({ consumedByFlow: ["mobile-app" as never] }),
            entry({ selector: "a" }),
            entry({ selector: "b" }),
            entry({ selector: "c" }),
            entry({ selector: "d" }),
          ],
        }),
      ),
    ).toMatch(/consumedByFlow/);
  });
});

describe("testIdContractSchema — requiredOn three-variant model (post-F3 fix)", () => {
  it("accepts requiredOn with pageRoute (new variant)", () => {
    expect(
      validateTestIdContract(
        contract({
          entries: [
            entry({ selector: "header-root" }),
            entry({ selector: "nav-primary" }),
            entry({
              selector: "signin-form",
              purpose: "Sign-in form root on /sign-in",
              requiredOn: { pageRoute: "/sign-in" },
              consumedByFlow: ["client-anonymous", "client-authenticated"],
            }),
            entry({
              selector: "hero-cta",
              purpose: "Hero CTA on the home page",
              requiredOn: { pageRoute: "/" },
              consumedByFlow: ["client-anonymous"],
              criticality: "recommended",
            }),
            entry({ selector: "signup-form", purpose: "Sign-up form on /sign-up" }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("accepts layoutGroup: 'standalone' (post-rework — auth pages can be standalone)", () => {
    expect(
      validateTestIdContract(
        contract({
          entries: [
            entry({ selector: "header-root" }),
            entry({
              selector: "auth-shell",
              purpose: "Standalone auth shell wrapper (sign-in, sign-up, errors)",
              requiredOn: { layoutGroup: "standalone" },
              consumedByFlow: ["client-anonymous"],
            }),
            entry({ selector: "nav-primary", purpose: "Primary nav inside header" }),
            entry({ selector: "signin-form", purpose: "Sign-in form root" }),
            entry({ selector: "signup-form", purpose: "Sign-up form root" }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("rejects pageRoute that does not start with '/'", () => {
    expect(
      validateTestIdContract(
        contract({
          entries: [
            entry({
              selector: "signin-form",
              requiredOn: { pageRoute: "sign-in" as never },
            }),
            entry({ selector: "a" }),
            entry({ selector: "b" }),
            entry({ selector: "c" }),
            entry({ selector: "d" }),
          ],
        }),
      ),
    ).toMatch(/pageRoute must start with/);
  });

  it("accepts a mixed contract: layoutGroup + pageRoute + component (the realistic case)", () => {
    expect(
      validateTestIdContract(
        contract({
          entries: [
            entry({
              selector: "header-root",
              requiredOn: { layoutGroup: "public" },
            }),
            entry({
              selector: "signin-form",
              purpose: "Sign-in form on /sign-in",
              requiredOn: { pageRoute: "/sign-in" },
              consumedByFlow: ["client-anonymous"],
            }),
            entry({
              selector: "admin-create-class",
              purpose: "Create button — can live in /admin/classes or a modal",
              requiredOn: { component: "AdminCreateButton" },
              consumedByFlow: ["admin"],
            }),
            entry({ selector: "nav-primary", purpose: "Primary nav inside header" }),
            entry({ selector: "signup-form", purpose: "Sign-up form on /sign-up" }),
          ],
        }),
      ),
    ).toBeNull();
  });
});
