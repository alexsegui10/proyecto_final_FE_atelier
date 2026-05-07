import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  designSystemSchema,
  validateDesignSystem,
  VIBE_NAMES,
} from "../contracts-v2/design-system.schema";
import {
  screensMapSchema,
  validateScreensMap,
} from "../contracts-v2/screens-map.schema";

const fixtures = join(__dirname, "fixtures");
const ds = JSON.parse(readFileSync(join(fixtures, "yoga-design-system.json"), "utf-8"));
const sm = JSON.parse(readFileSync(join(fixtures, "yoga-screens-map.json"), "utf-8"));

describe("design-system schema", () => {
  it("accepts the yoga Calm fixture", () => {
    const r = designSystemSchema.safeParse(ds);
    expect(r.success).toBe(true);
  });

  it("rejects missing palette section", () => {
    const broken = { ...ds, palette: { ...ds.palette, brand: undefined } };
    expect(validateDesignSystem(broken)).not.toBeNull();
  });

  it("rejects an unknown vibe", () => {
    const broken = { ...ds, vibe: "Brutalist" };
    expect(validateDesignSystem(broken)).toMatch(/vibe/);
  });

  it("rejects empty color values", () => {
    const broken = JSON.parse(JSON.stringify(ds));
    broken.palette.brand.primary = "";
    expect(validateDesignSystem(broken)).toMatch(/cannot be empty/);
  });

  it("exposes all 5 vibes (Linear, Stripe, Notion, Vercel, Calm)", () => {
    expect(VIBE_NAMES).toEqual(["Linear", "Stripe", "Notion", "Vercel", "Calm"]);
  });

  it("requires the full type scale (xs..3xl)", () => {
    const broken = JSON.parse(JSON.stringify(ds));
    delete broken.typography.scale["3xl"];
    expect(validateDesignSystem(broken)).not.toBeNull();
  });
});

describe("screens-map schema", () => {
  it("accepts the yoga fixture", () => {
    const r = screensMapSchema.safeParse(sm);
    expect(r.success).toBe(true);
  });

  it("rejects fewer than 6 screens", () => {
    const broken = { ...sm, screens: sm.screens.slice(0, 3) };
    expect(validateScreensMap(broken)).toMatch(/6 screens/);
  });

  it("rejects fewer than 15 component specs", () => {
    const broken = JSON.parse(JSON.stringify(sm));
    const keys = Object.keys(broken.componentSpecs);
    for (const k of keys.slice(10)) delete broken.componentSpecs[k];
    expect(validateScreensMap(broken)).toMatch(/15 component specs/);
  });

  it("rejects screen routes that don't start with /", () => {
    const broken = JSON.parse(JSON.stringify(sm));
    broken.screens[0].route = "home";
    expect(validateScreensMap(broken)).toMatch(/route must start/);
  });

  it("rejects an invalid access value", () => {
    const broken = JSON.parse(JSON.stringify(sm));
    broken.screens[0].access = "guest";
    expect(validateScreensMap(broken)).not.toBeNull();
  });

  it("yoga fixture has the 8 expected core screens (admin + private + public)", () => {
    const names = (sm as { screens: Array<{ name: string }> }).screens.map((s) => s.name);
    expect(names).toContain("HomePage");
    expect(names).toContain("AuthPage");
    expect(names).toContain("DashboardPage");
    expect(names).toContain("AdminClassesPage");
    expect(names).toContain("AdminUsersPage");
    expect(names).toContain("NotFoundPage");
  });
});

describe("ux-ui-designer prompt file", () => {
  const promptPath = join(__dirname, "..", "prompts-v2", "ux-ui-designer.md");
  const prompt = readFileSync(promptPath, "utf-8");

  it("exists and is non-trivial", () => {
    expect(prompt.length).toBeGreaterThan(2000);
  });

  it("documents all 5 vibes", () => {
    for (const v of VIBE_NAMES) {
      expect(prompt).toContain(`Vibe \`${v}\``);
    }
  });

  it("documents the exact stop sentinel format", () => {
    expect(prompt).toContain(
      "UX_UI_DESIGNER_DONE: vibe=<vibe>, screens=<count>, components=<count>",
    );
  });

  it("calls out the minimum constraints (6 screens, 15 component specs)", () => {
    expect(prompt).toMatch(/6 pantallas/);
    expect(prompt).toMatch(/15 component specs/);
  });
});
