import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cp, mkdtemp, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prisma } from "@/lib/db/client";
import { getProjectById } from "@/lib/db/repositories/projects";
import {
  runGeneration,
  type OrchestratorEvent,
} from "@/lib/agents/orchestrator";
import type { PRD } from "@/lib/agents/shared-state";
import { GENERATOR_AGENT_ORDER } from "@/lib/agents/shared-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = { projectId: string };

function parseBody(payload: unknown): RequestBody | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { projectId?: unknown };
  if (typeof body.projectId !== "string" || body.projectId.trim().length === 0) return null;
  return { projectId: body.projectId };
}

/**
 * Persist every orchestrator event as an Event row so the SSE endpoint can
 * replay them. Errors here are logged but never throw — losing one telemetry
 * event must not abort the generation.
 */
async function persistEvent(generationId: string, event: OrchestratorEvent): Promise<void> {
  try {
    await prisma.event.create({
      data: {
        generationId,
        type: event.type,
        payload: event as never,
      },
    });
  } catch (err) {
    console.error("[generate/start] failed to persist event", event.type, err);
  }
}

async function prepareWorkDir(generationId: string): Promise<string> {
  const skeletonDir = join(process.cwd(), "lib", "skeleton");
  const workDir = await mkdtemp(join(tmpdir(), `atelier-${generationId}-`));
  await cp(skeletonDir, workDir, { recursive: true });
  await rename(
    join(workDir, "env.example.template"),
    join(workDir, ".env.example"),
  ).catch(() => undefined);
  await rename(
    join(workDir, "gitignore.template"),
    join(workDir, ".gitignore"),
  ).catch(() => undefined);
  await writeFile(
    join(workDir, ".env"),
    `DATABASE_URL="postgresql://user:password@localhost:5432/atelier_app?schema=public"\nBETTER_AUTH_SECRET="placeholder"\nBETTER_AUTH_URL="http://localhost:3000"\n`,
  );
  return workDir;
}

function pnpmInstall(workDir: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["install", "--prefer-offline"], {
      cwd: workDir,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => resolve(code ?? -1));
  });
}

function prismaGenerate(workDir: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "prisma", "generate"], {
      cwd: workDir,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => resolve(code ?? -1));
  });
}

/**
 * Background work that survives the request close. We fire-and-forget; errors
 * are persisted as events and eventually surface in the SSE stream.
 *
 * In production this would belong in a queue (Inngest, BullMQ, etc.). For the
 * dev server during academic demos, the Next.js process stays alive long
 * enough for a single generation to finish.
 */
async function runOrchestratorInBackground(args: {
  generationId: string;
  projectId: string;
  prd: PRD;
}): Promise<void> {
  const { generationId, projectId, prd } = args;
  let workDir: string | null = null;
  try {
    workDir = await prepareWorkDir(generationId);

    const installCode = await pnpmInstall(workDir);
    if (installCode !== 0) {
      await persistEvent(generationId, {
        type: "generation.failed",
        generationId,
        reason: `pnpm install failed in workDir (exit ${installCode})`,
      });
      return;
    }
    const generateCode = await prismaGenerate(workDir);
    if (generateCode !== 0) {
      await persistEvent(generationId, {
        type: "generation.failed",
        generationId,
        reason: `prisma generate failed in workDir (exit ${generateCode})`,
      });
      return;
    }

    const promptsDir = join(process.cwd(), "lib", "agents", "prompts");
    const result = await runGeneration({
      generationId,
      projectId,
      prd,
      workDir,
      promptsDir,
      onEvent: (event) => persistEvent(generationId, event),
    });

    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: result.failedAt ? "failed" : "complete",
        finishedAt: new Date(),
        result: {
          workDir,
          durationMs: result.durationMs,
          filesCreated: result.filesCreated.length,
          summary: result.state.qa?.summary ?? null,
          decision: result.state.qa?.decision ?? null,
        },
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "orchestrator crashed";
    await persistEvent(generationId, {
      type: "generation.failed",
      generationId,
      reason,
    });
    await prisma.generation
      .update({
        where: { id: generationId },
        data: { status: "failed", finishedAt: new Date() },
      })
      .catch(() => undefined);
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const body = parseBody(payload);
  if (!body) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const project = await getProjectById(body.projectId);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  if (project.userId !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const generation = await prisma.generation.create({
    data: {
      projectId: project.id,
      status: "pending",
    },
  });

  // Pre-create AgentRun rows so the Studio knows which agents will run.
  for (const agent of GENERATOR_AGENT_ORDER) {
    await prisma.agentRun.create({
      data: {
        generationId: generation.id,
        agent,
        status: "idle",
      },
    });
  }

  // Fire-and-forget — runs after the response is already on the wire.
  void runOrchestratorInBackground({
    generationId: generation.id,
    projectId: project.id,
    prd: project.prd as unknown as PRD,
  });

  return NextResponse.json({ generationId: generation.id });
}
