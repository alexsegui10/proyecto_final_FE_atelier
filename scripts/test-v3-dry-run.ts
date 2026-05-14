/**
 * Atelier v3 — orchestrator dry-run.
 *
 * Validates that orchestrator-v3 recognises all 23 agents and walks through
 * the 10-slice wave graph end-to-end without invoking LLMs. Used as the
 * "v3 pipeline reconocido" gate before any real-LLM v3 run.
 *
 * What's tested:
 *   1. Every wave runs (10 wave.completed events).
 *   2. Every agent runs exactly once (23 agent.completed events).
 *   3. Bootstrap & DevOps fixture artifact passes `validateBootstrapOutput`.
 *   4. qa-reviewer "go" decision lets generation.completed fire.
 *
 * What's NOT tested here (out of scope — comes later in step 1/2):
 *   - Real LLM behaviour for any agent (no `claude` subprocess).
 *   - Schemas of the 5 unfinished v3 agents (layout-architect, brand-identity,
 *     animation-choreographer, accessibility, visual-qa). They're stubbed
 *     with a trivial fixture so the orchestrator can complete the walk.
 *   - File-system side effects (the fake runner reports no filesCreated).
 *
 * Usage:
 *   tsx scripts/test-v3-dry-run.ts
 */
import { resolve } from "node:path";

import {
  runGenerationV3,
  type AgentRunnerV3,
  type AgentRunInputV3,
  type AgentRunResultV3,
  type OrchestratorV3Event,
  type QaArtifactV3,
} from "../lib/agents/orchestrator-v3";
import { AGENT_NAMES_V3, type AgentNameV3 } from "../lib/agents/contracts-v3/agent-names";
import {
  validateBootstrapOutput,
  type BootstrapOutput,
} from "../lib/agents/contracts-v3/bootstrap.schema";
import {
  validateVisualQaReport,
  type VisualQaReport,
} from "../lib/agents/contracts-v3/visual-qa.schema";
import {
  validateLayoutTree,
  type LayoutTree,
} from "../lib/agents/contracts-v3/layout-tree.schema";
import {
  validateStitchAnalysis,
  type StitchAnalysis,
} from "../lib/agents/contracts-v3/stitch-analysis.schema";
import {
  validateTestIdContract,
  type TestIdContract,
} from "../lib/agents/contracts-v3/test-id-contract.schema";

// ─── Synthetic Bootstrap fixture (the only v3 agent with full schema today) ─

const BOOTSTRAP_FIXTURE: BootstrapOutput = {
  envManifest: {
    validatorPath: "src/_shared/config/env.ts",
    variables: [
      {
        name: "DATABASE_URL",
        required: true,
        description: "Postgres connection string used by Prisma",
        category: "database",
        sensitive: true,
        example: "postgresql://user:pass@localhost:5433/app",
        validation: "url",
        consumedBy: ["persistence", "seeds-fixtures"],
        producedBy: "src/_shared/config/env.ts",
      },
      {
        name: "AUTH_JWT_SECRET",
        required: true,
        description: "HMAC secret used to sign JWT access tokens",
        category: "auth",
        sensitive: true,
        example: "change-me-32-bytes-hex",
        validation: "non-empty-string",
        consumedBy: ["auth-security", "api-backend"],
        producedBy: "src/_shared/config/env.ts",
      },
      {
        name: "POSTGRES_HOST_PORT",
        required: false,
        defaultValue: "5433",
        description: "Host port mapped to the Postgres container 5432",
        category: "database",
        sensitive: false,
        consumedBy: ["bootstrap-devops"],
        producedBy: "src/_shared/config/env.ts",
      },
    ],
  },
  dockerServices: [
    {
      name: "postgres",
      image: "postgres:16-alpine",
      ports: ["${POSTGRES_HOST_PORT:-5433}:5432"],
      envVars: ["POSTGRES_HOST_PORT"],
      volumes: ["postgres_data:/var/lib/postgresql/data"],
      healthcheck: "pg_isready -U $POSTGRES_USER -d $POSTGRES_DB",
    },
  ],
  setupSteps: [
    { order: 1, description: "Start Postgres container", command: "docker compose up -d postgres", required: true, os: "all" },
    { order: 2, description: "Wait for Postgres healthcheck", command: "docker compose exec postgres pg_isready", required: true, os: "all" },
    { order: 3, description: "Apply Prisma migrations", command: "pnpm prisma migrate dev", required: true, os: "all" },
    { order: 4, description: "Seed demo data", command: "pnpm prisma:seed", required: false, os: "all" },
  ],
  checkEnvironmentRules: [
    {
      id: "postgres-reachable",
      description: "Postgres responds to TCP probe on DATABASE_URL host:port",
      detect: "Open TCP connection to host extracted from DATABASE_URL",
      whenFails: "Postgres is unreachable. Docker may be down or the port is blocked.",
      fixSuggestion: "Run `docker compose up -d postgres` OR set NEON_DATABASE_URL to use Neon serverless.",
    },
    {
      id: "jwt-secret-set",
      description: "AUTH_JWT_SECRET is at least 32 chars",
      detect: "process.env.AUTH_JWT_SECRET.length >= 32",
      whenFails: "AUTH_JWT_SECRET is missing or too short.",
      fixSuggestion: "Generate one with `openssl rand -hex 32` and paste in .env.local",
    },
  ],
  filesProduced: {
    envExample: ".env.example",
    envLocal: ".env.local",
    dockerCompose: "docker-compose.yml",
    setupPs1: "scripts/setup.ps1",
    setupSh: "scripts/setup.sh",
    readme: "README.md",
    checkEnvironment: "src/_shared/config/check-environment.ts",
    envValidator: "src/_shared/config/env.ts",
  },
  invariants: {
    singleSourceOfTruth: true,
    crossPlatformScripts: true,
    healthcheckPresent: true,
  },
};

// ─── Visual QA synthetic fixture (Wave 7 — schema-valid green report) ─

const VISUAL_QA_FIXTURE: VisualQaReport = {
  generatedAt: "2026-05-13T22:00:00.000Z",
  appUrl: "http://localhost:3000",
  setup: {
    setupCommand: "pnpm setup",
    setupDurationMs: 42_000,
    bootTimeMs: 6_500,
    healthcheckUrl: "http://localhost:3000/",
    healthcheckStatus: 200,
  },
  flows: [
    {
      flow: "client-anonymous",
      startedAt: "2026-05-13T22:00:30.000Z",
      durationMs: 4_200,
      stepsTotal: 5,
      stepsOk: 5,
      stepsFailed: 0,
      stepsSkipped: 0,
      decision: "go",
    },
    {
      flow: "client-authenticated",
      startedAt: "2026-05-13T22:00:35.000Z",
      durationMs: 8_400,
      stepsTotal: 6,
      stepsOk: 6,
      stepsFailed: 0,
      stepsSkipped: 0,
      decision: "go",
    },
    {
      flow: "admin",
      startedAt: "2026-05-13T22:00:45.000Z",
      durationMs: 7_100,
      stepsTotal: 6,
      stepsOk: 6,
      stepsFailed: 0,
      stepsSkipped: 0,
      decision: "go",
    },
  ],
  steps: [
    {
      flow: "client-anonymous",
      name: "open / and verify home renders",
      startedAt: "2026-05-13T22:00:30.500Z",
      durationMs: 800,
      status: "ok",
      screenshot: ".atelier/screenshots/client-anonymous-001-home.png",
    },
    {
      flow: "client-authenticated",
      name: "sign in as demo client",
      startedAt: "2026-05-13T22:00:35.500Z",
      durationMs: 1_200,
      status: "ok",
      screenshot: ".atelier/screenshots/client-authenticated-001-signin.png",
    },
    {
      flow: "admin",
      name: "sign in as admin and load /admin dashboard",
      startedAt: "2026-05-13T22:00:45.500Z",
      durationMs: 1_500,
      status: "ok",
      screenshot: ".atelier/screenshots/admin-001-dashboard.png",
    },
  ],
  screenshots: [],
  consoleEvents: [],
  networkEvents: [],
  violations: [],
  decision: "go",
  summary: "Dry-run synthetic visual-qa report — all 3 flows pass, no violations.",
  playwrightScriptPath: ".atelier/visual-qa-script.spec.ts",
};

// ─── Layout Architect fixtures (yoga-flavored, schema-valid) ─────────

const LAYOUT_TREE_FIXTURE: LayoutTree = {
  pages: [
    {
      pageRoute: "/",
      layoutGroup: "public",
      headerVariant: "full",
      footerVariant: "full",
      esQuestionable: false,
      rationale: "Public marketing landing with full header (logo + nav + Sign in CTA) and full footer.",
      breadcrumbs: false,
      requiresAuth: false,
    },
    {
      pageRoute: "/sign-in",
      layoutGroup: "public",
      headerVariant: "compact",
      footerVariant: "minimal",
      esQuestionable: false,
      rationale: "Auth-focused page; compact header to reduce distraction.",
      breadcrumbs: false,
      requiresAuth: false,
    },
    {
      pageRoute: "/shop",
      layoutGroup: "public",
      headerVariant: "full",
      footerVariant: "full",
      esQuestionable: false,
      rationale: "Public class catalogue; same layout as home so navigation is consistent.",
      breadcrumbs: false,
      requiresAuth: false,
    },
    {
      pageRoute: "/my/classes",
      layoutGroup: "dashboard",
      headerVariant: "compact",
      footerVariant: "hidden",
      esQuestionable: false,
      rationale: "Authenticated student view; dashboard sidebar + compact header.",
      breadcrumbs: true,
      requiresAuth: true,
    },
    {
      pageRoute: "/admin/classes",
      layoutGroup: "admin",
      headerVariant: "compact",
      footerVariant: "hidden",
      esQuestionable: false,
      rationale: "Admin CRUD; admin sidebar + breadcrumbs.",
      breadcrumbs: true,
      requiresAuth: true,
    },
  ],
  navigationItems: [
    { label: "Atelier Yoga", href: "/", showOnGroups: ["public", "dashboard", "admin"], cta: false, testId: "nav-logo" },
    { label: "Shop", href: "/shop", showOnGroups: ["public"], cta: false, testId: "nav-shop" },
    { label: "Sign in", href: "/sign-in", showOnGroups: ["public"], cta: true, testId: "nav-signin" },
    { label: "My classes", href: "/my/classes", showOnGroups: ["dashboard"], cta: false, testId: "nav-my-classes" },
    { label: "Sign out", href: "/sign-in", showOnGroups: ["dashboard", "admin"], cta: false, testId: "nav-signout" },
  ],
  defaultHeaderVariant: "full",
  layoutCompositions: {
    public: { slots: ["header", "main", "footer"], sidebarPosition: "none" },
    dashboard: { slots: ["header", "sidebar", "main", "breadcrumbs"], sidebarPosition: "left" },
    admin: { slots: ["header", "sidebar", "main", "breadcrumbs"], sidebarPosition: "left" },
  },
};

const STITCH_ANALYSIS_FIXTURE: StitchAnalysis = {
  generatedAt: "2026-05-14T09:00:00.000Z",
  stitchProjectId: "stitch-yoga-001",
  designVibe: "Calm",
  // Yoga-coherent salvia greens (not greys) per user request.
  colorTokens: [
    { role: "primary", value: "#4a7c59", hint: "salvia" },
    { role: "background", value: "#fafaf7", hint: "warm-off-white" },
    { role: "foreground", value: "#1f1f1f", hint: "near-black" },
    { role: "muted", value: "#e8e8e3", hint: "soft-stone" },
    { role: "border", value: "#d4d4cf", hint: "stone-200" },
    { role: "accent", value: "#c39b6d", hint: "amber-warm" },
  ],
  typographyTokens: [
    { role: "heading-1", family: "Inter, system-ui, sans-serif", sizePx: 48, weight: 700, lineHeightPx: 56 },
    { role: "heading-2", family: "Inter, system-ui, sans-serif", sizePx: 32, weight: 600, lineHeightPx: 40 },
    { role: "body", family: "Inter, system-ui, sans-serif", sizePx: 16, weight: 400, lineHeightPx: 24 },
    { role: "caption", family: "Inter, system-ui, sans-serif", sizePx: 13, weight: 400 },
  ],
  pages: [
    {
      pageRoute: "/",
      mockupPath: ".atelier/stitch-mockups/home.png",
      stitchScreenId: "scr-yoga-home",
      // Hero (stack) + feature grid (3 cols) + footer (stack)
      rootSection: {
        id: "home-root",
        purpose: "page-root",
        layoutPrimitive: "stack",
        gapPx: 96,
        paddingPx: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          {
            id: "hero",
            purpose: "hero",
            layoutPrimitive: "stack",
            gapPx: 24,
            paddingPx: { top: 96, right: 24, bottom: 96, left: 24 },
          },
          {
            id: "features",
            purpose: "feature-grid",
            layoutPrimitive: "grid",
            columns: 3,
            gapPx: 32,
            paddingPx: { top: 64, right: 24, bottom: 64, left: 24 },
          },
          {
            id: "footer",
            purpose: "footer",
            layoutPrimitive: "stack",
            gapPx: 16,
            paddingPx: { top: 48, right: 24, bottom: 48, left: 24 },
          },
        ],
      },
    },
    {
      pageRoute: "/shop",
      mockupPath: ".atelier/stitch-mockups/shop.png",
      stitchScreenId: "scr-yoga-shop",
      rootSection: {
        id: "shop-root",
        purpose: "page-root",
        layoutPrimitive: "stack",
        gapPx: 32,
        children: [
          {
            id: "shop-grid",
            purpose: "catalogue-grid",
            layoutPrimitive: "grid",
            columns: 3,
            gapPx: 24,
          },
        ],
      },
    },
  ],
  designMdPath: ".atelier/stitch-design.md",
};

const TEST_ID_CONTRACT_FIXTURE: TestIdContract = {
  generatedAt: "2026-05-14T09:00:00.000Z",
  entries: [
    {
      selector: "header-root",
      purpose: "Root <header> rendered by every layout group",
      requiredOn: { layoutGroup: "public" },
      criticality: "critical",
      consumedByFlow: ["client-anonymous", "client-authenticated", "admin"],
    },
    {
      selector: "nav-primary",
      purpose: "Primary navigation list inside the header",
      requiredOn: { layoutGroup: "public" },
      criticality: "critical",
      consumedByFlow: ["client-anonymous"],
    },
    {
      selector: "signin-form",
      purpose: "Sign-in form root element on /sign-in",
      requiredOn: { component: "SignInForm" },
      criticality: "critical",
      consumedByFlow: ["client-anonymous", "client-authenticated"],
    },
    {
      selector: "signup-form",
      purpose: "Sign-up form root element on /sign-up",
      requiredOn: { component: "SignUpForm" },
      criticality: "critical",
      consumedByFlow: ["client-anonymous"],
    },
    {
      selector: "signout-button",
      purpose: "Sign-out CTA in authenticated layouts",
      requiredOn: { layoutGroup: "dashboard" },
      criticality: "critical",
      consumedByFlow: ["client-authenticated", "admin"],
    },
    {
      selector: "admin-create-class",
      purpose: "Create button on /admin/classes",
      requiredOn: { component: "AdminCreateButton" },
      criticality: "critical",
      consumedByFlow: ["admin"],
    },
    {
      selector: "public-list-root",
      purpose: "Root container of the public catalogue listing on /shop",
      requiredOn: { component: "ShopGrid" },
      criticality: "critical",
      consumedByFlow: ["client-anonymous"],
    },
    {
      selector: "hero-cta",
      purpose: "Hero CTA on the home page (entry point of the main flow)",
      requiredOn: { component: "HomeHero" },
      criticality: "recommended",
      consumedByFlow: ["client-anonymous"],
    },
  ],
};

// ─── Fake runner — synthesises an artifact per agent ────────────────

function fakeArtifactFor(agent: AgentNameV3): unknown {
  if (agent === "bootstrap-devops") return BOOTSTRAP_FIXTURE;
  if (agent === "visual-qa") return VISUAL_QA_FIXTURE;
  if (agent === "layout-architect") {
    // Layout Architect produces 3 separate artifacts; we surface them as
    // a single bag of artifacts. The orchestrator's `artifacts` map stores
    // the primary one per agent name; the other two are accessible via the
    // workDir on disk in a real run. For the dry-run, we expose all 3.
    return {
      layoutTree: LAYOUT_TREE_FIXTURE,
      stitchAnalysis: STITCH_ANALYSIS_FIXTURE,
      testIdContract: TEST_ID_CONTRACT_FIXTURE,
    };
  }
  if (agent === "qa-reviewer") {
    return {
      decision: "go",
      violations: [],
      summary: "Dry-run synthetic qa-report (all gates skipped).",
    } satisfies QaArtifactV3;
  }
  return { agent, synthetic: true };
}

function makeFakeRunnerV3(): AgentRunnerV3 {
  return async (input: AgentRunInputV3): Promise<AgentRunResultV3> => ({
    artifact: fakeArtifactFor(input.agent),
    filesCreated: [],
    summary: `${input.agent.toUpperCase()}_DONE (dry-run)`,
  });
}

// ─── Pretty console logger ──────────────────────────────────────────

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(stage: string, msg: string): void {
  console.log(`[${ts()}] [${stage}] ${msg}`);
}

function describeEvent(e: OrchestratorV3Event): { stage: string; msg: string } | null {
  switch (e.type) {
    case "generation.started":
      return { stage: "orchestrator", msg: `▶ generation.started id=${e.generationId}` };
    case "generation.completed":
      return { stage: "orchestrator", msg: `✓ generation.completed — ${e.summary}` };
    case "generation.failed":
      return { stage: "orchestrator", msg: `✗ generation.failed — ${e.reason}` };
    case "wave.started":
      return { stage: "wave", msg: `▶ ${e.wave} — agents: [${e.agents.join(", ")}]` };
    case "wave.completed":
      return { stage: "wave", msg: `✓ ${e.wave} (${(e.durationMs / 1000).toFixed(2)}s) — ${e.results.map((r) => `${r.agent}:${r.status}`).join(" ")}` };
    case "agent.started":
      return { stage: e.agent, msg: `▶ started (${e.wave})` };
    case "agent.completed":
      return { stage: e.agent, msg: `✓ ${e.summary}` };
    case "agent.failed":
      return { stage: e.agent, msg: `✗ ${e.reason}` };
    case "agent.file_created":
      return { stage: e.agent, msg: `  + ${e.path} (${e.lines} lines)` };
    default:
      return null;
  }
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<number> {
  log("init", "v3 dry-run: orchestrator-v3 + fake runner");
  log("init", `agent count expected: ${AGENT_NAMES_V3.length}`);

  // Pre-flight: validate the Bootstrap fixture against the schema.
  const bootstrapErr = validateBootstrapOutput(BOOTSTRAP_FIXTURE);
  if (bootstrapErr) {
    log("init", `✗ bootstrap fixture fails schema: ${bootstrapErr}`);
    return 2;
  }
  log("init", "✓ bootstrap fixture passes validateBootstrapOutput");

  const events: OrchestratorV3Event[] = [];
  const runner = makeFakeRunnerV3();

  const start = Date.now();
  const result = await runGenerationV3({
    generationId: `v3-dryrun-${Date.now()}`,
    prd: { domain: "synthetic", roles: ["admin"], entities: [], useCases: [] },
    workDir: resolve(__dirname, "..", "out", "v3-dryrun-tmp"),
    runner,
    emit: async (e) => {
      events.push(e);
      const d = describeEvent(e);
      if (d) log(d.stage, d.msg);
    },
  });
  const durationMs = Date.now() - start;

  // ─── Invariants ────────────────────────────────────────────────────

  const failures: string[] = [];

  const waveCompletedCount = events.filter((e) => e.type === "wave.completed").length;
  if (waveCompletedCount !== 10) {
    failures.push(`expected 10 wave.completed events, got ${waveCompletedCount}`);
  }

  const agentCompletedCount = events.filter((e) => e.type === "agent.completed").length;
  if (agentCompletedCount !== AGENT_NAMES_V3.length) {
    failures.push(
      `expected ${AGENT_NAMES_V3.length} agent.completed events, got ${agentCompletedCount}`,
    );
  }

  if (result.failedAt) {
    failures.push(`unexpected failedAt: wave=${result.failedAt.wave} agent=${result.failedAt.agent}`);
  }

  if (result.qa?.decision !== "go") {
    failures.push(`qa.decision should be "go", got ${result.qa?.decision ?? "null"}`);
  }

  // Every agent should appear in artifacts.
  for (const agent of AGENT_NAMES_V3) {
    if (!(agent in result.artifacts)) {
      failures.push(`artifact missing for agent: ${agent}`);
    }
  }

  // Specifically: bootstrap-devops artifact must still validate.
  const bootstrapArtifact = result.artifacts["bootstrap-devops"];
  const bootErr = validateBootstrapOutput(bootstrapArtifact);
  if (bootErr) {
    failures.push(`bootstrap-devops artifact in result.artifacts fails schema: ${bootErr}`);
  }

  // visual-qa artifact must also validate (new in step 3).
  const visualQaArtifact = result.artifacts["visual-qa"];
  const visualQaErr = validateVisualQaReport(visualQaArtifact);
  if (visualQaErr) {
    failures.push(`visual-qa artifact in result.artifacts fails schema: ${visualQaErr}`);
  }

  // layout-architect produces 3 artifacts; validate each (new in step 5).
  const layoutBundle = result.artifacts["layout-architect"] as
    | { layoutTree?: unknown; stitchAnalysis?: unknown; testIdContract?: unknown }
    | undefined;
  if (!layoutBundle) {
    failures.push(`layout-architect artifact missing from result.artifacts`);
  } else {
    const ltErr = validateLayoutTree(layoutBundle.layoutTree);
    if (ltErr) failures.push(`layout-tree.json fails schema: ${ltErr}`);
    const saErr = validateStitchAnalysis(layoutBundle.stitchAnalysis);
    if (saErr) failures.push(`stitch-analysis.json fails schema: ${saErr}`);
    const tcErr = validateTestIdContract(layoutBundle.testIdContract);
    if (tcErr) failures.push(`test-id-contract.json fails schema: ${tcErr}`);
  }

  log(
    "done",
    failures.length === 0
      ? `▣ v3 DRY-RUN GREEN — ${agentCompletedCount}/23 agents, ${waveCompletedCount}/10 waves, ${durationMs}ms`
      : `▣ v3 DRY-RUN FAIL — ${failures.length} invariant(s) violated`,
  );

  if (failures.length > 0) {
    for (const f of failures) log("fail", `✗ ${f}`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(99);
  },
);
