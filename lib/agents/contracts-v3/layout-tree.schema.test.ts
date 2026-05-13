import { describe, it, expect } from "vitest";

import {
  validateLayoutTree,
  type LayoutTree,
  type PageEntry,
} from "./layout-tree.schema";

function page(over: Partial<PageEntry> = {}): PageEntry {
  return {
    pageRoute: "/",
    layoutGroup: "public",
    headerVariant: "full",
    footerVariant: "full",
    esQuestionable: false,
    rationale: "Home page in the public layout group with full header and footer.",
    breadcrumbs: false,
    requiresAuth: false,
    ...over,
  };
}

function tree(over: Partial<LayoutTree> = {}): LayoutTree {
  return {
    pages: [page()],
    navigationItems: [
      { label: "Home", href: "/", showOnGroups: ["public"], cta: false },
    ],
    defaultHeaderVariant: "full",
    layoutCompositions: {
      public: { slots: ["header", "main", "footer"], sidebarPosition: "none" },
    },
    ...over,
  };
}

describe("layoutTreeSchema — positive", () => {
  it("accepts a minimal valid tree", () => {
    expect(validateLayoutTree(tree())).toBeNull();
  });

  it("accepts dashboard + admin pages with sidebar layouts", () => {
    expect(
      validateLayoutTree(
        tree({
          pages: [
            page(),
            page({
              pageRoute: "/sign-in",
              layoutGroup: "public",
              requiresAuth: false,
              rationale: "Sign-in page in the public layout group.",
            }),
            page({
              pageRoute: "/my/profile",
              layoutGroup: "dashboard",
              requiresAuth: true,
              rationale: "User-only profile page under dashboard wrapper.",
            }),
            page({
              pageRoute: "/admin/users",
              layoutGroup: "admin",
              requiresAuth: true,
              rationale: "Admin-only user management under admin wrapper.",
            }),
          ],
          navigationItems: [
            { label: "Home", href: "/", showOnGroups: ["public"], cta: false },
            { label: "Sign out", href: "/sign-in", showOnGroups: ["dashboard", "admin"], cta: false },
          ],
          layoutCompositions: {
            public: { slots: ["header", "main", "footer"], sidebarPosition: "none" },
            dashboard: { slots: ["header", "sidebar", "main"], sidebarPosition: "left" },
            admin: { slots: ["header", "sidebar", "main", "breadcrumbs"], sidebarPosition: "left" },
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("layoutTreeSchema — refinements (yoga bug class E closure)", () => {
  it("R0: home '/' MUST NOT be standalone (the actual bug E shape)", () => {
    expect(
      validateLayoutTree(
        tree({
          pages: [page({ pageRoute: "/", layoutGroup: "standalone" })],
        }),
      ),
    ).toMatch(/must NOT be standalone/);
  });

  it("R-nav: navigationItem.href pointing to a non-existent page is rejected", () => {
    expect(
      validateLayoutTree(
        tree({
          navigationItems: [
            { label: "Ghost", href: "/does-not-exist", showOnGroups: ["public"], cta: false },
          ],
        }),
      ),
    ).toMatch(/must correspond to a page/);
  });

  it("R-nav: anchor #links are accepted (they don't need a page)", () => {
    expect(
      validateLayoutTree(
        tree({
          navigationItems: [
            { label: "Top", href: "#hero", showOnGroups: ["public"], cta: false },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("R-page-unique: duplicate pageRoute is rejected", () => {
    expect(
      validateLayoutTree(
        tree({
          pages: [page(), page({ pageRoute: "/" })],
        }),
      ),
    ).toMatch(/duplicate pageRoute/);
  });

  it("R-private-redirects: requiresAuth=true in standalone is rejected", () => {
    expect(
      validateLayoutTree(
        tree({
          pages: [
            page(),
            page({
              pageRoute: "/secret",
              layoutGroup: "standalone",
              requiresAuth: true,
              rationale: "Should fail because authed pages must be in dashboard or admin.",
            }),
          ],
        }),
      ),
    ).toMatch(/requiresAuth=true pages must live in dashboard or admin/);
  });

  it("R-private-redirects: requiresAuth=true in dashboard is accepted", () => {
    expect(
      validateLayoutTree(
        tree({
          pages: [
            page(),
            page({
              pageRoute: "/my/area",
              layoutGroup: "dashboard",
              requiresAuth: true,
              rationale: "Member-only dashboard area.",
            }),
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("layoutTreeSchema — field-level validation", () => {
  it("rejects rationale that's too short (forces real justification)", () => {
    expect(
      validateLayoutTree(tree({ pages: [page({ rationale: "ok" })] })),
    ).toMatch(/rationale/);
  });

  it("rejects empty navigationItems (every app needs at least one nav)", () => {
    expect(
      validateLayoutTree(tree({ navigationItems: [] })),
    ).toMatch(/navigationItems/);
  });

  it("rejects layoutComposition with only 1 slot", () => {
    expect(
      validateLayoutTree(
        tree({
          layoutCompositions: {
            public: { slots: ["main"], sidebarPosition: "none" },
          },
        }),
      ),
    ).toMatch(/slots/);
  });
});
