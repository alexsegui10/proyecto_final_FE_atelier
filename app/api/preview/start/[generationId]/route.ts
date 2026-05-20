/**
 * POST /api/preview/start/[generationId]
 *
 * Spawns the generated Next.js app in a child process on a free port.
 * Returns { url } on success, { error } on failure.
 *
 * Gated behind ATELIER_LIVE_PREVIEW=true (default off).
 * Auth: the caller must own the generation.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { prisma } from "@/lib/db/client";
import {
  registry,
  spawnPreview,
} from "@/lib/preview/subprocess-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Generous timeout for the route itself — the subprocess boot can take up to 60s.
export const maxDuration = 75;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ generationId: string }> },
) {
  // Feature flag guard
  if (process.env.ATELIER_LIVE_PREVIEW !== "true") {
    return NextResponse.json(
      { error: "live preview disabled", disabled: true },
      { status: 503 },
    );
  }

  const { generationId } = await params;

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Auth check
  const generation = await prisma.generation.findUnique({
    where: { id: generationId },
    include: { project: { select: { userId: true } } },
  });
  if (!generation) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (generation.project.userId !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Must be complete
  if (generation.status !== "complete") {
    return NextResponse.json(
      { error: `generation is ${generation.status}, not complete` },
      { status: 422 },
    );
  }

  // If already running, return existing URL
  const existing = registry.get(generationId);
  if (existing) {
    return NextResponse.json({ url: existing.url, port: existing.port });
  }

  // Get workDir from result
  const result = generation.result as { workDir?: string } | null;
  const workDir = result?.workDir;
  if (!workDir) {
    return NextResponse.json(
      { error: "workDir not found in generation result" },
      { status: 422 },
    );
  }

  try {
    const { url, port } = await spawnPreview(generationId, workDir);
    return NextResponse.json({ url, port });
  } catch (err) {
    const message = err instanceof Error ? err.message : "spawn failed";
    console.error(`[preview/start] ${generationId}:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
