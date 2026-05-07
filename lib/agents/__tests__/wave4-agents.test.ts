import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  apiContractSchema,
  validateApiContract,
} from "../contracts-v2/api-contract.schema";
import {
  frontendArchitectureSchema,
  validateFrontendArchitecture,
} from "../contracts-v2/frontend-architecture.schema";
import {
  componentsCatalogSchema,
  validateComponentsCatalog,
  REQUIRED_PRIMITIVES,
} from "../contracts-v2/components-catalog.schema";
import {
  formsValidationsSchema,
  validateFormsValidations,
} from "../contracts-v2/forms-validations.schema";
import {
  pagesRoutingSchema,
  validatePagesRouting,
} from "../contracts-v2/pages-routing.schema";

const fixtures = join(__dirname, "fixtures");
const apiContract = JSON.parse(readFileSync(join(fixtures, "yoga-api-contract.json"), "utf-8"));
const frontend = JSON.parse(
  readFileSync(join(fixtures, "yoga-frontend-architecture.json"), "utf-8"),
);
const catalog = JSON.parse(readFileSync(join(fixtures, "yoga-components-catalog.json"), "utf-8"));
const forms = JSON.parse(readFileSync(join(fixtures, "yoga-forms-validations.json"), "utf-8"));
const pages = JSON.parse(readFileSync(join(fixtures, "yoga-pages-routing.json"), "utf-8"));

// ─── api-contract ────────────────────────────────────────────────────

describe("api-contract schema", () => {
  it("accepts the yoga fixture", () => {
    const r = apiContractSchema.safeParse(apiContract);
    expect(r.success).toBe(true);
  });

  it("rejects paths that don't start with /api/", () => {
    const broken = JSON.parse(JSON.stringify(apiContract));
    broken.endpoints[0].path = "/auth/login";
    expect(validateApiContract(broken)).not.toBeNull();
  });

  it("rejects unknown HTTP methods", () => {
    const broken = JSON.parse(JSON.stringify(apiContract));
    broken.endpoints[0].method = "OPTIONS";
    expect(validateApiContract(broken)).not.toBeNull();
  });

  it("rejects status codes outside 2xx for successStatus", () => {
    const broken = JSON.parse(JSON.stringify(apiContract));
    broken.endpoints[0].successStatus = 404;
    expect(validateApiContract(broken)).not.toBeNull();
  });

  it("rejects auth values other than public/authenticated/admin", () => {
    const broken = JSON.parse(JSON.stringify(apiContract));
    broken.endpoints[0].auth = "guest";
    expect(validateApiContract(broken)).not.toBeNull();
  });

  it("rejects error codes that aren't SCREAMING_SNAKE", () => {
    const broken = JSON.parse(JSON.stringify(apiContract));
    broken.endpoints[4].errors[0].code = "BookingCapacity";
    expect(validateApiContract(broken)).not.toBeNull();
  });

  it("yoga fixture has POST/GET/DELETE on /api/bookings", () => {
    const methods = (apiContract as { endpoints: Array<{ method: string; path: string }> })
      .endpoints.filter((e) => e.path.startsWith("/api/bookings")).map((e) => e.method);
    expect(methods).toContain("POST");
    expect(methods).toContain("GET");
    expect(methods).toContain("DELETE");
  });

  it("yoga fixture has rbac config on protected endpoints", () => {
    const protectedEndpoints = (apiContract as { endpoints: Array<{ auth: string; rbac?: unknown }> })
      .endpoints.filter((e) => e.auth !== "public");
    for (const ep of protectedEndpoints) {
      expect(ep.rbac, JSON.stringify(ep)).toBeDefined();
    }
  });
});

// ─── frontend-architecture ──────────────────────────────────────────

describe("frontend-architecture schema", () => {
  it("accepts the yoga fixture", () => {
    const r = frontendArchitectureSchema.safeParse(frontend);
    expect(r.success).toBe(true);
  });

  it("rejects context names that don't end in 'Context'", () => {
    const broken = JSON.parse(JSON.stringify(frontend));
    broken.contexts[0].name = "AuthState";
    expect(validateFrontendArchitecture(broken)).toMatch(/Context/);
  });

  it("rejects query/mutation hook names that aren't use*-style", () => {
    const broken = JSON.parse(JSON.stringify(frontend));
    broken.queries[0].name = "fetchClasses";
    expect(validateFrontendArchitecture(broken)).toMatch(/use\*/);
  });

  it("rejects query endpoints that aren't 'GET /api/...'", () => {
    const broken = JSON.parse(JSON.stringify(frontend));
    broken.queries[0].endpoint = "POST /api/classes";
    expect(validateFrontendArchitecture(broken)).not.toBeNull();
  });

  it("rejects mutation endpoints that aren't POST/PUT/PATCH/DELETE", () => {
    const broken = JSON.parse(JSON.stringify(frontend));
    broken.mutations[0].endpoint = "GET /api/classes";
    expect(validateFrontendArchitecture(broken)).not.toBeNull();
  });

  it("yoga fixture has AuthContext + at least 1 feature context", () => {
    const names = (frontend as { contexts: Array<{ name: string }> }).contexts.map((c) => c.name);
    expect(names).toContain("AuthContext");
    expect(names.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── components-catalog ────────────────────────────────────────────

describe("components-catalog schema", () => {
  it("accepts the yoga fixture", () => {
    const r = componentsCatalogSchema.safeParse(catalog);
    expect(r.success).toBe(true);
  });

  it("rejects when REQUIRED_PRIMITIVES are missing", () => {
    const broken = JSON.parse(JSON.stringify(catalog));
    broken.primitives = broken.primitives.filter((p: string) => p !== "dialog");
    expect(validateComponentsCatalog(broken)).toMatch(/dialog/);
  });

  it("rejects components paths outside client/components/", () => {
    const broken = JSON.parse(JSON.stringify(catalog));
    broken.components[0].path = "src/components/LoginForm.tsx";
    expect(validateComponentsCatalog(broken)).not.toBeNull();
  });

  it("rejects component names that aren't PascalCase", () => {
    const broken = JSON.parse(JSON.stringify(catalog));
    broken.components[0].name = "loginForm";
    expect(validateComponentsCatalog(broken)).toMatch(/PascalCase/);
  });

  it("rejects components with an unknown area", () => {
    const broken = JSON.parse(JSON.stringify(catalog));
    broken.components[0].area = "Misc";
    expect(validateComponentsCatalog(broken)).not.toBeNull();
  });

  it("requires minimum 20 components in the catalog", () => {
    const broken = JSON.parse(JSON.stringify(catalog));
    broken.components = broken.components.slice(0, 5);
    expect(validateComponentsCatalog(broken)).not.toBeNull();
  });

  it("REQUIRED_PRIMITIVES has 17 items (the 5 pre-installed are NOT in this list)", () => {
    expect(REQUIRED_PRIMITIVES).toHaveLength(17);
    expect(REQUIRED_PRIMITIVES).not.toContain("button");
    expect(REQUIRED_PRIMITIVES).not.toContain("card");
    expect(REQUIRED_PRIMITIVES).toContain("dialog");
    expect(REQUIRED_PRIMITIVES).toContain("checkbox");
  });

  it("yoga catalog has all 22 primitives (5 pre-installed + 17 new)", () => {
    expect(catalog.primitives).toHaveLength(22);
  });

  it("yoga catalog covers Auth, Layout, Home, Shop, Profile, Admin, Shared areas", () => {
    const areas = new Set(
      (catalog as { components: Array<{ area: string }> }).components.map((c) => c.area),
    );
    for (const a of ["Auth", "Layout", "Home", "Shop", "Profile", "Admin", "Shared"]) {
      expect(areas, `missing area ${a}`).toContain(a);
    }
  });
});

// ─── forms-validations ────────────────────────────────────────────

describe("forms-validations schema", () => {
  it("accepts the yoga fixture", () => {
    const r = formsValidationsSchema.safeParse(forms);
    expect(r.success).toBe(true);
  });

  it("rejects form names that don't end in 'Form'", () => {
    const broken = JSON.parse(JSON.stringify(forms));
    broken.forms[0].name = "Login";
    expect(validateFormsValidations(broken)).toMatch(/Form/);
  });

  it("rejects form paths outside client/components/forms/", () => {
    const broken = JSON.parse(JSON.stringify(forms));
    broken.forms[0].path = "client/components/Auth/LoginForm.tsx";
    expect(validateFormsValidations(broken)).not.toBeNull();
  });

  it("rejects mutation names that aren't use*-style", () => {
    const broken = JSON.parse(JSON.stringify(forms));
    broken.forms[0].mutation = "loginMutation";
    expect(validateFormsValidations(broken)).toMatch(/use\*/);
  });

  it("rejects schema files that aren't .ts", () => {
    const broken = JSON.parse(JSON.stringify(forms));
    broken.forms[0].schemaFile = "client/lib/schemas/auth.json";
    expect(validateFormsValidations(broken)).not.toBeNull();
  });

  it("yoga fixture has the 3 auth-related forms", () => {
    const names = (forms as { forms: Array<{ name: string }> }).forms.map((f) => f.name);
    expect(names).toContain("LoginForm");
    expect(names).toContain("RegisterForm");
  });
});

// ─── pages-routing ────────────────────────────────────────────────

describe("pages-routing schema", () => {
  it("accepts the yoga fixture", () => {
    const r = pagesRoutingSchema.safeParse(pages);
    expect(r.success).toBe(true);
  });

  it("rejects page files outside app/", () => {
    const broken = JSON.parse(JSON.stringify(pages));
    broken.pages[0].file = "src/pages/HomePage.tsx";
    expect(validatePagesRouting(broken)).not.toBeNull();
  });

  it("rejects routes that don't start with /", () => {
    const broken = JSON.parse(JSON.stringify(pages));
    broken.pages[0].route = "home";
    expect(validatePagesRouting(broken)).not.toBeNull();
  });

  it("rejects page access values other than public/private/admin", () => {
    const broken = JSON.parse(JSON.stringify(pages));
    broken.pages[0].access = "guest";
    expect(validatePagesRouting(broken)).not.toBeNull();
  });

  it("rejects layout files that aren't *layout.tsx", () => {
    const broken = JSON.parse(JSON.stringify(pages));
    broken.layouts[0].file = "app/layout.ts";
    expect(validatePagesRouting(broken)).not.toBeNull();
  });

  it("requires every page to have metadataTitle (SEO mandate)", () => {
    const broken = JSON.parse(JSON.stringify(pages));
    delete broken.pages[0].metadataTitle;
    expect(validatePagesRouting(broken)).not.toBeNull();
  });

  it("yoga fixture covers all 3 access levels (public + private + admin)", () => {
    const levels = new Set(
      (pages as { pages: Array<{ access: string }> }).pages.map((p) => p.access),
    );
    expect(levels.has("public")).toBe(true);
    expect(levels.has("private")).toBe(true);
    expect(levels.has("admin")).toBe(true);
  });

  it("yoga fixture has not-found.tsx + error.tsx + loading.tsx", () => {
    expect(pages.specialFiles).toContain("app/not-found.tsx");
    expect(pages.specialFiles).toContain("app/error.tsx");
    expect(pages.specialFiles).toContain("app/loading.tsx");
  });
});

// ─── prompts presence ────────────────────────────────────────────

describe("Wave 4 prompts", () => {
  it.each([
    "api-backend.md",
    "frontend-architect.md",
    "ui-components.md",
    "forms-validations.md",
    "pages-routing.md",
  ])("%s exists and is non-trivial", (file) => {
    const path = join(__dirname, "..", "prompts-v2", file);
    const text = readFileSync(path, "utf-8");
    expect(text.length).toBeGreaterThan(2000);
  });

  it("ui-components prompt lists all 17 required primitives", () => {
    const text = readFileSync(join(__dirname, "..", "prompts-v2", "ui-components.md"), "utf-8");
    for (const p of REQUIRED_PRIMITIVES) {
      expect(text).toContain(p);
    }
  });

  it("api-backend prompt documents Option A composition (authz.assertCan + service.method)", () => {
    const text = readFileSync(join(__dirname, "..", "prompts-v2", "api-backend.md"), "utf-8");
    expect(text).toContain("assertCan");
    expect(text).toMatch(/Opción A/);
  });

  it("each Wave 4 prompt documents its exact stop sentinel", () => {
    const sentinels: Record<string, string> = {
      "api-backend.md": "API_BACKEND_DONE",
      "frontend-architect.md": "FRONTEND_ARCHITECT_DONE",
      "ui-components.md": "UI_COMPONENTS_DONE",
      "forms-validations.md": "FORMS_VALIDATIONS_DONE",
      "pages-routing.md": "PAGES_ROUTING_DONE",
    };
    for (const [file, sentinel] of Object.entries(sentinels)) {
      const text = readFileSync(join(__dirname, "..", "prompts-v2", file), "utf-8");
      expect(text, `${file} missing sentinel ${sentinel}`).toContain(sentinel);
    }
  });
});
