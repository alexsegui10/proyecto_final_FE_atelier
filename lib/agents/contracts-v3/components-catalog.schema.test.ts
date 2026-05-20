import { describe, it, expect } from "vitest";

import {
  validateComponentsCatalogV3,
  type ComponentsCatalogV3,
} from "./components-catalog.schema";
import { REQUIRED_PRIMITIVES } from "../contracts-v2/components-catalog.schema";

// ─── Fixture builders ──────────────────────────────────────────────

/**
 * Canonical happy-path shape: 22 primitives (5 skeleton + 17 generated),
 * `name` is the lowercase kebab-case file basename — what the schema's
 * REQUIRED_PRIMITIVES refinement checks against.
 */
function happyCatalog(): ComponentsCatalogV3 {
  return {
    primitives: [
      { name: "button", file: "client/components/ui/button.tsx", source: "skeleton" },
      { name: "card", file: "client/components/ui/card.tsx", source: "skeleton" },
      { name: "input", file: "client/components/ui/input.tsx", source: "skeleton" },
      { name: "label", file: "client/components/ui/label.tsx", source: "skeleton" },
      { name: "badge", file: "client/components/ui/badge.tsx", source: "skeleton" },
      ...REQUIRED_PRIMITIVES.map((p) => ({
        name: p,
        file: `client/components/ui/${p}.tsx`,
        source: "generated" as const,
      })),
    ],
    components: [],
  };
}

// ─── Happy path ─────────────────────────────────────────────────────

describe("componentsCatalogV3Schema — happy path", () => {
  it("accepts canonical 22-primitive lowercase shape", () => {
    expect(validateComponentsCatalogV3(happyCatalog())).toBeNull();
  });

  it("accepts flat-string primitive entries (schema allows either form)", () => {
    const catalog: ComponentsCatalogV3 = {
      primitives: ["button", "card", "input", "label", "badge", ...REQUIRED_PRIMITIVES],
      components: [],
    };
    expect(validateComponentsCatalogV3(catalog)).toBeNull();
  });

  it("accepts a missing `components` field (defaults to [])", () => {
    const catalog = {
      primitives: [
        ...REQUIRED_PRIMITIVES.map((p) => ({ name: p })),
        "button",
        "card",
        "input",
        "label",
        "badge",
      ],
    };
    expect(validateComponentsCatalogV3(catalog)).toBeNull();
  });
});

// ─── B-w4-14 — PascalCase regression (run-19 root cause) ────────────
//
// F3-run-19 (`out/yoga-regen-v3-2026-05-20T11-36-24`) emitted all 22
// primitives but with `"name": "Button"` PascalCase (React component
// name) instead of `"name": "button"` lowercase kebab-case (file
// basename). The schema's REQUIRED_PRIMITIVES is a list of basenames,
// so `list.map(p => p.name).includes("dialog")` returned false for
// every required entry. Boundary validator B-w4-5b failed the agent
// with `must include all 17 primitives: dialog, dropdown-menu, ...`.
// The prompt pin (B-w4-14) eliminates the ambiguity upstream; these
// tests pin the rejection downstream as defense in depth.

describe("componentsCatalogV3Schema — B-w4-14 rejections (FLAG C)", () => {
  /**
   * Exact shape from run-19: 22 primitives, all PascalCase `name`s.
   * The schema refinement must reject with the canonical message that
   * lists all 17 expected kebab-case basenames.
   */
  function run19PascalCaseShape(): unknown {
    return {
      primitives: [
        { name: "Button", file: "client/components/ui/button.tsx", source: "skeleton" },
        { name: "Card", file: "client/components/ui/card.tsx", source: "skeleton" },
        { name: "Input", file: "client/components/ui/input.tsx", source: "skeleton" },
        { name: "Label", file: "client/components/ui/label.tsx", source: "skeleton" },
        { name: "Badge", file: "client/components/ui/badge.tsx", source: "skeleton" },
        { name: "Dialog", file: "client/components/ui/dialog.tsx", source: "generated" },
        { name: "DropdownMenu", file: "client/components/ui/dropdown-menu.tsx", source: "generated" },
        { name: "Form", file: "client/components/ui/form.tsx", source: "generated" },
        { name: "Select", file: "client/components/ui/select.tsx", source: "generated" },
        { name: "Table", file: "client/components/ui/table.tsx", source: "generated" },
        { name: "Tabs", file: "client/components/ui/tabs.tsx", source: "generated" },
        { name: "Toast", file: "client/components/ui/toast.tsx", source: "generated" },
        { name: "Separator", file: "client/components/ui/separator.tsx", source: "generated" },
        { name: "Sheet", file: "client/components/ui/sheet.tsx", source: "generated" },
        { name: "Skeleton", file: "client/components/ui/skeleton.tsx", source: "generated" },
        { name: "Alert", file: "client/components/ui/alert.tsx", source: "generated" },
        { name: "Avatar", file: "client/components/ui/avatar.tsx", source: "generated" },
        { name: "Popover", file: "client/components/ui/popover.tsx", source: "generated" },
        { name: "Tooltip", file: "client/components/ui/tooltip.tsx", source: "generated" },
        { name: "Command", file: "client/components/ui/command.tsx", source: "generated" },
        { name: "Calendar", file: "client/components/ui/calendar.tsx", source: "generated" },
        { name: "Checkbox", file: "client/components/ui/checkbox.tsx", source: "generated" },
      ],
      components: [],
    };
  }

  it("rejects the run-19 PascalCase shape with the canonical 17-primitive message", () => {
    const result = validateComponentsCatalogV3(run19PascalCaseShape());
    expect(result).not.toBeNull();
    expect(result).toMatch(/must include all 17 primitives/);
    // Sample of required basenames must appear in the error so operators
    // can see exactly which lowercase names were expected.
    expect(result).toMatch(/dialog/);
    expect(result).toMatch(/dropdown-menu/);
    expect(result).toMatch(/checkbox/);
  });

  it("rejects a subset that drops a single required primitive (B-w4-14 broad protection)", () => {
    const broken = happyCatalog();
    // Drop 'dialog' from the canonical list (simulate any single-missing case).
    broken.primitives = broken.primitives.filter(
      (p) => (typeof p === "string" ? p : p.name) !== "dialog",
    );
    const result = validateComponentsCatalogV3(broken);
    expect(result).not.toBeNull();
    expect(result).toMatch(/must include all 17 primitives/);
  });

  it("rejects a primitive name with .tsx extension (must be basename without ext)", () => {
    const broken = happyCatalog();
    // Replace the dialog entry's name with the extension-included form.
    const idx = broken.primitives.findIndex(
      (p) => (typeof p === "string" ? p : p.name) === "dialog",
    );
    broken.primitives[idx] = {
      name: "dialog.tsx",
      file: "client/components/ui/dialog.tsx",
      source: "generated",
    };
    const result = validateComponentsCatalogV3(broken);
    expect(result).not.toBeNull();
    expect(result).toMatch(/must include all 17 primitives/);
  });
});
