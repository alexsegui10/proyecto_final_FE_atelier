/**
 * Camino 3 helper. Copies a generated workDir into out/demo-cache/yoga/workDir/
 * (sources only, no node_modules) and synthesizes a fresh events.json whose
 * agent.file_created events reference files that actually exist on disk.
 *
 * Usage:
 *   pnpm tsx scripts/rebuild-demo-cache.ts <sourceWorkDir> <demoSlug>
 *   pnpm tsx scripts/rebuild-demo-cache.ts /c/Users/alexs/AppData/Local/Temp/atelier-gen-GeSa5I yoga
 */
import { readFile, writeFile, mkdir, rm, readdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

type EventOut = { offsetMs: number; type: string; payload: Record<string, unknown> };

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".atelier",
  "dist",
  "build",
  ".turbo",
  "coverage",
  ".cache",
  ".vitest-temp",
]);

async function walk(root: string, relPath = ""): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(join(root, relPath), { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const childRel = relPath ? `${relPath}${sep}${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await walk(root, childRel)));
    } else if (entry.isFile()) {
      out.push(childRel.replace(/\\/g, "/"));
    }
  }
  return out;
}

function classifyAgent(path: string): "architect" | "domain-persistence" | "use-cases" | "auth-rbac" | "api-frontend" {
  const p = path.toLowerCase();
  if (p === "readme.md") return "architect";
  if (p === "package.json" || p === "pnpm-lock.yaml") return "architect";
  if (p === "tsconfig.json" || p.startsWith("tsconfig.")) return "architect";
  if (p === ".gitignore" || p === ".env.example") return "architect";
  if (p.startsWith("eslint.config") || p.startsWith(".eslintrc")) return "architect";
  if (p.startsWith("vitest.config") || p.startsWith("playwright.config")) return "architect";
  if (p.startsWith("tailwind.config") || p.startsWith("postcss.config")) return "architect";
  if (p.startsWith("next.config")) return "architect";
  if (p.startsWith(".dependency-cruiser") || p.includes("dependency-cruiser")) return "architect";

  // auth feature owns the whole auth folder + auth tests
  if (p.startsWith("src/auth/")) return "auth-rbac";
  if (p === "proxy.ts" || p === "middleware.ts") return "auth-rbac";

  // prisma
  if (p === "prisma/schema.prisma" || p.startsWith("prisma/")) return "domain-persistence";

  // shared infra (db client, slug utils, errors)
  if (p.startsWith("src/_shared/domain/")) return "domain-persistence";
  if (p.startsWith("src/_shared/infrastructure/db/")) return "domain-persistence";
  if (p.startsWith("src/_shared/utils/")) return "domain-persistence";

  // Per-feature domain + infrastructure (entities, repositories, mappers, dtos)
  if (/^src\/[a-z-]+\/(domain|infrastructure)\//.test(p)) return "domain-persistence";

  // Per-feature application service tests
  if (/^src\/[a-z-]+\/application\/service\//.test(p)) return "use-cases";

  // shared application (transaction wrapper if any)
  if (p.startsWith("src/_shared/application/")) return "use-cases";

  // Frontend territory
  if (p.startsWith("src/components/")) return "api-frontend";
  if (p.startsWith("src/context/")) return "api-frontend";
  if (p.startsWith("src/hooks/")) return "api-frontend";
  if (p.startsWith("src/services/")) return "api-frontend";
  if (p.startsWith("src/pages/")) return "api-frontend";
  if (p.startsWith("src/types/")) return "api-frontend";
  if (p.startsWith("src/constants/")) return "api-frontend";
  if (p.startsWith("src/_shared/presentation/")) return "api-frontend";
  // Per-feature presentation (controllers, routers, requests, responses)
  if (/^src\/[a-z-]+\/presentation\//.test(p)) return "api-frontend";
  // Next.js app/ tree
  if (p.startsWith("app/")) return "api-frontend";
  if (p.startsWith("public/")) return "api-frontend";
  if (p === "src/lib/utils.ts" || p.startsWith("lib/")) return "api-frontend";

  return "api-frontend";
}

async function countLines(absPath: string): Promise<number> {
  try {
    const buf = await readFile(absPath, "utf-8");
    return buf.split("\n").length;
  } catch {
    return 0;
  }
}

async function main() {
  const [, , srcArg, slugArg] = process.argv;
  if (!srcArg || !slugArg) {
    console.error("usage: rebuild-demo-cache <sourceWorkDir> <demoSlug>");
    process.exit(2);
  }
  const src = resolve(srcArg);
  const slug = slugArg;
  const repoRoot = resolve(__dirname, "..");
  const destWorkDir = join(repoRoot, "out", "demo-cache", slug, "workDir");
  const eventsPath = join(repoRoot, "out", "demo-cache", slug, "events.json");

  if (!existsSync(src)) {
    console.error(`source not found: ${src}`);
    process.exit(1);
  }

  // 1. Wipe + copy source files only.
  if (existsSync(destWorkDir)) {
    await rm(destWorkDir, { recursive: true, force: true });
  }
  await mkdir(destWorkDir, { recursive: true });

  const files = await walk(src);
  console.log(`Found ${files.length} files to copy`);
  for (const rel of files) {
    const absSrc = join(src, rel);
    const absDest = join(destWorkDir, rel);
    await mkdir(join(absDest, ".."), { recursive: true });
    await cp(absSrc, absDest);
  }

  // 2. Build events.json.
  // Demo total duration: snappy 2.6 min so the cinematic Reveal pacing feels right
  // at speed=4. Real run was ~50 min, but that's not a watchable demo.
  const TOTAL_MS = 2600_000;
  const SPANS = {
    architect: { start: 0, end: 0.18 },
    "domain-persistence": { start: 0.18, end: 0.34 },
    "use-cases": { start: 0.34, end: 0.55 },
    "auth-rbac": { start: 0.34, end: 0.55 },
    "api-frontend": { start: 0.55, end: 0.92 },
    "qa-reviewer": { start: 0.92, end: 1.0 },
  } as const;

  type Agent = keyof typeof SPANS;
  const byAgent: Record<Agent, string[]> = {
    architect: [],
    "domain-persistence": [],
    "use-cases": [],
    "auth-rbac": [],
    "api-frontend": [],
    "qa-reviewer": [],
  };
  for (const f of files) {
    byAgent[classifyAgent(f)].push(f);
  }

  // Stable sort each bucket so the demo is deterministic.
  for (const a of Object.keys(byAgent) as Agent[]) {
    byAgent[a].sort();
  }

  const events: EventOut[] = [];
  events.push({ offsetMs: 0, type: "generation.started", payload: {} });

  const phaseOrder: Array<Agent | Agent[]> = [
    "architect",
    "domain-persistence",
    ["use-cases", "auth-rbac"],
    "api-frontend",
    "qa-reviewer",
  ];

  let lastPhaseEnd: Agent = "architect";

  for (const phase of phaseOrder) {
    const agentsInPhase = Array.isArray(phase) ? phase : [phase];
    for (const agent of agentsInPhase) {
      const span = SPANS[agent];
      const startMs = Math.round(span.start * TOTAL_MS);
      const endMs = Math.round(span.end * TOTAL_MS);
      events.push({ offsetMs: startMs, type: "agent.started", payload: { agent } });
      const fs = byAgent[agent];
      if (fs.length === 0) {
        events.push({
          offsetMs: endMs,
          type: "agent.completed",
          payload: { agent, summary: `${agent.toUpperCase().replace("-", "_")}_DONE: 0 files` },
        });
        continue;
      }
      const stepMs = (endMs - startMs) / Math.max(1, fs.length);
      let i = 0;
      for (const rel of fs) {
        const absDest = join(destWorkDir, rel);
        const lines = await countLines(absDest);
        const offsetMs = Math.round(startMs + stepMs * (i + 1));
        events.push({
          offsetMs,
          type: "agent.file_created",
          payload: { agent, path: rel, lines },
        });
        i += 1;
      }
      events.push({
        offsetMs: endMs,
        type: "agent.completed",
        payload: {
          agent,
          summary: `${agent.toUpperCase().replace("-", "_")}_DONE: ${fs.length} files`,
        },
      });
    }
    if (Array.isArray(phase)) {
      events.push({
        offsetMs: Math.round(SPANS[phase[phase.length - 1]].end * TOTAL_MS),
        type: "agent.handoff",
        payload: { from: phase.join("+"), to: "api-frontend" },
      });
    } else if (phase !== "qa-reviewer") {
      const next = phaseOrder[phaseOrder.indexOf(phase) + 1];
      const to = Array.isArray(next) ? next.join("+") : next;
      events.push({
        offsetMs: Math.round(SPANS[phase].end * TOTAL_MS),
        type: "agent.handoff",
        payload: { from: phase, to },
      });
    }
    if (!Array.isArray(phase)) lastPhaseEnd = phase;
  }
  void lastPhaseEnd;

  events.push({
    offsetMs: TOTAL_MS,
    type: "generation.completed",
    payload: { decision: "go", filesGenerated: files.length },
  });

  // Sort events by offsetMs (parallel phase emits interleaved).
  events.sort((a, b) => a.offsetMs - b.offsetMs);

  const cache = {
    fixturePath: "fixtures/yoga-prd.json",
    summary:
      "App de gestión de un estudio de yoga: alumno reserva clases, profesor consulta agenda, admin gestiona membresías y usuarios.",
    decision: "go",
    totalDurationMs: TOTAL_MS,
    filesGenerated: files.length,
    events,
  };
  await writeFile(eventsPath, JSON.stringify(cache, null, 2), "utf-8");
  console.log(
    `Wrote ${eventsPath} (${events.length} events, ${files.length} files)`,
  );

  // Quick sanity: agents share of files.
  for (const agent of Object.keys(byAgent) as Agent[]) {
    console.log(`  ${agent.padEnd(20)} ${String(byAgent[agent].length).padStart(4)} files`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
