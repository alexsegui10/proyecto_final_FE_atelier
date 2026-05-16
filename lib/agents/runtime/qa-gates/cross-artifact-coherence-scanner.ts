/**
 * cross-artifact-coherence-scanner — pure function that validates
 * invariants ACROSS multiple .atelier artifacts. These can't live as Zod
 * refinements because they cross schema boundaries.
 *
 * Three invariants checked in this version:
 *   1. Every `pageRoute` in `layout-tree.pages[]` exists in
 *      `architect` (publicRoutes ∪ privateRoutes ∪ adminRoutes ∪ "/sign-in"
 *      and "/sign-up" which are auth defaults).
 *   2. Every `pageRoute` in `stitch-analysis.pages[]` exists in
 *      `layout-tree.pages[]`.
 *   3. Every `consumedByFlow[]` entry in `test-id-contract.entries[]` is a
 *      valid Visual QA flow name.
 *
 * Designed to run as a postWaveGate of `wave-2-design` so failures block
 * downstream waves cheaply.
 */
import type { QaViolationV3 } from "../../orchestrator-v3";
import { expectArray } from "./_artifact-guard";

// ─── Input shapes (defensive — accept anything, narrow internally) ──

export interface ArchitectLike {
  features?: ReadonlyArray<{
    publicRoutes?: readonly string[];
    privateRoutes?: readonly string[];
    adminRoutes?: readonly string[];
  }>;
}

export interface LayoutTreeLike {
  pages: ReadonlyArray<{ pageRoute: string }>;
}

export interface StitchAnalysisLike {
  pages: ReadonlyArray<{ pageRoute: string }>;
}

export interface TestIdContractLike {
  entries: ReadonlyArray<{
    selector: string;
    consumedByFlow: readonly string[];
  }>;
}

export interface CoherenceInputs {
  architect: unknown;
  layoutTree: unknown;
  stitchAnalysis?: unknown;
  testIdContract?: unknown;
}

const VALID_FLOWS = new Set<string>(["client-anonymous", "client-authenticated", "admin"]);

// Auth pages that Bootstrap + Architect implicitly own; they're declared at
// the framework level even when architect.features doesn't list them.
const IMPLICIT_AUTH_ROUTES = new Set<string>(["/sign-in", "/sign-up"]);

// ─── Scanner ────────────────────────────────────────────────────────

export function scanCrossArtifactCoherence(input: CoherenceInputs): QaViolationV3[] {
  const violations: QaViolationV3[] = [];

  const layoutTree = input.layoutTree as LayoutTreeLike | undefined;
  const architect = input.architect as ArchitectLike | undefined;
  const stitchAnalysis = input.stitchAnalysis as StitchAnalysisLike | undefined;
  const testIdContract = input.testIdContract as TestIdContractLike | undefined;

  // Invariant 1: layout-tree.pages[] ⊆ architect routes
  if (layoutTree && architect) {
    const architectRoutes = collectArchitectRoutes(architect);
    const ltPages = expectArray<{ pageRoute: string }>(layoutTree.pages, {
      violations,
      rule: "layout-tree-malformed",
      agent: "layout-architect",
      file: ".atelier/layout-tree.json",
      field: "layoutTree.pages",
    });
    for (const page of ltPages) {
      if (
        !architectRoutes.has(page.pageRoute) &&
        !IMPLICIT_AUTH_ROUTES.has(page.pageRoute)
      ) {
        violations.push({
          rule: "layout-tree-orphan",
          severity: "error",
          agent: "architect",
          file: ".atelier/layout-tree.json",
          message: `Page '${page.pageRoute}' in layout-tree.json has no matching route in architect.json (publicRoutes ∪ privateRoutes ∪ adminRoutes).`,
          recommendedFix: `Either remove the page from layout-tree.pages[], or declare '${page.pageRoute}' under one of features[].publicRoutes / privateRoutes / adminRoutes in architect.json.`,
        });
      }
    }
  }

  // Invariant 2: stitch-analysis.pages[] ⊆ layout-tree.pages[]
  if (stitchAnalysis && layoutTree) {
    const ltPagesForRoutes = expectArray<{ pageRoute: string }>(layoutTree.pages, {
      violations,
      rule: "layout-tree-malformed",
      agent: "layout-architect",
      file: ".atelier/layout-tree.json",
      field: "layoutTree.pages",
    });
    const saPages = expectArray<{ pageRoute: string }>(stitchAnalysis.pages, {
      violations,
      rule: "stitch-analysis-malformed",
      agent: "layout-architect",
      file: ".atelier/stitch-analysis.json",
      field: "stitchAnalysis.pages",
    });
    const layoutRoutes = new Set(ltPagesForRoutes.map((p) => p.pageRoute));
    for (const page of saPages) {
      if (!layoutRoutes.has(page.pageRoute)) {
        violations.push({
          rule: "stitch-analysis-orphan",
          severity: "error",
          agent: "layout-architect",
          file: ".atelier/stitch-analysis.json",
          message: `Page '${page.pageRoute}' in stitch-analysis.json is not declared in layout-tree.pages[].`,
          recommendedFix: `Either add '${page.pageRoute}' to layout-tree.pages[] with explicit layoutGroup + rationale, or remove it from stitch-analysis (Layout Architect should not generate mockups for pages it didn't plan).`,
        });
      }
    }
  }

  // Invariant 3: test-id-contract.entries[].consumedByFlow ⊆ valid flow names
  if (testIdContract) {
    const ticEntries = expectArray<{ selector: string; consumedByFlow: readonly string[] }>(
      testIdContract.entries,
      {
        violations,
        rule: "test-id-contract-malformed",
        agent: "layout-architect",
        file: ".atelier/test-id-contract.json",
        field: "testIdContract.entries",
      },
    );
    for (const entry of ticEntries) {
      const flows = expectArray<string>(entry.consumedByFlow, {
        violations,
        rule: "test-id-contract-malformed",
        agent: "layout-architect",
        file: ".atelier/test-id-contract.json",
        field: `testIdContract.entries['${entry.selector}'].consumedByFlow`,
      });
      for (const flow of flows) {
        if (!VALID_FLOWS.has(flow)) {
          violations.push({
            rule: "test-id-invalid-flow",
            severity: "error",
            agent: "layout-architect",
            file: ".atelier/test-id-contract.json",
            message: `Test-id '${entry.selector}' declares consumedByFlow '${flow}', which is not a valid Visual QA flow (${[...VALID_FLOWS].join(" | ")}).`,
            recommendedFix: `Replace '${flow}' with one of: ${[...VALID_FLOWS].join(", ")}.`,
          });
        }
      }
    }
  }

  return violations;
}

function collectArchitectRoutes(architect: ArchitectLike): Set<string> {
  const out = new Set<string>();
  for (const f of architect.features ?? []) {
    for (const r of f.publicRoutes ?? []) out.add(r);
    for (const r of f.privateRoutes ?? []) out.add(r);
    for (const r of f.adminRoutes ?? []) out.add(r);
  }
  return out;
}
