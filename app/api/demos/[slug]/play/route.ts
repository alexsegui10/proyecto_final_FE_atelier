import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { prisma } from "@/lib/db/client";
import { ensureUser } from "@/lib/db/repositories/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CachedEvent = {
  offsetMs: number;
  type: string;
  payload: Record<string, unknown>;
};

type CachedDemo = {
  fixturePath?: string;
  summary?: string;
  decision?: string;
  totalDurationMs?: number;
  filesGenerated?: number;
  events: CachedEvent[];
};

const ALLOWED_SLUGS = new Set(["yoga", "tutorias"]);

/**
 * Replay a cached demo: create a Project + Generation, schedule the cached
 * events to be inserted into the Event table at `offsetMs / speed` from
 * "now". The Studio SSE picks them up as if the generation were live.
 *
 * Default speed = 4x (per FINAL_STRETCH_PROMPT spec). `?speed=8` etc. to
 * run faster for shorter demos.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  if (!ALLOWED_SLUGS.has(slug)) {
    return NextResponse.json({ error: "unknown demo" }, { status: 404 });
  }

  const cachePath = join(process.cwd(), "out", "demo-cache", slug, "events.json");
  if (!existsSync(cachePath)) {
    return NextResponse.json({ error: "demo cache missing" }, { status: 410 });
  }

  let cached: CachedDemo;
  try {
    cached = JSON.parse(await readFile(cachePath, "utf-8")) as CachedDemo;
  } catch (err) {
    return NextResponse.json(
      { error: `cannot parse cache: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const speedRaw = url.searchParams.get("speed");
  const speed = Math.max(1, Math.min(20, Number(speedRaw) || 4));

  // Ensure we have a User row + create a per-replay Project.
  const user = await currentUser();
  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    `${userId}@unknown.invalid`;
  await ensureUser({ id: userId, email });

  const fixtureLabel = slug === "yoga" ? "Demo: estudio de yoga" : "Demo: tutorías académicas";
  const project = await prisma.project.create({
    data: {
      slug: `demo-${slug}-${Date.now().toString(36)}`,
      userId,
      name: fixtureLabel,
      prd: { __replayed_from: slug, summary: cached.summary ?? "" },
    },
  });
  // Persist the path to the cached workDir so the /files endpoint can serve
  // the snapshot — these Generations don't have a real temp dir created by
  // the orchestrator. The path is absolute on disk; downstream readers
  // already check existence + path-traversal safety.
  const cachedWorkDir = join(process.cwd(), "out", "demo-cache", slug, "workDir");
  const generation = await prisma.generation.create({
    data: {
      projectId: project.id,
      status: "running",
      result: {
        replay: { slug, speed },
        workDir: cachedWorkDir,
        summary: cached.summary ?? "",
        decision: cached.decision ?? "go",
        durationMs: cached.totalDurationMs ?? null,
      },
    },
  });

  // Schedule events. We insert them with shifted timestamps that reflect
  // the accelerated playback so the SSE polling reads them in the right
  // order with the right pacing.
  const scheduledStart = Date.now();
  for (const event of cached.events) {
    const delayMs = Math.round(event.offsetMs / speed);
    setTimeout(() => {
      void prisma.event
        .create({
          data: {
            generationId: generation.id,
            type: event.type,
            payload: event.payload as never,
          },
        })
        .catch((err) => {
          console.error("[demo replay] persist failed", event.type, err);
        });
    }, delayMs);
    // After the last event, mark the generation complete so /reveal lights up.
    if (event.type === "generation.completed") {
      setTimeout(() => {
        void prisma.generation
          .update({
            where: { id: generation.id },
            data: { status: "complete", finishedAt: new Date() },
          })
          .catch(() => undefined);
      }, delayMs + 100);
    }
    if (event.type === "generation.failed") {
      setTimeout(() => {
        void prisma.generation
          .update({
            where: { id: generation.id },
            data: { status: "failed", finishedAt: new Date() },
          })
          .catch(() => undefined);
      }, delayMs + 100);
    }
  }

  return NextResponse.json({
    generationId: generation.id,
    projectId: project.id,
    speed,
    scheduledStart,
    eventsCount: cached.events.length,
  });
}
