/**
 * pnpm tsx scripts/test-agents.ts [path/to/prd.json]
 *
 * End-to-end smoke for the 6 generator agents. Loads a PRD fixture, copies
 * the skeleton into a temp dir, runs the orchestrator with a console emitter,
 * then runs `pnpm qa` in the generated app and prints a final report.
 *
 * Exit codes:
 *   0 — all 4 QA gates passed AND the QA agent's decision is "go"
 *   1 — anything else (orchestrator failure, missing artifact, QA red, etc.)
 */
import { cp, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runGeneration, type OrchestratorEvent } from "../lib/agents/orchestrator";
import type { PRD } from "../lib/agents/shared-state";

type GateResult = {
  name: "typecheck" | "lint" | "deps:check" | "test";
  status: "pass" | "fail";
  exitCode: number;
  stdout: string;
  stderr: string;
};

function runGate(
  workDir: string,
  name: GateResult["name"],
  scriptName: string,
): GateResult {
  const result = spawnSync("pnpm", ["run", scriptName], {
    cwd: workDir,
    encoding: "utf-8",
    shell: process.platform === "win32",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  return {
    name,
    status: result.status === 0 ? "pass" : "fail",
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function fmtEvent(event: OrchestratorEvent): string {
  const ts = new Date().toISOString().slice(11, 19);
  switch (event.type) {
    case "generation.started":
      return `[${ts}] gen ${event.generationId} START`;
    case "generation.completed":
      return `[${ts}] gen ${event.generationId} DONE: ${event.summary}`;
    case "generation.failed":
      return `[${ts}] gen ${event.generationId} FAIL: ${event.reason}`;
    case "agent.started":
      return `[${ts}]   ${event.agent} STARTED`;
    case "agent.stdout":
      // Skip noisy stdout chunks in the script log; they go to the SSE in production.
      return "";
    case "agent.completed":
      return `[${ts}]   ${event.agent} COMPLETED — ${event.summary}`;
    case "agent.failed":
      return `[${ts}]   ${event.agent} FAILED — ${event.reason}`;
    case "agent.handoff":
      return `[${ts}]   handoff: ${event.from} → ${event.to}`;
    case "agent.file_created":
      return `[${ts}]     + ${event.path} (${event.lines} lines)`;
    case "qa.fix_round":
      return `[${ts}] >>> FIX ROUND ${event.round}/${event.maxRounds} — ${event.violations} violations to address`;
    case "agent.fix_started":
      return `[${ts}]   ${event.agent} FIX-START round=${event.round} (${event.violations} violations)`;
    case "agent.fix_completed":
      return `[${ts}]   ${event.agent} FIX-DONE round=${event.round}`;
  }
}

async function main(): Promise<number> {
  const root = resolve(__dirname, "..");
  const prdPath = resolve(process.argv[2] ?? join(root, "fixtures", "yoga-prd.json"));
  const skeletonDir = join(root, "lib", "skeleton");
  const promptsDir = join(root, "lib", "agents", "prompts");

  console.log(`[test-agents] PRD fixture: ${prdPath}`);
  const prd = JSON.parse(await readFile(prdPath, "utf-8")) as PRD;

  const workDir = await mkdtemp(join(tmpdir(), "atelier-gen-"));
  console.log(`[test-agents] workDir: ${workDir}`);

  console.log(`[test-agents] copying skeleton…`);
  await cp(skeletonDir, workDir, { recursive: true });
  await rename(
    join(workDir, "env.example.template"),
    join(workDir, ".env.example"),
  ).catch(() => undefined);
  await rename(
    join(workDir, "gitignore.template"),
    join(workDir, ".gitignore"),
  ).catch(() => undefined);
  // Drop a placeholder .env.local so prisma generate doesn't complain.
  await writeFile(
    join(workDir, ".env"),
    `DATABASE_URL="postgresql://user:password@localhost:5432/atelier_app?schema=public"\nBETTER_AUTH_SECRET="test-secret"\nBETTER_AUTH_URL="http://localhost:3000"\n`,
  );

  console.log(`[test-agents] pnpm install (this can take 20-30s)…`);
  const installResult = spawnSync("pnpm", ["install"], {
    cwd: workDir,
    encoding: "utf-8",
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (installResult.status !== 0) {
    console.error(`[test-agents] pnpm install failed (${installResult.status})`);
    return 1;
  }

  console.log(`[test-agents] prisma generate…`);
  const generateResult = spawnSync("pnpm", ["exec", "prisma", "generate"], {
    cwd: workDir,
    encoding: "utf-8",
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (generateResult.status !== 0) {
    console.error(`[test-agents] prisma generate failed`);
    return 1;
  }

  console.log(`\n[test-agents] launching orchestrator…\n`);

  const result = await runGeneration({
    generationId: "smoke-" + Date.now().toString(36),
    projectId: "smoke",
    prd,
    workDir,
    promptsDir,
    onEvent: (event) => {
      const line = fmtEvent(event);
      if (line) console.log(line);
    },
  });

  console.log(`\n[test-agents] orchestrator finished in ${(result.durationMs / 1000).toFixed(1)}s`);
  if (result.failedAt) {
    console.error(`[test-agents] FAILED at agent: ${result.failedAt}`);
    console.error(`[test-agents] workDir for inspection: ${workDir}`);
    return 1;
  }

  console.log(`[test-agents] running 4 QA gates against generated app…\n`);
  const gates: GateResult[] = [
    runGate(workDir, "typecheck", "typecheck"),
    runGate(workDir, "lint", "lint"),
    runGate(workDir, "deps:check", "deps:check"),
    runGate(workDir, "test", "test"),
  ];

  console.log("\n=== QA gate results ===");
  for (const gate of gates) {
    console.log(`  ${gate.name.padEnd(12)} ${gate.status.toUpperCase()} (exit ${gate.exitCode})`);
    if (gate.status === "fail") {
      const tail = (gate.stderr || gate.stdout).split("\n").slice(-15).join("\n");
      console.log(tail.replace(/^/gm, "      "));
    }
  }
  console.log("=======================\n");

  console.log("=== Files generated (top 30) ===");
  for (const file of result.filesCreated.slice(0, 30)) {
    console.log(`  ${file.agent.padEnd(20)} ${file.path} (${file.lines}L)`);
  }
  console.log(`(total: ${result.filesCreated.length})\n`);

  console.log("=== QA agent decision ===");
  if (result.state.qa) {
    console.log(`  decision: ${result.state.qa.decision}`);
    console.log(`  summary: ${result.state.qa.summary}`);
    if (result.state.qa.violations?.length) {
      console.log(`  violations:`);
      for (const v of result.state.qa.violations) {
        console.log(`    [${v.severity}] ${v.rule} — ${v.issue}${v.where ? ` @ ${v.where}` : ""}`);
      }
    }
  } else {
    console.log("  (QA agent did not produce a report)");
  }
  console.log("===========================\n");

  console.log(`[test-agents] workDir for inspection: ${workDir}`);

  const allGreen = gates.every((g) => g.status === "pass");
  const qaGo = result.state.qa?.decision === "go";
  if (allGreen && qaGo) {
    console.log(`[test-agents] ✅ ALL GREEN`);
    return 0;
  }
  console.log(`[test-agents] ❌ red gates: ${gates.filter((g) => g.status === "fail").map((g) => g.name).join(", ") || "(none)"}; qa decision: ${result.state.qa?.decision ?? "(none)"}`);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
