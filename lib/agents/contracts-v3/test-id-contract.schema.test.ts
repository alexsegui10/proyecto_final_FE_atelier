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

  it("rejects entries where requiredOn has NEITHER component nor layoutGroup", () => {
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
    ).toMatch(/requiredOn must specify either component or layoutGroup/);
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
